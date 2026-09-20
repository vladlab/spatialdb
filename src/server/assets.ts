/**
 * The asset store — see sql/006_assets.sql for what it is and why it exists.
 *
 * Three rules shape this file:
 *
 * 1. UPLOADS NEVER TOUCH THE MUTATION LOG. `POST /api/assets` is its own
 *    endpoint; what goes through `/api/mutate` afterwards is a value holding an
 *    asset ID — a few dozen bytes, however large the file.
 *
 * 2. NOTHING IS HELD IN MEMORY. The body is streamed to a temp file while being
 *    hashed and counted, so the size cap can be generous (500 MB by default —
 *    this is an internal tool; the cap exists to stop an accident, not to ration
 *    anyone) without a large upload costing RAM.
 *
 * 3. THE TYPE IS WHAT THE BYTES SAY, not what the request claims. The first
 *    bytes are sniffed against a short allowlist and the file is served back with
 *    that type and `nosniff`. SVG is deliberately NOT on the list: it is a
 *    document that can carry script, and these files are served from the app's
 *    own origin.
 */

import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
/** Beside the Postgres data directory (`.pg/data`) unless told otherwise. */
export const ASSETS_DIR = process.env.SPATIALDB_ASSETS_DIR || join(ROOT, '.pg', 'assets');
export const MAX_BYTES = Math.max(1, Number(process.env.ASSET_MAX_MB) || 500) * 1024 * 1024;

export interface AssetRow {
  id: string; sha256: string; mime: string; bytes: number;
  width: number | null; height: number | null; name: string;
}

export class AssetError extends Error {
  constructor(message: string, readonly status: 400 | 413 | 415) { super(message); }
}

/** `ab/cd/<sha>` — two levels, so no directory ever holds more than a few hundred entries. */
export const pathFor = (sha256: string) =>
  join(ASSETS_DIR, sha256.slice(0, 2), sha256.slice(2, 4), sha256);

/* ── what is it? ─────────────────────────────────────────────────────────── */

const ascii = (b: Buffer, from: number, to: number) => b.subarray(from, to).toString('latin1');

export function sniffMime(head: Buffer): string | null {
  if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (head.length >= 6 && (ascii(head, 0, 6) === 'GIF87a' || ascii(head, 0, 6) === 'GIF89a')) return 'image/gif';
  if (head.length >= 12 && ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 12) === 'WEBP') return 'image/webp';
  if (head.length >= 5 && ascii(head, 0, 5) === '%PDF-') return 'application/pdf';
  return null;
}

/**
 * Pixel size from the header, without decoding the image and without a
 * dependency. Best-effort: an unusual file yields null, never an error — the
 * size is a layout hint, not a fact anything depends on. `head` is the first
 * 64 KB, which is where every one of these formats keeps it (a JPEG's SOF can
 * sit behind a large EXIF block, hence not just the first few hundred bytes).
 */
export function sniffSize(mime: string, head: Buffer): { width: number; height: number } | null {
  try {
    if (mime === 'image/png' && head.length >= 24) {
      return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
    }
    if (mime === 'image/gif' && head.length >= 10) {
      return { width: head.readUInt16LE(6), height: head.readUInt16LE(8) };
    }
    if (mime === 'image/webp' && head.length >= 30) {
      const kind = ascii(head, 12, 16);
      if (kind === 'VP8X') return { width: 1 + head.readUIntLE(24, 3), height: 1 + head.readUIntLE(27, 3) };
      if (kind === 'VP8 ') return { width: head.readUInt16LE(26) & 0x3fff, height: head.readUInt16LE(28) & 0x3fff };
      if (kind === 'VP8L') {
        const bits = head.readUInt32LE(21);
        return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
      }
    }
    if (mime === 'image/jpeg') {
      let i = 2;
      while (i + 9 < head.length) {
        if (head[i] !== 0xff) { i++; continue; }
        const marker = head[i + 1];
        // SOF0–SOF15, minus DHT (C4), JPG (C8) and DAC (CC), carry the frame size.
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { width: head.readUInt16BE(i + 7), height: head.readUInt16BE(i + 5) };
        }
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
        i += 2 + head.readUInt16BE(i + 2);
      }
    }
  } catch { /* truncated or odd header: no size */ }
  return null;
}

