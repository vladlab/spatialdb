/**
 * ============================================================================
 *  The Resolve tool's links and its overwrite check (RESOLVE-BRIEF.md R1.5, R4).
 * ============================================================================
 *
 *  Two things the tool needs that are RULES, not plumbing, so they live here,
 *  pure, and are tested on their own (test/resolve.ts):
 *
 *  1. Which linked files are NOT on the timeline. The output `audio_files` lands
 *     in the owner's general INPUTS link — every file an edit was made from,
 *     picture included (Oct 26) — so the tool never owns that field: an ingest
 *     ADDS the mix files it finds and removes nothing, and a link made by hand is
 *     checked, not overwritten. The check: every linked file that IS AUDIO and
 *     whose path is not among the clip paths of the record's Audio tracks value
 *     is marked, with the reason. Derived live from the record (the links, the
 *     targets' path and media columns, the `timeline_audio` value); nothing is
 *     stored, so a re-ingest or a relink corrects it by itself.
 *
 *  2. Which fields an ingest would overwrite — the list the "Overwrite N fields?"
 *     dialog shows. A field that is empty, or already holds what would be written,
 *     is not a conflict.
 */

import { TimelineAudio } from './shapes.js';

/* ── which linked files are audio ─────────────────────────────────────────── */

/**
 * The extensions that mean audio when the Files table has no Media column to ask.
 * NOT mxf: a picture MXF cannot be told from an audio one by its name, and a
 * false warning on every picture input is worse than a missed one.
 */
export const AUDIO_EXTENSIONS = ['wav', 'aif', 'aiff', 'bwf', 'flac', 'mp3', 'aac', 'ac3', 'ec3', 'eac3', 'm4a', 'caf', 'w64', 'rf64'] as const;

/** What the check knows about one linked file: its path column and Media column, when the table has them. */
export interface LinkedFile { id: string; label: string; path?: unknown; media?: unknown }

/**
 * Is this linked file audio? The Media column decides when it says anything (the
 * File drop classifier's word: "audio" / "video" / …); else the path's extension;
 * else unknown (null) — and an unknown file is never flagged.
 */
export function isAudioFile(f: { path?: unknown; media?: unknown }): boolean | null {
  if (typeof f.media === 'string' && f.media.trim()) return f.media.trim().toLowerCase() === 'audio';
  if (typeof f.path === 'string' && f.path) {
    const name = f.path.split(/[\\/]/).pop() ?? '';
    const dot = name.lastIndexOf('.');
    if (dot > 0) return (AUDIO_EXTENSIONS as readonly string[]).includes(name.slice(dot + 1).toLowerCase());
  }
  return null;
}

/** The distinct file paths on a timeline's audio tracks — what `audio_files` links, and what the check compares against. */
export function timelinePaths(audioTracks: unknown): string[] {
  const r = TimelineAudio.safeParse(audioTracks);
  if (!r.success) return [];
  return [...new Set(r.data.tracks.flatMap((t) => t.clips.flatMap((c) => (c.path ? [c.path] : []))))];
}

/* ── the warning ──────────────────────────────────────────────────────────── */

export interface InputWarning { id: string; reason: string }

/**
 * The linked files to MARK on one record, each with why. `audioTracks` is the
 * record's Audio tracks value: absent or invalid (never ingested) → nothing is
 * marked, never a false warning. Order: the links' own.
 */
export function inputWarnings(linked: LinkedFile[], audioTracks: unknown): InputWarning[] {
  const r = TimelineAudio.safeParse(audioTracks);
  if (!r.success) return [];
  const onTimeline = new Set(timelinePaths(r.data));
  const out: InputWarning[] = [];
  for (const f of linked) {
    if (isAudioFile(f) !== true) continue;
    if (typeof f.path !== 'string' || !f.path) { out.push({ id: f.id, reason: `${f.label} is an audio input with no path, so it cannot be checked against the timeline` }); continue; }
    if (!onTimeline.has(f.path)) out.push({ id: f.id, reason: `${f.label} is an audio input but is not on the timeline as last read from Resolve` });
  }
  return out;
}

/* ── the overwrite check ──────────────────────────────────────────────────── */

export interface Conflict { fieldId: string; name: string; old: unknown; next: unknown }

const same = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));   // float noise, not a change
  if (typeof a === 'object') return JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
  return false;
};
/** Keys in one order, so two equal objects stringify the same whatever jsonb did to them. */
function sorted(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sorted);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sorted((v as Record<string, unknown>)[k])]));
  return v;
}

/**
 * Which of the values about to be written differ from what the record holds.
 * Empty fields are not conflicts (an empty row just imports); equal values are
 * not conflicts (nothing changes). `data` is keyed by field KEY, as a record's
 * data is; `fields` names them.
 */
export function conflicts(current: Record<string, unknown>, data: Record<string, unknown>, fields: Array<{ id: string; key: string; name: string }>): Conflict[] {
  const out: Conflict[] = [];
  for (const f of fields) {
    if (!(f.key in data)) continue;
    const old = current[f.key];
    if (old === undefined || old === null || old === '') continue;
    if (same(old, data[f.key])) continue;
    out.push({ fieldId: f.id, name: f.name, old, next: data[f.key] });
  }
  return out;
}
