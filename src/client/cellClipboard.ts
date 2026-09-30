/**
 * ============================================================================
 *  Copying and pasting a CELL — one field's value, between records.
 * ============================================================================
 *
 *  Ctrl+C on a cell (grid) or a field (tray) copies its value; Ctrl+V on another
 *  pastes it, when the two fields hold LIKE data:
 *
 *      text ↔ long_text ↔ file_path      number      date      checkbox
 *      select ↔ select                   only if the target select HAS that choice
 *      multi_select ↔ multi_select       only if it has every choice
 *      link ↔ link                       only if both point at the same table;
 *                                        REPLACES the target's links, a "single"
 *                                        target takes the first; targets since
 *                                        deleted are skipped
 *
 *  Anything else — lookup, backlink, a junction column, attachment, structured —
 *  is not a paste target, and a refused paste says why (a notice), never a
 *  half-paste. The value itself is never changed on the way: a select choice is
 *  not added to the target's vocabulary, a name is not resolved to a link.
 *
 *  The clipboard is the SYSTEM clipboard, so a copied cell pastes into a
 *  spreadsheet as its text — and plain text copied elsewhere pastes into a text,
 *  number or date cell (numbers and dates are parsed; anything unparseable is
 *  refused). What cannot be plain text (a link's records) rides in memory
 *  alongside: on paste, if the clipboard still holds the text we wrote, the
 *  in-app value is what is pasted. Only text is read from the outside world.
 *
 *  Both go through the browser's `copy` / `paste` EVENTS on the focused element,
 *  never the async clipboard API: reading it asks for permission, which Firefox
 *  turns into a "Paste" button that pops up on every Ctrl+V.
 */

import type { Store } from './store';
import type { FieldRow } from './state';
import { choicesOf } from '../contract/values';

export interface CellClip {
  /** The source field's type, and what it pointed at (links). */
  type: string;
  targetTable?: string;
  /** The value as stored — for a link, the linked record ids. */
  value: unknown;
  /** What went to the system clipboard. */
  text: string;
}

let held: CellClip | null = null;

const TEXTUAL = new Set(['text', 'long_text', 'file_path']);
const PASTABLE = new Set([...TEXTUAL, 'number', 'date', 'checkbox', 'select', 'multi_select', 'link']);

/** Text for the outside world — the cell as it reads. */
function textOf(clip: Omit<CellClip, 'text'>, labelOf: (id: string) => string): string {
  const v = clip.value;
  if (clip.type === 'link') return (v as string[]).map(labelOf).join(', ');
  if (Array.isArray(v)) return v.map(String).join(', ');
  if (v === undefined || v === null) return '';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v);
}

/**
 * What `recordId`'s `field` would copy, or null when the field is not copyable.
 * Handed to `copyCell` on a `copy` event.
 */
export function clipOf(store: Store, recordId: string, field: FieldRow, labelOf: (id: string) => string): CellClip | null {
  if (!PASTABLE.has(field.type)) return null;
  const rec = store.state.records.get(recordId);
  if (!rec) return null;
  const value = field.type === 'link'
    ? [...store.state.links.values()].filter((l) => l.from_record === recordId && l.field_id === field.id).map((l) => l.to_record)
    : rec.data[field.key];
  // JSON, not structuredClone: store values are Vue proxies, which structuredClone refuses.
  const clip: Omit<CellClip, 'text'> = { type: field.type, value: JSON.parse(JSON.stringify(value ?? null)), targetTable: field.type === 'link' ? String(field.options?.target_table_id ?? '') : undefined };
  return { ...clip, text: textOf(clip, labelOf) };
}

/**
 * Copy, on a `copy` EVENT (Ctrl+C on the focused grid or tray field): the text goes
 * to the system clipboard through the event — no permission, no prompt — and the
 * whole value is held here. Returns what was copied, or null.
 */
export function copyCell(e: ClipboardEvent | null, clip: CellClip | null): CellClip | null {
  if (!clip) return null;
  held = clip;
  if (e) { e.preventDefault(); try { e.clipboardData?.setData('text/plain', clip.text); } catch { /* no clipboardData: in-app only */ } }
  return clip;
}

/**
 * What a paste would use, from a `paste` EVENT's text: the in-app clip if that is
 * still what the clipboard holds (or there is no clipboard text at all), else the
 * outside text. Never `navigator.clipboard.readText()` — that asks the browser for
 * permission, and Firefox answers with a "Paste" button the person has to click.
 */
