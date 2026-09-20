<!--
  HOME — the app's front door: one card per section, then "Everything".

  A section is a named part of the app ("Projects", "Computers", "Drives") that
  says which tables belong together. It is NAVIGATION ONLY (sql/009_sections.sql):
  it decides what you are offered, never what exists, and it is not a permission —
  which is why "Everything" is always here and always complete. A table that is in
  no section is not lost; it is under Everything.

  Kept deliberately plain. A home page invites dashboards, counts, recent
  activity; none of that until the basics have settled.
-->
<template>
  <section class="home">
    <header class="home-head">
      <h1>spatialdb</h1>
      <p class="muted">Pick a section. Links, lookups and search cross sections freely — a section only decides what you are offered first.</p>
    </header>

    <div class="cards">
      <article v-for="s in sections" :key="s.id" class="card" :style="{ borderTopColor: s.color || 'var(--border-main)' }"
               tabindex="0" @click="$emit('open', s.id)" @keydown.enter="$emit('open', s.id)">
        <div class="card-top">
          <span class="icon">{{ s.icon || '▦' }}</span>
          <h2>{{ s.name }}</h2>
          <button v-if="isAdmin" class="gear" title="Section settings" @click.stop="editing = s.id">⚙</button>
        </div>
        <p v-if="s.description" class="desc">{{ s.description }}</p>
        <p class="meta">
          {{ tableNames(s).length }} table{{ tableNames(s).length === 1 ? '' : 's' }}<template v-if="tableNames(s).length">: {{ tableNames(s).slice(0, 5).join(', ') }}<template v-if="tableNames(s).length > 5">…</template></template>
        </p>
        <p v-if="scopeName(s)" class="meta scope">scoped by {{ scopeName(s) }}</p>
        <!-- Straight to one project. Only what is already loaded is listed (the scope
             table arrives when its section is first opened), and archived ones are
             left out: this is a front door, not an index. -->
        <p v-if="scopesOf(s).length" class="scopes">
          <a v-for="sc in scopesOf(s).slice(0, 8)" :key="sc.id" class="scope-link" :href="scopeHref(s, sc.id)" @click.stop>{{ sc.label }}</a>
          <span v-if="scopesOf(s).length > 8" class="meta">+{{ scopesOf(s).length - 8 }}</span>
        </p>
      </article>

      <article class="card everything" tabindex="0" @click="$emit('open', 'all')" @keydown.enter="$emit('open', 'all')">
        <div class="card-top"><span class="icon">∗</span><h2>Everything</h2></div>
        <p class="desc">Every table and canvas, whatever section it is in — or none.</p>
        <p class="meta">{{ store.state.tables.size }} table{{ store.state.tables.size === 1 ? '' : 's' }}<template v-if="unfiled"> · {{ unfiled }} in no section</template></p>
      </article>

      <button v-if="isAdmin" class="card new" @click="create">+ new section</button>
    </div>

    <SectionSettings v-if="editing" :store="store" :section-id="editing" @close="editing = ''" />
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useDerived } from '../derived';
import { ask } from '../dialogs';
import { formatRoute } from '../router';
import type { Store } from '../store';
import { recordsOf, sectionsSorted, tablesOfSection, type SectionRow } from '../state';
import SectionSettings from './SectionSettings.vue';

const props = defineProps<{ store: Store; isAdmin?: boolean }>();
defineEmits<{ open: [sectionId: string] }>();

const editing = ref('');
const sections = computed(() => sectionsSorted(props.store.state));
const tableNames = (s: SectionRow) => tablesOfSection(props.store.state, s).map((t) => t.name);
const scopeName = (s: SectionRow) => (s.scope_table_id ? props.store.state.tables.get(s.scope_table_id)?.name : '');

const derived = useDerived(props.store);
function scopesOf(s: SectionRow) {
  if (!s.scope_table_id) return [];
  const arch = s.archived_field_id ? props.store.state.fields.get(s.archived_field_id)?.key : undefined;
  return recordsOf(props.store.state, s.scope_table_id)
    .filter((r) => !(arch && r.data[arch] === true))
    .map((r) => ({ id: r.id, label: derived.labelOfId(r.id) }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
}
const scopeHref = (s: SectionRow, scopeId: string) =>
  formatRoute({ section: s.id, view: 'table', target: '', record: '', scope: scopeId }, s.name);
// So the entry points are there on a cold start, not only after visiting the section.
watch(sections, (list) => { for (const s of list) if (s.scope_table_id) void props.store.loadTable(s.scope_table_id); }, { immediate: true });

const unfiled = computed(() => {
  const filed = new Set(sections.value.flatMap((s) => s.table_ids));
  return [...props.store.state.tables.keys()].filter((id) => !filed.has(id)).length;
});

async function create() {
  const name = await ask({ title: 'New section', label: 'Name', placeholder: 'Projects, Computers, Drives…' });
  if (!name) return;
  const id = crypto.randomUUID();
  props.store.mutate({ type: 'section.create', id, name, description: '', icon: '', color: '' });
  editing.value = id;      // a new section is empty; choosing its tables is the next thing to do
}
</script>

<style scoped>
.home { flex: 1; overflow: auto; padding: 32px 40px; }
.home-head h1 { margin: 0 0 4px; font-size: 22px; }
.muted { color: var(--text-muted); margin: 0 0 24px; max-width: 640px; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; }
.card {
  background: var(--controls-bg); border: 1px solid var(--border-main); border-top: 3px solid var(--border-main);
  border-radius: 8px; padding: 14px 16px; cursor: pointer; outline: none; text-align: left; min-height: 120px;
}
.card:hover, .card:focus { border-color: var(--accent); }
.card-top { display: flex; align-items: center; gap: 8px; }
.card h2 { margin: 0; font-size: 16px; flex: 1; }
.icon { font-size: 18px; width: 22px; text-align: center; }
.gear { background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 13px; visibility: hidden; }
.card:hover .gear { visibility: visible; }
.gear:hover { color: var(--accent); }
.desc { margin: 8px 0 0; color: var(--text-secondary); font-size: 13px; }
.meta { margin: 8px 0 0; color: var(--text-muted); font-size: 12px; }
.scope { color: var(--accent); }
.scopes { margin: 8px 0 0; display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.scope-link { font-size: 12px; color: var(--text-primary); text-decoration: none; border: 1px solid var(--border-main); border-radius: 10px; padding: 1px 8px; }
.scope-link:hover { border-color: var(--accent); color: var(--accent); }
.everything { border-style: dashed; }
.new { border-style: dashed; color: var(--text-muted); font: inherit; display: flex; align-items: center; justify-content: center; }
</style>
