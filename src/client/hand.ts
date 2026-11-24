/**
 * THE HAND (the owner, Nov 23 2026 — card-table terms): the records you are keeping
 * track of, from any table, as a strip of STUBS along the bottom of every view. It
 * replaced the dock of the same afternoon, which made one thing do two jobs: keeping a
 * record meant keeping its whole editor open. A stub costs a few characters.
 *
 * A record's OPEN CARD (RecordPanel) is in one of two places, never both:
 *
 *   UP       lifted over the view (CardExamine.vue), one or many: to look, to edit, to
 *            place, to pin. Any record can be brought up — from the hand, a canvas card,
 *            a grid row, the palette. Put down, a record that is not in the hand just
 *            goes away; keeping it is a choice (its "hand" chip, a drag to the strip, H).
 *   PINNED   floating at the right, ABOVE the view (which does not resize under it), so
 *            you can work beside it. A pinned record is always in the hand: unpinning
 *            sends it back to its stub, and nothing is lost by clearing the view.
 *
 * The stub never leaves the hand while its card is up or pinned — it is marked, so
 * nothing in the strip moves when a card comes and goes.
 *
 * The hand holds REFERENCES: a record in it is still on its canvases and in its table.
 * Per browser (localStorage), like fold state and the theme; on every view; across a
 * reload. An entry remembers its TABLE: after a reload the record may be in a table
 * this client has not opened, and the table is what the store knows how to load.
 */
import { ref } from 'vue';

export interface Held { id: string; table: string; pinned?: boolean }
const KEY = 'spatialdb.hand';

function read(): Held[] {
  const ok = (p: unknown): p is Held => !!p && typeof (p as Held).id === 'string' && typeof (p as Held).table === 'string';
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (Array.isArray(raw)) return raw.filter(ok);
    // The dock's pins (the same day's earlier build) become pinned cards in the hand.
    const old = JSON.parse(localStorage.getItem('spatialdb.dock.pins') ?? '[]');
    return Array.isArray(old) ? old.filter(ok).map((p) => ({ id: p.id, table: p.table, pinned: true })) : [];
  } catch { return []; }
}
function write() { try { localStorage.setItem(KEY, JSON.stringify(hand.value)); } catch { /* private mode: the hand lasts the session */ } }

export const hand = ref<Held[]>(read());
export const inHand = (id: string) => hand.value.some((h) => h.id === id);
export const isPinned = (id: string) => hand.value.some((h) => h.id === id && h.pinned);

/** Into the hand: at the END of the strip, so no stub already there moves. */
export function hold(id: string, table: string) {
  if (!id || inHand(id)) return;
  hand.value = [...hand.value, { id, table }];
  write();
}
/** Out of the hand — and so unpinned: a pinned card is always a held one. */
export function drop(id: string) {
  if (!inHand(id)) return;
  hand.value = hand.value.filter((h) => h.id !== id);
  write();
}
export function toggleHeld(id: string, table: string) { if (inHand(id)) drop(id); else hold(id, table); }
/** Pin: the card floats at the right. A record not in the hand yet joins it — that is where it returns to. */
export function pin(id: string, table: string) {
  if (!id) return;
  hand.value = inHand(id) ? hand.value.map((h) => (h.id === id ? { ...h, pinned: true } : h)) : [...hand.value, { id, table, pinned: true }];
  lifted.value = lifted.value.filter((x) => x !== id);   // one open card per record
  write();
}
/** Unpin: back to its stub. */
export function unpin(id: string) {
  if (!isPinned(id)) return;
  hand.value = hand.value.map((h) => (h.id === id ? { id: h.id, table: h.table } : h));
  write();
}
/** Records that are gone (deleted here or elsewhere) leave the hand for good. */
export function dropGone(gone: (h: Held) => boolean) {
  const kept = hand.value.filter((h) => !gone(h));
  if (kept.length !== hand.value.length) { hand.value = kept; write(); }
}

/* ── UP: the line of lifted cards ──────────────────────────────────────────
   App-wide and not saved: what is lifted is a moment, not a setting. */
export const lifted = ref<string[]>([]);
export const isUp = (id: string) => lifted.value.includes(id);
/** Bring a record up. `add`: beside what is up already (at the right, once); otherwise it replaces the line. A pinned record has its card already and is not lifted as well — the caller rings it. */
export function lift(id: string, add = false): boolean {
  if (!id || isPinned(id)) return false;
  if (isUp(id)) return true;
  lifted.value = add ? [...lifted.value, id] : [id];
  return true;
}
export function putDown(id: string) { lifted.value = lifted.value.filter((x) => x !== id); }
export function putAllDown() { lifted.value = []; }

/** An open card's width, lifted or pinned: fixed, whatever the canvas's zoom. */
export const CARD_W = 460;
/** A pinned card's: a little narrower — it is beside your work, not the work. */
export const PIN_W = 400;

/* ── a lifted card being DRAGGED to the hand ───────────────────────────────
   The strip shows itself as a drop target while this is set — even when it is empty. */
export const handDrag = ref<{ id: string; x: number; y: number; over: boolean } | null>(null);
