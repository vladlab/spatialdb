<!--
  The navigation tree — the left tray. It replaced the header's dropdowns (section,
  scope, table, canvas), which had become four selects in a row that said nothing
  about how they relate. A tree says it:

      ⌂ Home
      ▸ Computers
      ▾ Projects                    ⚙        a SECTION            (sql/009)
          All
        ▾ Duke                               a SCOPE of it        (contract/scope.ts)
            TABLES                  +
              Files                 ⚙        …the section's tables, seen from inside Duke
              Edits
            CANVASES                +
              Ep 1                           …Duke's boards (boards are records, scoped like any)
          ▸ Elvis
            Unassigned
      ∗ Everything

  ONE section is expanded (the one you are in), and within a scoped section ONE
  scope. Clicking another folder GOES there; this is a navigator, not a file
  browser with independent open/closed state to keep track of.

  The same tables appear under every project, because a table does not belong to
  a project — its ROWS do. "Files, under Duke" is the Files table seen from inside
  Duke. Only one project is ever expanded, so the repetition is never on screen.

  A table row opens that table; a canvas row opens that canvas.

  The breadcrumb in the top bar stays: it is the compact answer to "where am I"
  and still works with this tray closed.
-->
<template>
  <nav class="tree" aria-label="Navigation">
   <div class="tree-scroll">
    <a class="row home" :class="{ on: sectionKey === null }" href="#/"><span class="tw">⌂</span>Home</a>

    <template v-for="s in sections" :key="s.id">
      <div class="row folder section" :class="{ on: sectionKey === s.id }" :data-section="s.id" @click="$emit('go-section', s.id)">
        <span class="tw">{{ sectionKey === s.id ? '▾' : '▸' }}</span>
        <!-- The icon slot exists only when there IS an icon. Reserved-but-empty, it
             pushed an icon-less section's name a slot to the right of its peers. -->
        <span v-if="s.icon" class="icon">{{ s.icon }}</span><span class="name">{{ s.name }}</span>
        <button class="act" title="Section settings" @click.stop="$emit('section-settings', s.id)">⚙</button>
      </div>
      <div v-if="sectionKey === s.id" class="kids">
        <template v-if="scope.available.value">
          <div class="row scope-row" :class="{ on: scope.scope.value.kind === 'all' }" data-scope="" @click="setScope('')">
            <span class="tw">{{ scope.scope.value.kind === 'all' ? '▾' : '▸' }}</span>All {{ scopeTableName }}
          </div>
          <div v-if="scope.scope.value.kind === 'all'" class="well"><slot name="contents" /></div>

          <template v-for="c in scope.choices.value" :key="c.id">
            <div class="row scope-row" :class="{ on: isScope(c.id), archived: c.archived }" :data-scope="c.id" @click="setScope(c.id)">
              <span class="tw">{{ isScope(c.id) ? '▾' : '▸' }}</span><span class="name">{{ c.label }}</span>
              <span v-if="c.archived" class="tag">archived</span>
            </div>
            <div v-if="isScope(c.id)" class="well"><slot name="contents" /></div>
          </template>

          <div class="row scope-row" :class="{ on: scope.scope.value.kind === 'unassigned' }" data-scope="none" @click="setScope('none')">
            <span class="tw">{{ scope.scope.value.kind === 'unassigned' ? '▾' : '▸' }}</span>Unassigned
          </div>
          <div v-if="scope.scope.value.kind === 'unassigned'" class="well"><slot name="contents" /></div>

          <button v-if="scope.archived.value.size" class="row quiet show-archived" @click="scope.showArchived.value = !scope.showArchived.value">
            {{ scope.showArchived.value ? 'hide archived' : `show ${scope.archived.value.size} archived` }}
          </button>
        </template>
        <div v-else class="well"><slot name="contents" /></div>
      </div>
    </template>

    <div class="row folder section everything" :class="{ on: sectionKey === 'all' }" data-section="all" @click="$emit('go-section', 'all')">
      <span class="tw">{{ sectionKey === 'all' ? '▾' : '▸' }}</span><span class="name">Everything</span>
    </div>
    <div v-if="sectionKey === 'all'" class="well"><slot name="contents" /></div>
   </div>

    <!-- The footer: things about the WHOLE app. (A table, a section and a canvas each
         have their own ⚙ where they are listed.) History lives in here. -->
    <footer class="tree-foot">
      <button class="row settings-btn" title="Settings — and History: restore something deleted" @click="$emit('settings')">
        <span class="tw">⚙</span>Settings
      </button>
    </footer>
  </nav>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Store } from '../store';
import { sectionsSorted } from '../state';
import type { ScopeApi } from '../scope';
import { parseScope } from '../../contract/scope';

const props = defineProps<{ store: Store; sectionKey: string | null; scope: ScopeApi }>();
defineEmits<{ 'go-section': [key: string]; 'section-settings': [id: string]; settings: [] }>();

const sections = computed(() => sectionsSorted(props.store.state));
const scopeTableName = computed(() => props.store.state.tables.get(props.scope.scopeTableId.value)?.name ?? '');
const isScope = (id: string) => props.scope.scope.value.kind === 'record' && props.scope.scope.value.id === id;
const setScope = (v: string) => { props.scope.scope.value = parseScope(v); };
</script>

<style scoped>
.tree { width: 240px; flex: none; display: flex; flex-direction: column; border-right: 1px solid var(--border-main); font-size: 13px; user-select: none; }
.tree-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 8px 0; }
.tree-foot { flex: none; border-top: 1px solid var(--border-main); padding: 4px 0; }
.settings-btn .tw { font-size: 12px; }
.row {
  display: flex; align-items: center; gap: 4px; padding: 3px 8px 3px 10px; cursor: pointer; color: var(--text-secondary);
  text-decoration: none; white-space: nowrap; border: none; background: none; font: inherit; width: 100%; box-sizing: border-box; text-align: left;
}
.row:hover { background: var(--bg-surface-hover); color: var(--text-primary); }
.row.on { color: var(--accent); }
.scope-row.on { font-weight: 600; }
.section { font-weight: 600; color: var(--text-primary); margin-top: 2px; }
.tw { width: 14px; flex: none; color: var(--text-faint); font-size: 10px; text-align: center; }
.icon { width: 18px; flex: none; text-align: center; }
.name { overflow: hidden; text-overflow: ellipsis; flex: 1; }
.kids { padding-left: 14px; }
/* THE WELL: what is INSIDE where you are — the deepest unfolded level — sits in a
   recessed box. Indentation alone did not say where the contents of "Duke" ended
   and its sibling "Unassigned" began; a box has an edge. Darker than the tray,
   an inset shadow, a rule in the accent colour down the left. */
.well {
  margin: 2px 8px 8px 22px; padding: 2px 0 6px;
  background: rgba(0, 0, 0, 0.28); border-radius: 6px;
  border-left: 2px solid var(--accent);
  box-shadow: inset 0 2px 5px rgba(0, 0, 0, 0.45), inset 0 0 0 1px rgba(255, 255, 255, 0.03);
}
.act { visibility: hidden; background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 0 2px; font: inherit; font-size: 12px; }
.row:hover .act { visibility: visible; }
.act:hover { color: var(--accent); }
.archived .name { font-style: italic; }
.tag { font-size: 10px; color: var(--text-faint); }
.quiet { color: var(--text-faint); font-size: 11px; padding-left: 28px; }
</style>
