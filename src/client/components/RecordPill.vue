<!--
  A PILL: one linked record, drawn the same way everywhere a record's links or
  backlinks are shown — a grid cell, a record tray field, a card row on a canvas, a
  kanban card, the tray's "referenced by". There used to be four renderings (bordered
  chips, italic button chips, plain draggable text lines, joined text), which read as
  four different things when they were all the same thing: a record you can open.

  At REST a pill is just the record's name. When the pointer is over the group it
  sits in (the cell, the field, the card row — the `.pills` container), every name in
  the group becomes a bordered pill; over ONE pill, its actions show: ⤢ (open) and,
  where the link is edited here, × (remove — or, for a junction pair, delete). The
  space for the actions is always reserved, so nothing shifts on hover.

      click        opens the record (or, with `drag`, is the parent's: a press that
                   does not move is a click there — recordDrag.ts)
      drag         with `drag`, the parent starts a record drag on pointerdown
                   (onto a canvas, to place the record)
      ×            `remove`

  The styles are global (App.vue `.pills` / `.pill`) so the four surfaces cannot
  drift apart again.
-->
<template>
  <span class="pill" :class="{ back, junction, on }" :title="title"
        @pointerdown.stop="onDown" @mousedown.stop.prevent @click.stop="onClick">
    <span class="pill-text">{{ text }}</span>
    <span v-if="!junction" class="pill-open" aria-hidden="true">⤢</span>
    <button v-if="removable" class="pill-x" tabindex="-1" :title="removeTitle ?? 'Remove this link'"
            @pointerdown.stop @mousedown.stop.prevent @click.stop="$emit('remove')">×</button>
  </span>
</template>

<script setup lang="ts">
const props = defineProps<{
  text: string;
  title?: string;
  /** The link is edited here: show ×. */
  removable?: boolean;
  removeTitle?: string;
  /** A backlink's pill — the link lives on the other record (italic, as before). */
  back?: boolean;
  /** A junction pair's pill (status → other end): click edits it, no ⤢. */
  junction?: boolean;
  /** Highlighted — the pair being edited. */
  on?: boolean;
  /** The parent starts a drag on pointerdown and decides what a click does. */
  drag?: boolean;
}>();
const emit = defineEmits<{ open: []; remove: []; down: [e: PointerEvent] }>();
function onDown(e: PointerEvent) { if (props.drag) emit('down', e); }
function onClick() { if (!props.drag) emit('open'); }
</script>
