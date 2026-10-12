/**
 * Which field sections THIS person has folded in the record tray.
 *
 * A section's schema says only how it STARTS (`folded`, contract/fieldSections.ts).
 * Folding one is not a schema edit and not anyone else's business, so it is kept
 * here: per browser, in localStorage, keyed by the section's id. Only a choice that
 * DIFFERS from the schema's start is stored — fold a section that starts folded and
 * nothing is remembered — so when the schema's owner changes how a section starts,
 * everyone who never touched it follows.
 *
 * It is per SECTION, not per record: the tray follows the selection from row to
 * row, and a section folded on one file must still be folded on the next.
 *
 * localStorage can be missing or refuse (a private window, a test): then this is
 * simply a memory that lasts as long as the page.
 */
import { reactive } from 'vue';

const KEY = 'spatialdb.tray.folds';

function load(): Record<string, boolean> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    return Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === 'boolean')) as Record<string, boolean>;
  } catch { return {}; }
}
const mine = reactive<Record<string, boolean>>(load());
function save() { try { localStorage.setItem(KEY, JSON.stringify(mine)); } catch { /* kept for this page only */ } }

/** Is this section folded for this person? `startsFolded` is the schema's say. */
export function isFolded(id: string, startsFolded: boolean): boolean {
  return mine[id] ?? startsFolded;
}

export function setFolded(id: string, folded: boolean, startsFolded: boolean) {
  if (folded === startsFolded) delete mine[id]; else mine[id] = folded;
  save();
}
