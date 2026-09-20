/**
 * The asset suite: upload, identity, serving, limits — over real HTTP, against a
 * real directory on disk (a throwaway one; see ASSETS below).
 *
 * The fixture "images" are HEADERS ONLY: the bytes a format keeps its type and
 * size in, followed by filler. The store never decodes an image — it sniffs the
 * type and reads the size — so that is the whole contract to test, and it keeps
 * binary blobs out of the repository.
 */

import pg from 'pg';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// BEFORE the server boots (it inherits this process's environment): a private
// directory, and a 1 MB cap so the limit can be tested without a 500 MB upload.
const ASSETS = mkdtempSync(join(tmpdir(), 'spatialdb-assets-'));
process.env.SPATIALDB_ASSETS_DIR = ASSETS;
process.env.ASSET_MAX_MB = '1';

const { bootServer } = await import('./harness.js');
const { sniffMime, sniffSize } = await import('../src/server/assets.js');

const PORT = Number(process.env.TEST_PORT ?? 8806);
const API = `http://localhost:${PORT}`;

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

/* ── fixtures ────────────────────────────────────────────────────────────── */

const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const u16be = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
const u16le = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u24le = (n: number) => { const b = Buffer.alloc(3); b.writeUIntLE(n, 0, 3); return b; };

const png = (w: number, h: number, salt = '') => Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), u32(13), Buffer.from('IHDR'), u32(w), u32(h),
  Buffer.from([8, 6, 0, 0, 0]), Buffer.from(salt)]);
const gif = (w: number, h: number) => Buffer.concat([Buffer.from('GIF89a'), u16le(w), u16le(h), Buffer.alloc(8)]);
// SOI, a fat APP1 (EXIF) segment the parser must SKIP, then SOF0 with the size.
const jpeg = (w: number, h: number) => Buffer.concat([
  Buffer.from([0xff, 0xd8]), Buffer.from([0xff, 0xe1]), u16be(2 + 3000), Buffer.alloc(3000, 0x41),
  Buffer.from([0xff, 0xc0]), u16be(17), Buffer.from([8]), u16be(h), u16be(w), Buffer.alloc(12)]);
const webp = (w: number, h: number) => Buffer.concat([
  Buffer.from('RIFF'), u32(0), Buffer.from('WEBP'), Buffer.from('VP8X'), Buffer.from([10, 0, 0, 0]),
  Buffer.alloc(4), u24le(w - 1), u24le(h - 1)]);
const pdf = () => Buffer.from('%PDF-1.7\n%âãÏÓ\n1 0 obj\n<<>>\nendobj\n');

const pool = new pg.Pool({ connectionString: process.env.DB_URL });
const upload = (body: Buffer | string, name = '', headers: Record<string, string> = {}) =>
  fetch(`${API}/api/assets?name=${encodeURIComponent(name)}`, { method: 'POST', body: body as BodyInit, headers });
const filesOnDisk = () => {
  const out: string[] = [];
  const walk = (d: string) => { for (const e of readdirSync(d, { withFileTypes: true })) e.isDirectory() ? walk(join(d, e.name)) : out.push(join(d, e.name)); };
  if (existsSync(ASSETS)) walk(ASSETS);
  return out;
};

