/**
 * THE DOCK (the owner, Nov 23 2026): the right-hand column of OPEN CARDS that replaced
 * the single record tray. A record's full, editable view is a card like any other,
 * only bigger; several can stand side by side.
 *
 *   PINS      cards that stay until their own × — across every view, and across a
 *             reload. Per browser (localStorage), like fold state and the theme.
 *   PREVIEW   one more card, for the record that was just opened (a double-click, a
 *             notice's "open", the palette). The next record opened takes its place.
 *             Pinning it keeps it. It is App's `openRecordId`, as the tray's was — so
 *             the address, the marked row and the marked card work as they did.
 *
 * A record has ONE open card: opening a pinned record does not make a second card, it
 * makes the pinned one current (App scrolls the dock to it).
 *
 * A pin remembers its TABLE: after a reload the record may be in a table this client
 * has not opened yet, and the table is what the store knows how to load.
 */
import { ref } from 'vue';

export interface Pin { id: string; table: string }
const KEY = 'spatialdb.dock.pins';

function read(): Pin[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((p): p is Pin => !!p && typeof p.id === 'string' && typeof p.table === 'string') : [];
  } catch { return []; }
}
function write(list: Pin[]) { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* private mode: pins last the session */ } }

export const pins = ref<Pin[]>(read());
export const isPinned = (id: string) => pins.value.some((p) => p.id === id);
/** The PREVIEW card's record ('' when there is none). Set by App from the record last opened; not saved here — the address carries the open record. */
export const previewId = ref('');
/** Whether a record has an open card in the dock — pinned or the preview. Such a record is not lifted as well. */
export const inDock = (id: string) => isPinned(id) || previewId.value === id;

/** Pin a record: at the END of the row, so no card already there moves. */
export function pin(id: string, table: string) {
  if (!id || isPinned(id)) return;
  pins.value = [...pins.value, { id, table }];
  write(pins.value);
}
export function unpin(id: string) {
  if (!isPinned(id)) return;
  pins.value = pins.value.filter((p) => p.id !== id);
  write(pins.value);
}
/** Records that are gone (deleted here or elsewhere) leave the dock for good. */
export function dropPins(gone: (id: string) => boolean) {
  const kept = pins.value.filter((p) => !gone(p.id));
  if (kept.length !== pins.value.length) { pins.value = kept; write(kept); }
}

/** A card is never narrower than this — or than the dock, when the dock is narrower still. */
export const CARD_MIN = 420;
/** A LIFTED card's width (CardExamine.vue): fixed, whatever the canvas's zoom. */
export const LIFT_W = 460;