export function clipFromPaste(e: ClipboardEvent | null): CellClip | { type: 'external'; text: string } | null {
  let text: string | null = null;
  try { text = e?.clipboardData?.getData('text/plain') ?? null; } catch { text = null; }
  if (held && (text === null || text === '' || text === held.text)) return held;
  if (text !== null && text !== '') return { type: 'external', text };
  return held;
}

/** The type group a value must come from to land in `field`; the human name is for the refusal. */
function groupOf(type: string): string | null {
  if (TEXTUAL.has(type)) return 'text';
  if (PASTABLE.has(type)) return type;
  return null;
}

/**
 * Paste into `recordId`'s `field`. Returns null on success, or the reason it was
 * refused — nothing is written when refused.
 */
export function pasteCell(store: Store, recordId: string, field: FieldRow, clip: CellClip | { type: 'external'; text: string }): string | null {
  const rec = store.state.records.get(recordId);
  if (!rec) return 'no record';
  const group = groupOf(field.type);
  if (!group) return `${field.name} cannot be pasted into (${field.type.replace('_', ' ')})`;

  // Plain text from outside: text, number and date cells take it; nothing else does.
  if (!('value' in clip)) {
    const t = clip.text.trim();
    if (group === 'text') return set(store, rec.id, field.key, clip.text);
    if (group === 'number') { const n = Number(t); return Number.isFinite(n) && t !== '' ? set(store, rec.id, field.key, n) : `"${t}" is not a number`; }
    if (group === 'date') return /^\d{4}-\d{2}-\d{2}$/.test(t) ? set(store, rec.id, field.key, t) : `"${t}" is not a date (YYYY-MM-DD)`;
    if (group === 'checkbox') { if (/^(true|yes|1)$/i.test(t)) return set(store, rec.id, field.key, true); if (/^(false|no|0)$/i.test(t)) return set(store, rec.id, field.key, false); return `"${t}" is not true or false`; }
    return `plain text cannot be pasted into a ${group.replace('_', ' ')} field`;
  }

  const from = groupOf(clip.type);
  if (from !== group) return `a ${(from ?? clip.type).replace('_', ' ')} value cannot be pasted into a ${group.replace('_', ' ')} field`;
  const c: CellClip = clip;

  if (group === 'select') {
    const v = c.value;
    if (v === null || v === undefined || v === '') return set(store, rec.id, field.key, null);
    const choices = choicesOf(field.options) ?? [];
    return choices.includes(String(v)) ? set(store, rec.id, field.key, v) : `"${v}" is not one of ${field.name}'s choices`;
  }
  if (group === 'multi_select') {
    const v = Array.isArray(c.value) ? (c.value as string[]) : [];
    const choices = new Set(choicesOf(field.options) ?? []);
    const missing = v.filter((c) => !choices.has(c));
    return missing.length ? `${field.name} has no choice "${missing[0]}"` : set(store, rec.id, field.key, v.length ? v : null);
  }
  if (group === 'link') {
    const target = String(field.options?.target_table_id ?? '');
    if (!target || c.targetTable !== target) return `${field.name} links to a different table than the copied field`;
    const wanted = (c.value as string[]).filter((id) => id !== recordId && store.state.records.has(id));
    const keep = field.options?.single === true ? wanted.slice(0, 1) : wanted;
    const have = [...store.state.links.values()].filter((l) => l.from_record === recordId && l.field_id === field.id).map((l) => l.to_record);
    // REPLACE: what is not wanted goes, what is wanted and missing comes — one batch.
    for (const id of have) if (!keep.includes(id)) store.mutate({ type: 'link.remove', fieldId: field.id, fromRecord: recordId, toRecord: id });
    for (const id of keep) if (!have.includes(id)) store.mutate({ type: 'link.add', id: crypto.randomUUID(), fieldId: field.id, fromRecord: recordId, toRecord: id });
    return null;
  }
  return set(store, rec.id, field.key, c.value);
}

function set(store: Store, recordId: string, key: string, value: unknown): null {
  if (value === null || value === undefined || value === '') store.mutate({ type: 'record.update', id: recordId, set: {}, unset: [key] });
  else store.mutate({ type: 'record.update', id: recordId, set: { [key]: value }, unset: [] });
  return null;
}