async function main() {
  console.log('\nA1. What is it? (pure)');
  check('types come from the BYTES', sniffMime(png(1, 1)) === 'image/png' && sniffMime(jpeg(1, 1)) === 'image/jpeg'
    && sniffMime(gif(1, 1)) === 'image/gif' && sniffMime(webp(1, 1)) === 'image/webp' && sniffMime(pdf()) === 'application/pdf');
  check('anything else is not a type — including SVG and HTML',
    sniffMime(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')) === null
    && sniffMime(Buffer.from('<!doctype html>')) === null && sniffMime(Buffer.alloc(0)) === null);
  const sz = (m: string, b: Buffer) => JSON.stringify(sniffSize(m, b));
  check('pixel size is read from each header',
    sz('image/png', png(1920, 1080)) === '{"width":1920,"height":1080}'
    && sz('image/gif', gif(320, 200)) === '{"width":320,"height":200}'
    && sz('image/webp', webp(4096, 2160)) === '{"width":4096,"height":2160}',
    [sz('image/png', png(1920, 1080)), sz('image/gif', gif(320, 200)), sz('image/webp', webp(4096, 2160))].join(' '));
  check('a JPEG\'s size is found BEHIND a large EXIF block', sz('image/jpeg', jpeg(3840, 2160)) === '{"width":3840,"height":2160}', sz('image/jpeg', jpeg(3840, 2160)));
  check('a truncated header yields no size, not an exception',
    sniffSize('image/png', png(1, 1).subarray(0, 12)) === null && sniffSize('image/jpeg', Buffer.from([0xff, 0xd8, 0xff])) === null);

  if (!(await pool.query(`select 1 from users limit 1`)).rowCount) {
    await pool.query(`insert into users (email, name, role) values ('assets@local','Assets','admin')`);
  }
  const server = await bootServer(PORT);
  try {
    console.log('\nA2. Upload');
    const shot = png(1440, 900, 'first');
    const logBefore = Number((await pool.query(`select count(*)::int n from mutations`)).rows[0].n);
    const r1 = await upload(shot, 'Screenshot 2026-09-18.png', { 'Content-Type': 'text/plain' });
    const a1: any = await r1.json();
    check('a new file is 201 with its metadata', r1.status === 201 && a1.mime === 'image/png' && a1.bytes === shot.length
      && a1.width === 1440 && a1.height === 900 && a1.name === 'Screenshot 2026-09-18.png', JSON.stringify(a1));
    check('the type is what the bytes say, NOT the Content-Type sent (text/plain)', a1.mime === 'image/png');
    check('the hash is the sha256 of the content', a1.sha256 === createHash('sha256').update(shot).digest('hex'));
    const where = join(ASSETS, a1.sha256.slice(0, 2), a1.sha256.slice(2, 4), a1.sha256);
    check('stored at ab/cd/<sha256>, byte for byte', existsSync(where) && readFileSync(where).equals(shot), where);
    check('an upload writes NOTHING to the mutation log',
      Number((await pool.query(`select count(*)::int n from mutations`)).rows[0].n) === logBefore);

    console.log('\nA3. The same bytes are the same asset');
    const r2 = await upload(shot, 'a different name.png');
    const a2: any = await r2.json();
    check('uploading identical bytes again is 200 and the SAME id', r2.status === 200 && a2.id === a1.id, `${r2.status} ${a2.id}`);
    check('the first name is kept — a name is a label, not identity', a2.name === 'Screenshot 2026-09-18.png', a2.name);
    check('one row, one file', (await pool.query(`select count(*)::int n from assets where sha256 = $1`, [a1.sha256])).rows[0].n === 1
      && filesOnDisk().filter((f) => f.endsWith(a1.sha256)).length === 1);
    const racers = await Promise.all(Array.from({ length: 6 }, () => upload(png(640, 480, 'race')).then((r) => r.json() as Promise<any>)));
    check('six simultaneous uploads of one NEW file agree on a single id', new Set(racers.map((r) => r.id)).size === 1,
      [...new Set(racers.map((r) => r.id))].join());
    const other: any = await (await upload(png(1440, 900, 'second'))).json();
    check('different bytes are a different asset', other.id !== a1.id);

    console.log('\nA4. Serving');
    const g = await fetch(`${API}/api/assets/${a1.id}`);
    check('GET returns the bytes', g.status === 200 && Buffer.from(await g.arrayBuffer()).equals(shot));
    check('with the sniffed type, a length, and nosniff', g.headers.get('content-type') === 'image/png'
      && g.headers.get('content-length') === String(shot.length) && g.headers.get('x-content-type-options') === 'nosniff');
    check('cacheable forever — the bytes behind an id never change', /immutable/.test(g.headers.get('cache-control') ?? '')
      && /max-age=31536000/.test(g.headers.get('cache-control') ?? ''), g.headers.get('cache-control') ?? '');
    check('and named for download', (g.headers.get('content-disposition') ?? '').includes(encodeURIComponent('Screenshot 2026-09-18.png')));
    const notMod = await fetch(`${API}/api/assets/${a1.id}`, { headers: { 'If-None-Match': g.headers.get('etag')! } });
    check('a revalidation with the ETag is a 304', notMod.status === 304);
    const meta: any = await (await fetch(`${API}/api/assets/${a1.id}/meta`)).json();
    check('/meta returns the row without the bytes', meta.id === a1.id && meta.width === 1440);
    check('unknown and malformed ids are 404, not 500',
      (await fetch(`${API}/api/assets/${randomUUID()}`)).status === 404 && (await fetch(`${API}/api/assets/not-a-uuid`)).status === 404);
    for (const [label, body, mime, w] of [['JPEG', jpeg(3840, 2160), 'image/jpeg', 3840], ['GIF', gif(320, 200), 'image/gif', 320],
      ['WebP', webp(4096, 2160), 'image/webp', 4096]] as const) {
      const a: any = await (await upload(body)).json();
      check(`${label} is accepted, typed and measured`, a.mime === mime && a.width === w, JSON.stringify(a));
    }
    const p: any = await (await upload(pdf(), 'spec.pdf')).json();
    check('a PDF is accepted, with no pixel size', p.mime === 'application/pdf' && p.width === null && p.height === null, JSON.stringify(p));

    console.log('\nA5. What is refused — and what it leaves behind');
    const diskBefore = filesOnDisk().length;
    const svg = await upload('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 'x.svg', { 'Content-Type': 'image/svg+xml' });
    check('SVG is refused (415) — it can carry script and is served from our origin', svg.status === 415, `${svg.status}`);
    const liar = await upload('MZ this is not a picture', 'holiday.png', { 'Content-Type': 'image/png' });
    check('a file that merely CLAIMS to be a PNG is refused', liar.status === 415, `${liar.status}`);
    check('an empty upload is a 400', (await upload(Buffer.alloc(0))).status === 400);
    // Cap is 1 MB in this suite (ASSET_MAX_MB above). A valid PNG header + 1.5 MB.
    const big = await upload(Buffer.concat([png(10, 10), randomBytes(1_500_000)]));
    const bigBody: any = await big.json().catch(() => ({}));
    check('over the limit is a 413 that names the setting', big.status === 413 && /ASSET_MAX_MB/.test(bigBody.error ?? ''), `${big.status} ${JSON.stringify(bigBody)}`);
    const under = await upload(Buffer.concat([png(10, 10), randomBytes(900_000)]));
    check('(control) just under the limit is accepted', under.status === 201, `${under.status}`);
    check('refused uploads leave NOTHING on disk — no temp files, no orphans',
      filesOnDisk().length === diskBefore + 1 && !filesOnDisk().some((f) => f.includes(`${join(ASSETS, 'tmp')}/`)),
      `${filesOnDisk().length} files (was ${diskBefore}); tmp: ${filesOnDisk().filter((f) => f.includes('/tmp/')).length}`);
    const slashed: any = await (await upload(png(5, 5, 'path'), '../../etc/passwd.png')).json();
    check('a name is a label: path segments are dropped', slashed.name === 'passwd.png', slashed.name);

    console.log('\nA6. A database restored without its assets directory says so');
    rmSync(where);
    const orphan = await fetch(`${API}/api/assets/${a1.id}`);
    const orphanBody: any = await orphan.json();
    check('a row whose file is gone is a 404 that explains itself', orphan.status === 404 && /missing from the assets directory/.test(orphanBody.error ?? ''),
      JSON.stringify(orphanBody));
    const healed: any = await (await upload(shot)).json();
    check('re-uploading the same bytes HEALS it — same id, file back', healed.id === a1.id
      && (await fetch(`${API}/api/assets/${a1.id}`)).status === 200);
  } finally {
    await server.stop();
    rmSync(ASSETS, { recursive: true, force: true });
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  await pool.end();
  process.exit(fail ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  rmSync(ASSETS, { recursive: true, force: true });
  await pool.end().catch(() => {});
  process.exit(1);
});
