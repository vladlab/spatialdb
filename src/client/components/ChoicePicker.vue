<!--
  A SEARCHING picker for a select's choices — what a native <select> is not: type to
  filter (fuzzy: "prs4" finds "ProRes 4444"), ↑↓ to move, Enter to pick, Escape to
  give up. Used by CellEditor for select and multi_select, in the grid and the tray,
  so a vocabulary of a hundred codecs is as quick to set as a yes/no.

  It owns the keys that MEAN something inside the list (arrows, Enter, Escape) and
  lets everything else — Tab, in particular — bubble to CellEditor, which knows how
  to leave a cell. On Tab it first picks the highlighted choice (synchronously, so
  the parent's handler sees the new draft).
-->
<template>
  <div class="cp">
    <input ref="input" class="cp-input" :value="query" :placeholder="placeholder" spellcheck="false"
           @input="query = ($event.target as HTMLInputElement).value" @keydown="onKey" @blur="$emit('blur')" />
    <ul v-if="ranked.length" class="cp-list" role="listbox">
      <li v-for="(c, i) in ranked.slice(0, 40)" :key="c" class="cp-item" :class="{ hi: i === hi, current: c === current }" role="option"
          @mousedown.prevent="pick(c)" @mousemove="hi = i">{{ c }}<span v-if="c === current" class="cp-tick">✓</span></li>
    </ul>
    <p v-else class="cp-none">{{ query ? 'no choice matches' : 'no choices' }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { rankChoices } from '../fuzzy';

const props = defineProps<{
  choices: string[];
  /** The value currently set (shown ticked, and preselected when nothing is typed). */
  current?: string;
  /** Typed to open the editor: becomes the query. */
  seed?: string;
  placeholder?: string;
}>();
const emit = defineEmits<{ pick: [value: string]; escape: []; blur: [] }>();

const input = ref<HTMLInputElement>();
const query = ref(props.seed ?? '');
const ranked = computed(() => rankChoices(query.value, props.choices));
// With nothing typed, the highlight starts on the CURRENT value, so Enter-Enter is a no-op.
const hi = ref(Math.max(0, props.current ? props.choices.indexOf(props.current) : 0));
watch(query, () => { hi.value = 0; });

function pick(c: string) { emit('pick', c); }
function onKey(e: KeyboardEvent) {
  switch (e.key) {
    case 'ArrowDown': e.preventDefault(); e.stopPropagation(); hi.value = Math.min(ranked.value.length - 1, hi.value + 1); return;
    case 'ArrowUp': e.preventDefault(); e.stopPropagation(); hi.value = Math.max(0, hi.value - 1); return;
    case 'Enter': {
      e.preventDefault(); e.stopPropagation();
      const c = ranked.value[hi.value];
      if (c) pick(c); else if (!query.value.trim()) emit('pick', '');   // Enter on an empty query with nothing to pick: clear
      return;
    }
    case 'Escape': e.preventDefault(); e.stopPropagation(); emit('escape'); return;
    case 'Tab': { const c = ranked.value[hi.value]; if (c && (query.value.trim() || c !== props.current)) pick(c); return; }   // then bubbles: the cell moves on
    default: return;
  }
}
defineExpose({ focus: () => input.value?.focus(), select: () => input.value?.select(), clear: () => { query.value = ''; hi.value = 0; } });
</script>

<style scoped>
.cp { position: relative; width: 100%; }
.cp-input { width: 100%; box-sizing: border-box; background: var(--controls-bg); border: 1px solid var(--accent); color: var(--text-primary); border-radius: 3px; padding: 2px 6px; font: inherit; outline: none; }
.cp-list { position: absolute; left: 0; top: calc(100% + 2px); z-index: 60; min-width: 100%; max-height: 260px; overflow-y: auto; margin: 0; padding: 4px 0; list-style: none;
  background: var(--controls-bg); border: 1px solid var(--border-main); border-radius: 4px; box-shadow: var(--card-shadow-drag); }
.cp-item { padding: 4px 10px; cursor: pointer; white-space: nowrap; display: flex; gap: 8px; justify-content: space-between; }
.cp-item.hi { background: var(--bg-surface-hover); color: var(--accent); }
.cp-item.current { font-weight: 600; }
.cp-tick { color: var(--success); }
.cp-none { position: absolute; left: 0; top: calc(100% + 2px); z-index: 60; margin: 0; padding: 4px 10px; color: var(--text-faint); font-size: 11px; background: var(--controls-bg); border: 1px solid var(--border-main); border-radius: 4px; white-space: nowrap; }
</style>
