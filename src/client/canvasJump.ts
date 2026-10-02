/**
 * "This record has a card on the canvas you are looking at — go to it."
 *
 * A pill that names a record already placed on the open canvas wears a small arrow
 * (RecordPill's `jump`); pressing it pans to that card and selects it. On a canvas
 * card the canvas wires that itself. The record TRAY sits beside the canvas and shows
 * the same pills, but knows nothing about canvases — so the shell (App.vue) provides
 * this, and the tray's pills ask it. With no canvas open, nothing is "placed" and no
 * arrow is drawn.
 */
import type { InjectionKey } from 'vue';

export interface CanvasJump {
  /** Is this record on the canvas that is open right now? */
  placed: (recordId: string) => boolean;
  /** Pan the open canvas to the record's card and select it. */
  jump: (recordId: string) => void;
}
export const CANVAS_JUMP: InjectionKey<CanvasJump> = Symbol('canvas-jump');
