/**
 * The ways INTO a note's page (NotePage.vue): what the tray, the grid's row menu and
 * the canvas's card menu share, so the three cannot drift apart.
 *
 * A note opens in a NEW BROWSER TAB — the owner's choice for now: the page is for
 * writing beside the app, not instead of it. When the app has tabs of its own,
 * `openNote` is the one place that learns the second way to open one.
 *
 * Not in the desktop client: its shell has one window, and the native calls are
 * granted to that window alone (src-tauri/src/lib.rs, rule 1), so "a new tab" is
 * not a thing there. The entry points are simply absent.
 */
import { isDesktop } from './desktop';
import { formatNote } from './router';
import { fieldsOf, type FieldRow } from './state';
import type { Store } from './store';

export const notesOffered = (): boolean => !isDesktop();

/** The rich text fields of a record's table, in field order — one menu item each. */
export function noteFields(store: Store, recordId: string): FieldRow[] {
  const rec = store.state.records.get(recordId);
  return rec && notesOffered() ? fieldsOf(store.state, rec.table_id).filter((f) => f.type === 'rich_text') : [];
}

/** The address, relative to this page: an <a href> or window.open resolves it against the app's own URL. */
export const noteHref = (recordId: string, fieldId: string): string => formatNote({ record: recordId, field: fieldId });

export function openNote(recordId: string, fieldId: string): void {
  // `noopener`: the new tab is its own app, with its own store and stream.
  window.open(noteHref(recordId, fieldId), '_blank', 'noopener');
}