/* ── store ───────────────────────────────────────────────────────────────── */

const HEAD_BYTES = 64 * 1024;

/**
 * Stream `body` to disk and index it. Returns the row and whether it was new.
 *
 * Written to a temp file first and RENAMED into place, so a reader can never see
 * half a file at a content address, and an aborted upload leaves nothing behind
 * but a temp file this function removes.
 */
export async function storeAsset(
  pool: pg.Pool, body: ReadableStream<Uint8Array> | null, name: string, userId: string | null,
): Promise<{ asset: AssetRow; created: boolean }> {
  if (!body) throw new AssetError('empty upload', 400);

  const tmpDir = join(ASSETS_DIR, 'tmp');
  await mkdir(tmpDir, { recursive: true });
  const tmp = join(tmpDir, randomUUID());
  const out = createWriteStream(tmp);
  const hash = createHash('sha256');
  const headParts: Buffer[] = [];
  let headLen = 0, bytes = 0, over = false;

  try {
    const reader = body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) {
        // Too big — but KEEP READING, discarding, and answer only when the client
        // has finished sending. Cancelling here resets the connection while the
        // client is still mid-upload, and a browser reports that as a generic
        // network failure; the 413 and its explanation never arrive. Draining
        // costs bandwidth on a LAN and buys an error message someone can act on.
        if (!over) { over = true; out.destroy(); }
        continue;
      }
      const chunk = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
      hash.update(chunk);
      if (headLen < HEAD_BYTES) { headParts.push(chunk.subarray(0, HEAD_BYTES - headLen)); headLen += chunk.length; }
      // Respect backpressure: a fast client must not outrun a slow disk into RAM.
      if (!out.write(chunk)) await new Promise<void>((r) => out.once('drain', () => r()));
    }
    if (over) {
      throw new AssetError(`file is larger than the ${MAX_BYTES / 1024 / 1024} MB limit (ASSET_MAX_MB)`, 413);
    }
    await new Promise<void>((res, rej) => out.end((e?: Error | null) => (e ? rej(e) : res())));
    if (bytes === 0) throw new AssetError('empty upload', 400);

    const head = Buffer.concat(headParts);
    const mime = sniffMime(head);
    if (!mime) {
      throw new AssetError('unsupported file type — images (PNG, JPEG, GIF, WebP) and PDF are accepted', 415);
    }
    const size = sniffSize(mime, head);
    const sha256 = hash.digest('hex');

    // The ROW is the claim; the file is put in place before it, so a row never
    // points at nothing. Two uploads of the same new file race harmlessly: both
    // rename identical bytes to the same path, one insert wins, both read it back.
    const dest = pathFor(sha256);
    await mkdir(dirname(dest), { recursive: true });
    await rename(tmp, dest);

    const ins = await pool.query(
      `insert into assets (sha256, mime, bytes, width, height, name, created_by)
       values ($1,$2,$3,$4,$5,$6,$7) on conflict (sha256) do nothing
       returning id, sha256, mime, bytes, width, height, name`,
      [sha256, mime, bytes, size?.width ?? null, size?.height ?? null, name.slice(0, 255), userId]);
    if (ins.rowCount) return { asset: normalise(ins.rows[0]), created: true };
    const had = await pool.query(
      `select id, sha256, mime, bytes, width, height, name from assets where sha256 = $1`, [sha256]);
    return { asset: normalise(had.rows[0]), created: false };
  } catch (e) {
    out.destroy();
    await rm(tmp, { force: true });
    throw e;
  }
}

/** pg returns bigint as a string; nothing here approaches 2^53. */
const normalise = (r: AssetRow & { bytes: number | string }): AssetRow => ({ ...r, bytes: Number(r.bytes) });

export async function findAsset(pool: pg.Pool, id: string): Promise<AssetRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { rows } = await pool.query(
    `select id, sha256, mime, bytes, width, height, name from assets where id = $1`, [id]);
  return rows[0] ? normalise(rows[0]) : null;
}

/** Open the bytes for reading, or null if the file is missing from disk. */
export async function openAsset(a: AssetRow) {
  const file = pathFor(a.sha256);
  try { await stat(file); } catch { return null; }
  return createReadStream(file);
}
