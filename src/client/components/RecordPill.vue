<!--
  A PILL: one linked record, drawn the same way everywhere a record's links or
  backlinks are shown — a grid cell, a record tray field, a card row on a canvas, a
  kanban card, the tray's "referenced by". There used to be four renderings (bordered
  chips, italic button chips, plain draggable text lines, joined text), which read as
  four different things when they were all the same thing: a record you can open.

  At REST a pill is just the record's name. When the pointer is over the group it
  sits in (the cell, the field, the card row — the `.pills` container), every name in
  the group becomes a bordered pill; over ONE pill, its actions show: ⤢ (open), and,
  where the link is edited here, × (remove — or, for a junction pair, delete). The
  space for the actions is always reserved, so nothing shifts on hover.

      ⤢            opens the record — ONLY the glyph; a click on the name does nothing
      ✎            a junction pair's: edit its status (`edit`)
      ×            `remove`
      drag         with `drag`, the parent starts a record drag on pointerdown
                   (onto a canvas, to place the record); a still press does nothing

  The styles are global (App.vue `.pills` / `.pill`) so the four surfaces cannot
  drift apart again.
-->
<template>
  <span class="pill" :class="{ back, junction, on }" :title="title"
        @pointerdown.stop="onDown" @mousedown.stop.prevent @click.stop>
    <span class="pill-text">{{ text }}</span>
    <button v-if="junction" class="pill-edit" tabindex="-1" :title="editTitle ?? 'Change this pair\'s status'"
            @pointerdown.stop @mousedown.stop.prevent @click.stop="$emit('edit')">✎</button>
    <button class="pill-open" tabindex="-1" :title="`Open ${text}`"
            @pointerdown.stop @mousedown.stop.prevent @click.stop="$emit('open')">⤢</button>
    <button v-if="removable" class="pill-x" tabindex="-1" :title="removeTitle ?? 'Remove this link'"
            @pointerdown.stop @mousedown.stop.prevent @click.stop="$emit('remove')">×</button>
  </span>
</template>

<script setup lang="ts">
/*
  Only the ⤢ opens the record — a click on the pill's body does nothing, the way a
  column sorts only from its sort glyph and not from anywhere on the header. A pill
  is text you might be selecting or dragging; an action needs its own target.
  Every pill has the ⤢, a junction pair's also a ✎ (change its status here) — and,
  where the link is edited here, the ×.
*/
const props = defineProps<{
  text: string;
  title?: string;
  /** The link is edited here: show ×. */
  removable?: boolean;
  removeTitle?: string;
  /** A backlink's pill — the link lives on the other record (italic, as before). */
  back?: boolean;
  /** A junction pair's pill ("Texted Master › Uploaded"): ✎ edits its status, ⤢ opens the pair row. */
  junction?: boolean;
  editTitle?: string;
  /** Highlighted — the pair being edited. */
  on?: boolean;
  /** The parent starts a drag on pointerdown (onto a canvas, to place the record). */
  drag?: boolean;
}>();
const emit = defineEmits<{ open: []; edit: []; remove: []; down: [e: PointerEvent] }>();
function onDown(e: PointerEvent) { if (props.drag) emit('down', e); }
</script>
