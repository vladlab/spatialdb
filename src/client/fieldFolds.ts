/**
 * Which BLOCK fields this person has folded in the record tray, per view.
 *
 * A field whose value needs room — an audio layout, a manifest, long or rich
 * text, attachments, a junction's nested table — is a row like any other
 * (its name, then its one-line summary, as the canvas card prints it) with a
 * fold chip; unfolded, its full editor hangs under the row. Folding one is
 * nobody else's business and not a schema edit, so it lives here: per browser,
 * in localStorage, like the section folds (client/sectionFolds.ts).
 *
 * It is keyed by VIEW and field, not by record: the tray follows the selection
 * from row to row, and a layout folded on one file must stay folded on the
 * next — but what is worth reading in the Trailer grid is not what is worth
 * reading on the delivery canvas, so each view (a grid view, a canvas, a report)
 * keeps its own. Every field STARTS unfolded; only a fold is stored, so clearing
 * one is a delete, and a field that was never touched costs nothing.
 *
 * localStorage can be missing or refuse (a private window, a test): then this
 * is a memory that lasts as long as the page.
 */
import { reactive } from 'vue';

const KEY = 'spatialdb.tray.fieldFolds';

function load(): Record<string, true> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    return Object.fromEntries(Object.entries(v).filter(([, x]) => x === true)) as Record<string, true>;
  } catch { return {}; }
}
const mine = reactive<Record<string, true>>(load());
function save() { try { localStorage.setItem(KEY, JSON.stringify(mine)); } catch { /* kept for this page only */ } }

const keyOf = (viewId: string, fieldId: string) => `${viewId}:${fieldId}`;

/** Is this field folded for this person, in this view? `viewId` is '' when the tray has no view (then one shared memory). */
export function isFieldFolded(viewId: string, fieldId: string): boolean {
  return mine[keyOf(viewId, fieldId)] === true;
}

export function setFieldFolded(viewId: string, fieldId: string, folded: boolean) {
  const k = keyOf(viewId, fieldId);
  if (folded) mine[k] = true; else delete mine[k];
  save();
}
