<!--
  The editor for ONE cell, alive only while that cell is being edited.

  It used to be every cell, all the time: the grid was a wall of live inputs.
  Now the grid shows plain values and mounts this when you press Enter (or
  start typing) on the selected cell. That is Airtable's select-vs-edit split,
  and it is what makes the keyboard usable — arrow keys cannot both move between
  cells and move the caret inside one.

  How an edit ENDS is the contract with the grid:

    Enter        commit, then `done('down')`     Tab        commit, `done('right')`
    Shift+Tab    commit, `done('left')`          Escape     `cancel` — nothing written
    blur         commit if valid, else cancel    (clicking elsewhere)

  Rules kept from the old editor, because they are about the DATA:

  - EMPTY MEANS UNSET. The contract rejects nulls (one spelling of "empty": the
    key is absent), so clearing a value emits `unset`, never `set ''`.
  - VALIDATE BEFORE QUEUEING, with the same `validateValue` the server runs. A
    bad value gets a red ring and the editor STAYS OPEN; nothing is written and
    the stored value is untouched. Escape abandons it.
  - A BROWSER REPORTING '' IS NOT THE USER CLEARING THE CELL. `type="number"` and
    `type="date"` inputs both report text they cannot parse as value === '' —
    which this grid would read as "unset", silently erasing what was there.
    Numbers are therefore a text input parsed here; dates check `badInput`.

  And two new ones:

  - NOTHING IS WRITTEN IF NOTHING CHANGED. Walking down a column with Enter must
    not emit a mutation per cell — that is log noise, stream traffic to every
    peer, and a meaningless entry in anyone's audit trail.
  - Text/number/date/select edit a DRAFT and write once, on the way out, so
    Escape really does cancel. multi_select is the exception: each tick writes
    immediately (it is a discrete action, like a checkbox), and Escape just
    closes.

  Checkboxes never reach here (the grid toggles them in place) and neither do
  links (rows in `links`, edited by the grid). Lookups are read-only.
-->
<template>
  <span class="editor" @keydown="onKey">
    <textarea v-if="field.type === 'long_text'" ref="el" v-model="draft" :rows="multiline ? 8 : 1"
              :class="{ invalid, multi: multiline }" :title="invalid || undefined" @blur="onBlur" />

    <select v-else-if="field.type === 'select'" ref="el" v-model="draft"
            :class="{ invalid }" :title="invalid || undefined" @blur="onBlur">
      <option value=""></option>
      <option v-for="c in choices" :key="c" :value="c">{{ c }}</option>
      <!-- A stored value that is no longer among the choices (they were edited
           after it was set) must still be SHOWN, or opening the editor and
           pressing Enter would silently blank it. -->
      <option v-if="draft && !choices.includes(draft)" :value="draft">{{ draft }} (not a choice)</option>
    </select>

    <template v-else-if="field.type === 'multi_select'">
      <span v-for="c in picked" :key="c" class="chip">
        {{ c }}<button class="chip-x" tabindex="-1" :title="`Remove ${c}`" @mousedown.prevent @click="toggle(c)">×</button>
      </span>
      <select ref="el" class="chip-add" :value="''" @blur="onBlur"
              @change="toggle(($event.target as HTMLSelectElement).value)">
        <option value="">+</option>
        <option v-for="c in remaining" :key="c" :value="c">{{ c }}</option>
      </select>
    </template>

    <input v-else-if="field.type === 'date'" ref="el" v-model="draft" type="date"
           :class="{ invalid }" :title="invalid || undefined" @blur="onBlur" />

    <!-- text, file_path, number. Number is type="text" on purpose — see header. -->
    <input v-else ref="el" v-model="draft" type="text"
           :inputmode="field.type === 'number' ? 'decimal' : undefined"
           :class="{ invalid }" :title="invalid || undefined" @blur="onBlur" />
  </span>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import { validateValue, type FieldShape } from '../../contract/values';

export type EditExit = 'down' | 'right' | 'left' | 'none';

const props = defineProps<{
  field: { key: string; type: string; options: Record<string, unknown> };
  value: unknown;
  /** Set when the edit was started by TYPING: the character replaces the value. */
  seed?: string;
  /**
   * long_text with room to breathe (the record panel): Enter is a NEWLINE and
   * Ctrl/Cmd+Enter commits. In the grid's one-line cell Enter commits, as it does
   * for everything else there.
   */
  multiline?: boolean;
}>();
const emit = defineEmits<{
  set: [key: string, value: unknown];
  unset: [key: string];
  done: [exit: EditExit];
  cancel: [];
}>();

