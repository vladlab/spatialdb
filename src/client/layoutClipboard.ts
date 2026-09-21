/**
 * The copied audio layout — one per browser tab, shared by every layout editor.
 * Kept in the app rather than relying on the system clipboard, which browsers only
 * grant to pages served over HTTPS (or localhost): this has to work on a plain-HTTP
 * LAN too. See AudioLayoutEditor.vue.
 */
import { ref } from 'vue';
import type { AudioLayout } from '../contract/shapes';

export const layoutClipboard = ref<AudioLayout | null>(null);
