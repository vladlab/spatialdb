<!--
  What is INSIDE the current location of the tree: its tables and its canvases,
  under their own subheaders (the owner's call — "Tables:" and "Canvases:" read
  better than icons alone).

  A separate component from NavTree because the same block appears wherever the
  tree is currently expanded — under a section, under a scope, under Everything —
  and NavTree renders it through a slot.
-->
<template>
  <div class="contents">
    <div class="sub">
      <span>Tables</span>
      <button class="add new-table-btn" title="New table" @click="$emit('new-table')">+</button>
    </div>
    <div v-for="t in tables" :key="t.id" class="row leaf table-row" :class="{ on: view === 'table' && t.id === tableId }"
         :data-table="t.id" @click="$emit('open-table', t.id)">
      <span class="swatch" :style="{ background: t.color || 'var(--border-main)' }" />
      <span class="name">{{ t.icon ? t.icon + ' ' : '' }}{{ t.name }}</span>
      <!-- Same quiet tag language for both facts about a table. "scoped" is in the
           accent colour because it is the one that changes what you SEE. -->
      <span v-if="scopedTableIds?.has(t.id)" class="tag scoped" title="Its rows belong to a project: inside one, this table shows only that project's">scoped</span>
      <span v-if="t.kind === 'canvas'" class="tag" title="A table of boards: each record is a canvas">boards</span>
      <button class="act" title="Table settings" @click.stop="$emit('table-settings', t.id)">⚙</button>
    </div>
    <p v-if="!tables.length" class="empty">none yet</p>

    <div class="sub">
      <span>Canvases</span>
      <button class="add new-canvas-btn" title="New canvas" @click="$emit('new-canvas')">+</button>
    </div>
    <div v-for="c in canvases" :key="c.id" class="row leaf canvas-row" :class="{ on: view === 'canvas' && c.id === canvasId }"
         :data-canvas="c.id" @click="$emit('open-canvas', c.id)">
      <span class="swatch board" />
      <span class="name">{{ c.name }}</span>
      <span v-if="c.cards" class="tag">{{ c.cards }}</span>
    </div>
    <p v-if="!canvases.length" class="empty">none yet</p>
  </div>
</template>

<script setup lang="ts">
import type { TableRow } from '../state';

defineProps<{
  tables: TableRow[];
  canvases: Array<{ id: string; name: string; cards?: number }>;
  view: string; tableId: string; canvasId: string;
  scopedTableIds?: Set<string>;
}>();
defineEmits<{
  'open-table': [id: string]; 'open-canvas': [id: string];
  'table-settings': [id: string]; 'new-table': []; 'new-canvas': [];
}>();
</script>

<style scoped>
.sub {
  display: flex; align-items: center; padding: 8px 8px 2px 10px; font-size: 10px; letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--text-faint);
}
.sub span { flex: 1; }
.add { background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 14px; line-height: 1; padding: 0 4px; }
.add:hover { color: var(--accent); }
.row { display: flex; align-items: center; gap: 6px; padding: 3px 8px 3px 14px; cursor: pointer; color: var(--text-secondary); white-space: nowrap; }
.row:hover { background: var(--bg-surface-hover); color: var(--text-primary); }
.row.on { color: var(--accent); background: var(--bg-surface-hover); }
.swatch { width: 8px; height: 8px; border-radius: 2px; flex: none; }
.swatch.board { border: 1px solid var(--text-faint); background: none; }
.name { overflow: hidden; text-overflow: ellipsis; flex: 1; }
.tag { font-size: 10px; color: var(--text-faint); }
.tag.scoped { color: var(--accent); opacity: 0.85; }
.act { visibility: hidden; background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 0 2px; font: inherit; font-size: 12px; }
.row:hover .act { visibility: visible; }
.act:hover { color: var(--accent); }
.empty { margin: 0; padding: 2px 8px 2px 28px; color: var(--text-faint); font-size: 11px; font-style: italic; }
</style>
