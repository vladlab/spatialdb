<!--
  A rich text value, READ-ONLY. HTML is generated from the stored JSON with the
  same extensions the editor uses, so reading and writing cannot disagree.

  `v-html` is safe here for a reason worth stating: the input is not HTML, it is
  a ProseMirror document rendered through a fixed schema. Only node and mark types
  the extensions define can produce markup, attributes are the ones they whitelist,
  link targets are protocol-checked on write (contract/richtext.ts), and image
  sources are BUILT from an asset id rather than taken from the document.
-->
<template>
  <div class="rich" v-html="html" />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { generateHTML } from '@tiptap/core';
import type { Store } from '../store';
import { richExtensions } from '../richtext/extensions';

const props = defineProps<{ store: Store; value: unknown }>();
const extensions = richExtensions(props.store.assetUrl);

const html = computed(() => {
  try { return props.value ? generateHTML(props.value as Parameters<typeof generateHTML>[0], extensions) : ''; }
  catch { return '<p><em>This note could not be displayed.</em></p>'; }   // a document from a newer schema
});
</script>
