/**
 * "Open this record's comparison": the canvas card's compare button (CANVAS-BRIEF.md
 * B4) asks for it, then opens the record in the tray as any double-click does; the
 * tray (RecordPanel.vue) picks the request up for THAT record and opens its side by
 * side. One shared ref, because the two never hold a reference to each other — the
 * canvas only emits "open-record" up to App.
 *
 * Until the compare EXAMINE exists (CANVAS-BRIEF.md C4), this is what the button does.
 */
import { ref } from 'vue';

export const compareRequest = ref<{ ownerId: string; linkId: string; targetId: string } | null>(null);