const el = ref<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>();
const invalid = ref<string | null>(null);
const shape = computed(() => props.field as FieldShape);

const str = (v: unknown) => (v === undefined || v === null ? '' : String(v));
const draft = ref(props.seed ?? str(props.value));

const choices = computed(() => {
  const c = props.field.options?.choices;
  return Array.isArray(c) ? c.filter((x): x is string => typeof x === 'string') : [];
});
const picked = computed(() =>
  Array.isArray(props.value) ? (props.value as unknown[]).filter((x): x is string => typeof x === 'string') : []);
const remaining = computed(() => choices.value.filter((c) => !picked.value.includes(c)));

/**
 * Exactly one of done/cancel fires, exactly once. Without this, Enter commits
 * and the grid unmounts us — which blurs the input — which commits again.
 */
let finished = false;

onMounted(async () => {
  await nextTick();
  const node = el.value;
  if (!node) return;
  node.focus();
  // Started by Enter: select everything, so typing replaces and arrows refine.
  // Started by typing: the seed is already in; caret goes after it.
  if ('select' in node && !props.seed) node.select();
});

/** Write the draft if it is valid and different. False = invalid, stay open. */
function commit(): boolean {
  if (props.field.type === 'multi_select') return true;   // already written, tick by tick

  const node = el.value as HTMLInputElement | undefined;
  if (node?.validity?.badInput) {
    // A half-typed date. The browser says value === '' — that is NOT "clear".
    invalid.value = `'${props.field.key}' is not a complete date`;
    return false;
  }

  const raw = draft.value.trim();
  if (raw === '') {
    invalid.value = null;
    if (props.value !== undefined) emit('unset', props.field.key);
    return true;
  }
  // Number('12abc') is NaN, which validateValue refuses.
  const next: unknown = props.field.type === 'number' ? Number(raw) : raw;
  const err = validateValue(shape.value, next);
  invalid.value = err;
  if (err) return false;
  if (next !== props.value) emit('set', props.field.key, next);
  return true;
}

function finish(exit: EditExit) {
  if (finished) return;
  if (!commit()) return;          // invalid: red ring, editor stays, focus stays
  finished = true;
  emit('done', exit);
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault(); e.stopPropagation();
    if (!finished) { finished = true; emit('cancel'); }
  } else if (e.key === 'Tab') {
    e.preventDefault(); e.stopPropagation();
    finish(e.shiftKey ? 'left' : 'right');
  } else if (e.key === 'Enter' && !e.isComposing && !(props.multiline && !(e.ctrlKey || e.metaKey))) {
    e.preventDefault(); e.stopPropagation();
    finish('down');
  } else {
    // Everything else — arrows above all — belongs to the input. Stop it here or
    // the grid would move the selection while you move the caret.
    e.stopPropagation();
  }
}

/** Clicking away: keep a valid edit, drop an invalid one rather than trap focus. */
function onBlur() {
  if (finished) return;
  if (commit()) { finished = true; emit('done', 'none'); }
  else { finished = true; emit('cancel'); }
}

function toggle(c: string) {
  if (!c) return;
  const next = picked.value.includes(c)
    ? picked.value.filter((x) => x !== c)
    : [...picked.value, c];
  if (next.length === 0) { invalid.value = null; emit('unset', props.field.key); return; }
  const err = validateValue(shape.value, next);
  invalid.value = err;
  if (!err) emit('set', props.field.key, next);
}
</script>

<style scoped>
.editor { display: flex; align-items: center; gap: 2px; width: 100%; min-width: 0; }
input, textarea, select {
  width: 100%; min-width: 0; background: none; border: none; outline: none;
  color: inherit; font: inherit; padding: 0;
}
textarea { resize: none; height: 1.5em; overflow: hidden; white-space: nowrap; }
textarea.multi { resize: vertical; overflow: auto; white-space: pre-wrap; line-height: 1.4; }
input[type='date'] { color-scheme: dark; }
select option { background: var(--controls-bg); }
.chip-add { width: auto; }
.invalid { box-shadow: 0 0 0 1px var(--danger); border-radius: 2px; }
</style>
