<!--
  App shell. Four views over one store: the canvas (phase 2), the grid and the
  schema editor (phase 3), and the undo list.

  The store is created once here and passed down. Everything below it reads the
  same reactive state, so a card moved on the canvas and a row edited in the table
  are the same record — which is the whole premise of placement-as-relation.
-->
<template>
  <!--
    THE SHELL.

      top bar      where you are (breadcrumb) · find · undo/redo · status
      tree         sections › scopes › TABLES / CANVASES, and a Settings footer.
                   It IS the navigation: there are no Canvas/Table tabs. They were
                   added with the tree and lasted a day — once the tree lists tables
                   and canvases, what you clicked already says which you are looking
                   at, and the tabs only repeated it. (History moved into Settings.)
      context bar  belongs to what is OPEN: the grid's views/sort/filter, the
                   canvas's zoom/arrows/dock. Inside GridView / CanvasView, at the top.
      viewport     the grid or the canvas
      record tray  RIGHT, and it takes its own space — it shrinks the viewport
                   rather than floating over it, so the grid's "+" column stays
                   reachable and "fit" fits what you can actually see.

    It replaced a single header row that had grown four dropdowns (section, scope,
    table, canvas), four buttons dressed as tabs, and a status readout whose width
    changed — which is what made the whole header twitch on every write.
  -->
  <!-- Until the server says who you are, the app IS the login screen. -->
  <LoginPage v-if="store.auth.value === 'out' || store.auth.value === 'setup'" :store="store" />
  <div v-else-if="store.auth.value === 'in'" class="app">
    <header class="topbar">
      <button class="ghost tree-toggle" :class="{ on: treeOpen }" title="Show or hide the navigation tree" @click="treeOpen = !treeOpen">☰</button>
      <nav class="crumbs" aria-label="Breadcrumb">
        <a class="crumb home-crumb" href="#/" title="Home — all sections">spatialdb</a>
        <template v-if="sectionKey !== null">
          <span class="sep">›</span>
          <span class="crumb section-crumb">{{ section ? (section.icon ? section.icon + ' ' : '') + section.name : '∗ Everything' }}</span>
          <template v-if="scopeApi.available.value">
            <span class="sep">›</span>
            <span class="crumb scope-crumb" :class="{ narrowed: scopeApi.scope.value.kind !== 'all' }">{{ scopeApi.scope.value.kind === 'all' ? `All ${scopeTableName}` : scopeApi.label.value }}</span>
          </template>
          <template v-if="currentName">
            <span class="sep">›</span>
            <span class="crumb leaf-crumb">{{ currentName }}</span>
          </template>
        </template>
      </nav>

      <span class="spacer" />
      <button class="ghost find" title="Find any record (Ctrl+K)" @click="paletteOpen = true">⌕ find</button>
      <button class="ghost hist" :disabled="!store.canUndo.value" title="Undo (Ctrl+Z)" @click="store.undoLast()">↶</button>
      <button class="ghost hist" :disabled="!store.canRedo.value" title="Redo (Ctrl+Shift+Z)" @click="store.redoLast()">↷</button>
      <!-- FIXED WIDTH. This used to be three spans that came and went ("3 queued",
           "1 in flight"), and every write shoved the rest of the header sideways. -->
      <span class="status" :class="store.streamState.value" :title="`seq ${store.lastSeq.value}`">
        <span class="dot" />
        <span class="status-text">{{ statusText }}</span>
      </span>
    </header>

    <div class="body">
      <NavTree v-if="treeOpen" :store="store" :section-key="sectionKey" :scope="scopeApi"
               @go-section="goSection" @section-settings="sectionSettings = $event" @settings="settingsOpen = true">
        <template #contents>
          <NavContents :tables="tables" :canvases="canvasRows" :view="view" :table-id="tableId" :canvas-id="canvasId"
                       :dock-table-id="dockShown ? tableId : ''" :scoped-table-ids="scopedTableIds"
                       @open-table="openTable" @open-canvas="openBoard" @dock-table="dockTable"
                       @table-settings="tableSettings = $event" @new-table="newTable" @new-canvas="newCanvas" />
        </template>
      </NavTree>

      <div class="main">
        <HomePage v-if="sectionKey === null" :store="store" :is-admin="store.me.value?.role === 'admin'" @open="goSection" />
        <template v-else>
          <div class="stage">
            <div class="viewport">
              <div v-if="view === 'canvas' && canvasId" class="workspace" :class="[`dock-${dock.side}`, { docked: dockShown }]">
                <div v-if="dockShown" class="dock" :style="dock.side === 'left' ? { width: dock.size + 'px' } : { height: dock.size + 'px' }">
                  <GridView v-if="tableId" :key="'dock' + tableId" :store="store" :table-id="tableId"
                            :placed-ids="canvasRef?.placedIds" @open-record="openRecordId = $event" @open-board="openBoard" />
                  <p v-else class="hint">Pick a table in the tree (◧ on its row).</p>
                </div>
                <div v-if="dockShown" class="splitter" title="Drag to resize" @pointerdown="startDockResize" />
                <CanvasView ref="canvasRef" :key="canvasId" :store="store" :canvas-id="canvasId"
                            @open-record="openRecordId = $event" @open-board="openBoard">
                  <!-- The canvas's context bar is inside CanvasView; these two belong to
                       the app (the dock is laid out here), so they are passed in. -->
                  <template #bar-extra>
                    <span class="sep" />
                    <button class="dock-toggle" :class="{ on: dock.open }" title="Show a table beside the canvas (Ctrl+B)" @click="toggleDock">▤ table</button>
                    <button v-if="dock.open" class="dock-side" :title="`The table is on the ${dock.side}. Click to move it (Ctrl+Shift+B)`" @click="flipDock">{{ dock.side === 'left' ? '⬓' : '◧' }}</button>
                  </template>
                </CanvasView>
              </div>
              <p v-else-if="view === 'canvas'" class="hint">No canvas open — pick one in the tree, or press + beside “Canvases” to make one.</p>

              <!-- Keyed by table so switching tables is a fresh component: scroll
                   position, search text and the "rows I just made" set all reset. -->
              <GridView v-if="view === 'table' && tableId" :key="tableId" :store="store" :table-id="tableId"
                        @open-record="openRecordId = $event" @open-board="openBoard" />
              <p v-else-if="view === 'table'" class="hint">No table open — pick one in the tree, or press + beside “Tables” to make one.</p>

            </div>

            <!-- A TRAY, not a float: a flex sibling of the viewport, so opening it
                 makes the viewport narrower instead of covering its right edge. -->
            <template v-if="openRecordId && (view === 'canvas' || view === 'table')">
              <div class="tray-splitter" title="Drag to resize" @pointerdown="startTrayResize" />
              <RecordPanel :store="store" :record-id="openRecordId" :style="{ width: trayWidth + 'px' }"
                           @close="openRecordId = ''" @open="openRecordId = $event" @open-board="openBoard" />
            </template>
          </div>
        </template>
      </div>
    </div>

    <SectionSettings v-if="sectionSettings" :store="store" :section-id="sectionSettings" @close="sectionSettings = ''" />
    <SettingsDialog v-if="settingsOpen" :store="store" @close="settingsOpen = false" />
    <TableSettings v-if="tableSettings" :store="store" :table-id="tableSettings" @close="tableSettings = ''" />

    <!-- What is being dragged, following the pointer. One ghost for every source. -->
    <div v-if="dragGhost.active" class="drag-ghost" :class="{ over: dragGhost.over }"
         :style="{ left: dragGhost.x + 'px', top: dragGhost.y + 'px' }">
      {{ dragGhost.label }}<span v-if="dragGhost.count > 1" class="drag-count">{{ dragGhost.count }}</span>
    </div>

    <CommandPalette v-if="paletteOpen" :store="store" :can-place="view === 'canvas' && !!canvasId"
                    :placed-ids="canvasRef?.placedIds" :prefer-tables="section ? new Set(section.table_ids) : undefined" :scope-params="scopeApi.searchParams()" :scope-label="scopeApi.scope.value.kind === 'record' ? scopeApi.label.value : ''" @close="closePalette" @choose="onPaletteChoose" />

    <DialogHost />

    <div v-if="store.errors.value.length" class="errors">
      <div v-for="(e, i) in store.errors.value.slice(0, 5)" :key="i">{{ e }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, provide, reactive, ref, watch } from 'vue';
import { SCOPE, useScope } from './scope';
import { formatScope, parseScope } from '../contract/scope';
import { dragGhost } from './recordDrag';
import { createStore } from './store';
import { boardsOf, isBoardsTable, tablesOfSection } from './state';
import { useDerived } from './derived';
import { formatRoute, parseRoute, sameRoute, type Route, type ViewName } from './router';
import HomePage from './components/HomePage.vue';
import SectionSettings from './components/SectionSettings.vue';
import CanvasView from './components/CanvasView.vue';
import GridView from './components/GridView.vue';
import RecordPanel from './components/RecordPanel.vue';
import CommandPalette from './components/CommandPalette.vue';
import type { RecordRow } from './state';
import { useSchemaActions } from './schemaActions';
import NavTree from './components/NavTree.vue';
import NavContents from './components/NavContents.vue';
import TableSettings from './components/TableSettings.vue';
import SettingsDialog from './components/SettingsDialog.vue';
import DialogHost from './components/DialogHost.vue';
import LoginPage from './components/LoginPage.vue';
import { askFull } from './dialogs';

const store = createStore();
const schema = useSchemaActions(store);
/** The record shown in the side panel, or ''. Opened by the grid and by the canvas. */
const openRecordId = ref('');
/** What the main area shows. Set by what you open in the tree — there is no tab for it. */
const view = ref<ViewName>('table');
const settingsOpen = ref(false);
/* ── shell state: per browser, because it is about this screen ───────────── */
const readLocal = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const writeLocal = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* unavailable */ } };
const treeOpen = ref(readLocal('spatialdb.tree', '1') === '1');
watch(treeOpen, (v) => writeLocal('spatialdb.tree', v ? '1' : '0'));
const tableSettings = ref('');

const trayWidth = ref(Math.max(320, Number(readLocal('spatialdb.tray', '460')) || 460));
function startTrayResize(e: PointerEvent) {
  e.preventDefault();
  const start = trayWidth.value, x0 = e.clientX;
  const move = (ev: PointerEvent) => { trayWidth.value = Math.round(Math.min(Math.max(start + (x0 - ev.clientX), 320), window.innerWidth - 360)); };
  const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); writeLocal('spatialdb.tray', String(trayWidth.value)); };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

/** ONE fixed-width readout. Writes in progress are said in words, not as a badge that appears. */
const statusText = computed(() => {
  const st = store.streamState.value;
  if (st !== 'connected') return st;
  const n = store.pending.value.length + store.inflight.value.length;
  return n ? `saving ${n}…` : 'saved';
});
const canvasId = ref<string>('');
const tableId = ref<string>('');

/* ── sections: where you are ──────────────────────────────────────────────
   null = the home page · 'all' = Everything · otherwise a section id.
   A section decides what the pickers OFFER; nothing else (sql/009_sections.sql). */
const sectionKey = ref<string | 'all' | null>(null);
const sectionSettings = ref('');
const section = computed(() => (sectionKey.value && sectionKey.value !== 'all' ? store.state.sections.get(sectionKey.value) ?? null : null));

const tables = computed(() => tablesOfSection(store.state, section.value));
// Sorted by name so the list is scannable and stable — insertion order meant the
// picker reshuffled whenever a peer created one.
/* ── boards ───────────────────────────────────────────────────────────────
   A canvas is a RECORD in a table of kind 'canvas' (sql/010_boards.sql). So the
   picker lists records — named by their primary field, like any record — from the
   boards tables of the current section; under Everything, from all of them.
   Filing a board under a section is nothing more than which table it is in. */
const derived = useDerived(store);

/* ── scope: the second breadcrumb level ───────────────────────────────────
   client/scope.ts. Provided to every component below, so the grid, the canvas,
   the link picker and the palette all ask the SAME object. */
const scopeApi = useScope(store, section, derived.labelOfId);
provide(SCOPE, scopeApi);
const scopeTableName = computed(() => store.state.tables.get(scopeApi.scopeTableId.value)?.name ?? '');
const boardTables = computed(() => tables.value.filter(isBoardsTable));
const canvases = computed(() => {
  const ids = new Set(boardTables.value.map((t) => t.id));
  return boardsOf(store.state, ids)
    // A board is a record: it is scoped by its own membership link, like any other.
    .filter((r) => scopeApi.filterFor(r.table_id)?.(r) ?? true)
    .map((r) => ({ id: r.id, tableId: r.table_id, name: derived.labelOfId(r.id) }))
    // By name: scannable, and stable when a peer adds one.
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
});
/** Cards on a canvas, so the picker distinguishes a real board from an empty one. */
function cardCount(id: string) {
  let n = 0;
  for (const p of store.state.placements.values()) if (p.canvas_id === id) n++;
  return n;
}

/** The same createTable the schema designer uses — see schemaActions.ts. */
async function newTable() {
  const r = await askFull({
    title: 'New table', label: 'Name', placeholder: 'Files, Edits, Deliverables…',
    checkboxes: [{ key: 'boards', label: 'A table of boards',
      hint: 'Every record in it is a canvas — with fields and links like any record. Cannot be changed later.' }],
  });
  // Ask FIRST, mutate after: everything below is one synchronous run, so the
  // table, its first field and its filing under the section are one Ctrl+Z.
  const id = r ? schema.createTable(r.value, r.checks.boards ? 'canvas' : 'records') : null;
  if (!id) return;
  fileTable(id);
  openTable(id);
}
/**
 * A table made INSIDE a section belongs to it — same tick as the create, so it is
 * one Ctrl+Z. Made under Everything it is in no section, which is fine: Everything
 * is where unfiled tables live.
 */
function fileTable(id: string) {
  const s = section.value;
  if (s && !s.table_ids.includes(id)) store.mutate({ type: 'section.update', id: s.id, tableIds: [...s.table_ids, id] });
}

/**
 * "+ canvas": a new RECORD in a boards table. If the section has no boards table
 * yet, one is made first — "Boards", with a Name — and filed under the section.
 * All in one synchronous run, so the whole thing is one Ctrl+Z.
 */
async function newCanvas() {
  const many = boardTables.value.length > 1;
  const r = await askFull({
    title: 'New canvas', label: 'Name',
    // Which KIND of board — asked only when there is a real choice.
    ...(many ? { select: { label: 'In', options: boardTables.value.map((t) => ({ value: t.id, label: t.name })), initial: boardTables.value[0].id } } : {}),
  });
  const name = r?.value.trim();
  if (!name) return;
  let table = (many ? boardTables.value.find((t) => t.id === r!.choice) : undefined) ?? boardTables.value[0];
  let nameKey = 'name';
  if (!table) {
    const tableId_ = crypto.randomUUID();
    const pos = Math.max(0, ...[...store.state.tables.values()].map((t) => t.position ?? 0)) + 1;
    store.mutate({ type: 'table.create', id: tableId_, name: 'Boards', singularName: 'Board', color: '', icon: '', kind: 'canvas' });
    store.mutate({ type: 'table.update', id: tableId_, position: pos });
    store.mutate({ type: 'field.create', id: crypto.randomUUID(), tableId: tableId_, name: 'Name', key: 'name', fieldType: 'text', options: {}, required: false });
    fileTable(tableId_);
    table = store.state.tables.get(tableId_)!;
  } else {
    // The board's name goes in the table's PRIMARY field, whatever it is called.
    nameKey = derived.labelKeys.value.get(table.id) ?? 'name';
  }
  const id = crypto.randomUUID();
  scopeApi.createRecord(table.id, { [nameKey]: name }, id);   // …and into the scoped project, if there is one
  openBoard(id);
}
/**
 * Tables the current section's scope actually narrows: the ones with a membership
 * link to its scope table. Marked "scoped" in the tree, so it is visible BEFORE you
 * open one which tables follow you into a project and which are shown whole.
 */
const scopedTableIds = computed(() => new Set(scopeApi.available.value
  ? tables.value.filter((t) => scopeApi.membershipField(t.id)).map((t) => t.id) : []));

/** The tree's canvas rows: name plus a card count, where one is known. */
const canvasRows = computed(() => canvases.value.map((c) => ({ id: c.id, name: c.name, cards: cardCount(c.id) || undefined })));
/** The last crumb: the table or canvas you are looking at. */
const currentName = computed(() => (view.value === 'table' ? store.state.tables.get(tableId.value)?.name
  : canvases.value.find((c) => c.id === canvasId.value)?.name) ?? '');

function openTable(id: string) { tableId.value = id; view.value = 'table'; }
/** ◧ in the tree, on the Canvas tab: that table, beside the canvas. */
function dockTable(id: string) { tableId.value = id; dock.open = true; }

/** From a grid row, a card or the record panel: go to that board. */
function openBoard(id: string) {
  openRecordId.value = '';
  canvasId.value = id;
  view.value = 'canvas';
}
/* ── the docked grid ─────────────────────────────────────────────────────────

   Beside (left) or below (bottom) the canvas; which one suits depends on the
   table — a wide table wants the full width of the bottom, a long one the height
   of the side — so it flips with one key rather than being a setting somewhere.
   Open/closed, side and size are remembered PER BROWSER: they are about this
   screen, not about the data. */
interface Dock { open: boolean; side: 'left' | 'bottom'; size: number }
const DOCK_KEY = 'spatialdb.dock';
function readDock(): Dock {
  try {
    const d = JSON.parse(localStorage.getItem(DOCK_KEY) ?? '{}') as Partial<Dock>;
    return { open: d.open === true, side: d.side === 'bottom' ? 'bottom' : 'left', size: Number(d.size) > 120 ? Number(d.size) : 460 };
  } catch { return { open: false, side: 'left', size: 460 }; }
}
const dock = reactive<Dock>(readDock());
const dockShown = computed(() => dock.open && view.value === 'canvas');
watch(dock, (d) => { try { localStorage.setItem(DOCK_KEY, JSON.stringify(d)); } catch { /* unavailable */ } }, { deep: true });

function toggleDock() { dock.open = !dock.open; }
function flipDock() {
  dock.side = dock.side === 'left' ? 'bottom' : 'left';
  // A width that suits a side dock is far too tall for a bottom one, and vice versa.
  dock.size = dock.side === 'left' ? 460 : 300;
}
function startDockResize(e: PointerEvent) {
  e.preventDefault();
  const start = dock.size, x0 = e.clientX, y0 = e.clientY;
  const move = (ev: PointerEvent) => {
    // Left dock grows rightwards; bottom dock grows UPwards.
    const d = dock.side === 'left' ? ev.clientX - x0 : y0 - ev.clientY;
    const max = (dock.side === 'left' ? window.innerWidth : window.innerHeight) - 160;
    dock.size = Math.round(Math.min(Math.max(start + d, 160), Math.max(200, max)));
  };
  const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}
function onDockKey(e: KeyboardEvent) {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.key.toLowerCase() !== 'b' || view.value !== 'canvas') return;
  const t = e.target as HTMLElement | null;
  // In a text field Ctrl+B is (or will be) bold.
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  e.preventDefault();
  if (e.shiftKey) { dock.open = true; flipDock(); } else toggleDock();
}
onMounted(() => window.addEventListener('keydown', onDockKey));
onUnmounted(() => window.removeEventListener('keydown', onDockKey));

/* ── the command palette (Ctrl+K) ─────────────────────────────────────────── */
const paletteOpen = ref(false);
const canvasRef = ref<InstanceType<typeof CanvasView> | null>(null);

function closePalette() { paletteOpen.value = false; }
function onPaletteChoose(rec: RecordRow, keepOpen: boolean) {
  if (view.value === 'canvas' && canvasRef.value) {
    canvasRef.value.placeOrJump(rec);
  } else {
    // Not on a canvas: go to the record. Its table becomes the open one, so the
    // grid behind the panel is the grid the record lives in.
    store.adopt([rec]);
    // A hit from another section: go where it lives rather than show a table the
    // current section's picker does not list.
    if (section.value && !section.value.table_ids.includes(rec.table_id)) sectionKey.value = 'all';
    if (sectionKey.value === null) sectionKey.value = 'all';
    tableId.value = rec.table_id;
    view.value = 'table';
    openRecordId.value = rec.id;
  }
  if (!keepOpen) closePalette();
}
function onPaletteKey(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    canvasRef.value?.resetCascade();
    paletteOpen.value = !paletteOpen.value;
  }
}
onMounted(() => window.addEventListener('keydown', onPaletteKey));
onUnmounted(() => window.removeEventListener('keydown', onPaletteKey));

/* Ctrl+Z / Ctrl+Shift+Z (or Ctrl+Y), app-wide — see client/history.ts.
   Except while typing: inside an input the browser's own text undo is what the
   key means, and stealing it would undo a card move when you wanted to un-type a
   letter. */
function onHistoryKey(e: KeyboardEvent) {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k !== 'z' && k !== 'y') return;
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
  e.preventDefault();
  void (k === 'y' || e.shiftKey ? store.redoLast() : store.undoLast());
}
onMounted(() => window.addEventListener('keydown', onHistoryKey));
onUnmounted(() => window.removeEventListener('keydown', onHistoryKey));

// Keep the pickers pointing at something real. They were only set once, on
// mount — so on a fresh database, creating your FIRST table in the schema tab
// left the table tab still saying "no tables", and deleting the selected table
// (or a peer doing so) left the grid bound to an id that no longer exists.
watch(tables, (ts) => {
  if (!ts.some((t) => t.id === tableId.value)) tableId.value = ts[0]?.id ?? '';
});
watch(canvases, (cs) => {
  if (!cs.some((c) => c.id === canvasId.value)) canvasId.value = cs[0]?.id ?? '';
});

/* ── the address bar ──────────────────────────────────────────────────────
   The refs above stay the working state; the URL mirrors them, both ways:
   refs → hash (so reload, back/forward and bookmarks work, and a record can be
   linked to), hash → refs (when the user navigates). `applying` stops the mirror
   reflecting in itself. */
let applying = false;
const currentRoute = (): Route => ({
  section: sectionKey.value,
  view: view.value,
  target: view.value === 'canvas' ? canvasId.value : view.value === 'table' ? tableId.value : '',
  record: openRecordId.value,
  scope: formatScope(scopeApi.scope.value),
});
function applyRoute(r: Route) {
  applying = true;
  // History was a tab once (and "undo" before that); those addresses open Settings now.
  if (/\/(history|undo)(\/|\?|$)/.test(location.hash)) settingsOpen.value = true;
  // A section that does not exist (deleted, or a link from another database)
  // lands on Home rather than on an empty shell.
  sectionKey.value = r.section && r.section !== 'all' && !store.state.sections.has(r.section) ? null : r.section;
  view.value = r.view;
  if (r.target) { if (r.view === 'canvas') canvasId.value = r.target; else tableId.value = r.target; }
  openRecordId.value = r.record;
  // After the section has switched (the scope composable resets on that), and only
  // if the link actually names a scope — a bare link keeps whatever you had.
  void nextTick(() => { if (r.scope) scopeApi.scope.value = parseScope(r.scope); applying = false; });
}
function goSection(key: string) {
  // From HOME, land on the table tab — the grid is the better front door for
  // someone who has not been here before; canvases are one click away. Switching
  // section from the breadcrumb KEEPS the tab you are on: you were looking at
  // canvases, you want the other section's canvases.
  if (sectionKey.value === null) view.value = 'table';
  sectionKey.value = key;
  openRecordId.value = '';
}
watch([sectionKey, view, tableId, canvasId, openRecordId, scopeApi.scope], () => {
  if (applying) return;
  const hash = formatRoute(currentRoute(), section.value?.name);
  if (location.hash !== hash && !sameRoute(parseRoute(location.hash), currentRoute())) location.hash = hash;
});
const onHashChange = () => { const r = parseRoute(location.hash); if (!sameRoute(r, currentRoute())) applyRoute(r); };

/** Signed in (just now, or already): load everything and open the stream. */
async function enter() {
  try { await store.hydrate(); }
  catch (e) {
    // A 401 here has already flipped us back to the login screen (store.get). Anything
    // else is the server being unreachable: say so; the stream's retry will recover.
    if (store.auth.value === 'in') store.errors.value.unshift(`could not load: ${(e as Error).message}`);
    return;
  }
  store.start();
  applyRoute(parseRoute(location.hash));
  if (!canvases.value.some((c) => c.id === canvasId.value)) canvasId.value = canvases.value[0]?.id ?? '';
  if (!tables.value.some((t) => t.id === tableId.value)) tableId.value = tables.value[0]?.id ?? '';
}
// Entering is driven by the auth STATE, not by an event from the login screen:
// signing in flips `auth` to 'in', which unmounts <LoginPage> in the same tick, and
// Vue drops events emitted by an unmounted component — so a "signed-in" event never
// arrived and the app sat there, signed in and empty. (Found by test/auth.ts.)
watch(() => store.auth.value, (now, before) => { if (now === 'in' && before !== 'in') void enter(); });
onMounted(() => {
  window.addEventListener('hashchange', onHashChange);
  // Ask first. Hydrating before knowing would be five 401s and an error banner.
  void store.whoAmI();
});
onUnmounted(() => window.removeEventListener('hashchange', onHashChange));

onUnmounted(() => store.stop());
</script>

<style>
:root {
  --bg-app: #1a1a1a;
  --bg-canvas: #161616;
  --bg-surface-hover: rgba(255, 255, 255, 0.06);
  --border-main: #3a3a3a;
  --text-primary: #e0e0e0;
  --text-secondary: #bbb;
  --text-muted: #888;
  --text-faint: #555;
  --accent: #42a5f5;
  --accent-ring: rgba(66, 165, 245, 0.22);
  --success: #4caf50;
  --warning: #ff9800;
  --danger: #f44336;
  --canvas-dot: rgba(255, 255, 255, 0.07);
  --controls-bg: #252525;
  --card-bg: #2b2b2b;
  --card-border: #3f3f3f;
  --card-head-bg: #3a3a3a;
  --card-head-text: rgba(255, 255, 255, 0.75);
  --card-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
  --card-shadow-drag: 0 8px 24px rgba(0, 0, 0, 0.5);
  --arrow: #6b7f8f;
}
* { box-sizing: border-box; }
html, body, #app { height: 100%; margin: 0; }
body {
  background: var(--bg-app);
  color: var(--text-primary);
  font: 13px/1.5 ui-sans-serif, system-ui, -apple-system, sans-serif;
}
.app { display: flex; flex-direction: column; height: 100%; }

.topbar {
  display: flex; align-items: center; gap: 8px; flex: none; height: 38px; box-sizing: border-box;
  padding: 0 12px; border-bottom: 1px solid var(--border-main); background: var(--controls-bg);
}
.ghost {
  background: none; border: 1px solid var(--border-main); color: var(--text-secondary);
  border-radius: 4px; padding: 2px 8px; cursor: pointer; font: inherit;
}
.ghost:hover { color: var(--text-primary); }
.tree-toggle { border-color: transparent; font-size: 14px; padding: 0 6px; }
.tree-toggle.on { color: var(--accent); }
.spacer { flex: 1; }

.crumbs { display: flex; align-items: center; gap: 6px; min-width: 0; }
.crumb { color: var(--text-secondary); text-decoration: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.home-crumb { color: var(--text-primary); font-weight: 600; }
.home-crumb:hover { color: var(--accent); }
.crumbs .sep { color: var(--text-faint); }
.scope-crumb.narrowed { color: var(--accent); }
.leaf-crumb { color: var(--text-primary); }

/* The status readout NEVER changes width — that is the point of it. */
.status { display: inline-flex; align-items: center; gap: 6px; width: 104px; flex: none; justify-content: flex-end; font-size: 11px; color: var(--text-muted); }
.status .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--warning); flex: none; }
.status.connected .dot { background: var(--success); }
.status.offline .dot { background: var(--danger); }
.status-text { font-variant-numeric: tabular-nums; }
.hist:disabled { opacity: 0.3; cursor: default; }

.body { flex: 1; min-height: 0; display: flex; }
.main { flex: 1; min-width: 0; display: flex; flex-direction: column; }

/* The canvas tab's layout: the docked grid, its splitter, the canvas. These rules
   were deleted by accident when the header's styles were rewritten (they sat in
   the same block) — and with no `.workspace` sizing the canvas collapsed to zero
   height: no dots, no clicks, the browser's own context menu. The headless tests
   could not see it; test/sections.ts now asserts these rules EXIST. */
.workspace { flex: 1; min-height: 0; min-width: 0; display: flex; flex-direction: row; }
.workspace.dock-bottom { flex-direction: column-reverse; }
.workspace > :last-child { flex: 1; min-width: 0; min-height: 0; }
.dock { flex: none; display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; background: var(--bg-app); }
.splitter { flex: none; background: var(--border-main); }
.dock-left .splitter { width: 5px; cursor: col-resize; }
.dock-bottom .splitter { height: 5px; cursor: row-resize; }
.splitter:hover { background: var(--accent); }

.drag-ghost {
  position: fixed; z-index: 300; pointer-events: none; transform: translate(12px, 10px);
  background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 6px;
  padding: 5px 10px; font-size: 12px; box-shadow: var(--card-shadow-drag); opacity: 0.75;
  max-width: 260px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
/* Over something that will take the drop: full strength and an accent edge. */
.drag-ghost.over { opacity: 1; border-color: var(--accent); }
.drag-count {
  margin-left: 8px; background: var(--accent); color: #fff; border-radius: 8px;
  padding: 0 6px; font-size: 11px; font-weight: 600;
}
.stage { flex: 1; min-height: 0; display: flex; }
.viewport { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; position: relative; }
.tray-splitter { flex: none; width: 5px; cursor: col-resize; background: var(--border-main); }
.tray-splitter:hover { background: var(--accent); }
.panel { padding: 16px; overflow: auto; flex: 1; }
.hint { padding: 24px; color: var(--text-muted); }
.grid { border-collapse: collapse; width: 100%; }
.grid th, .grid td {
  border: 1px solid var(--border-main); padding: 4px 8px; text-align: left; font-weight: 400;
}
.grid th { color: var(--text-muted); font-size: 11px; text-transform: uppercase; }
.grid tr.pending { opacity: 0.5; }
.grid tr.done { opacity: 0.4; }
.grid td.state, .grid th.state { color: var(--text-muted); width: 80px; font-size: 11px; }
/* (A global `.grid input { width: 100% }` lived here — a leftover from the phase-1
   debug grid. The field popovers are INSIDE the grid's <table>, so it stretched
   every checkbox in them to full width: the tick drawn in the middle, its label
   shoved to the right edge. Cell inputs are styled by CellEditor, scoped.) */
.history .grid button, .row-add button {
  background: var(--controls-bg); border: 1px solid var(--border-main);
  color: var(--text-secondary); border-radius: 4px; padding: 2px 8px; cursor: pointer;
}
.row-add { margin-top: 10px; display: flex; gap: 6px; }
.row-add input {
  background: var(--controls-bg); border: 1px solid var(--border-main);
  color: inherit; border-radius: 4px; padding: 4px 8px;
}
.muted { color: var(--text-muted); }
.chip {
  display: inline-flex; align-items: center; gap: 3px;
  background: var(--controls-bg); border: 1px solid var(--border-main);
  border-radius: 10px; padding: 1px 4px 1px 8px; margin: 1px 3px 1px 0;
  font-size: 11px; white-space: nowrap;
}
.chip-x {
  background: none; border: none; color: var(--text-muted);
  cursor: pointer; padding: 0 2px; font-size: 12px; line-height: 1;
}
.chip-x:hover { color: var(--danger); }
.chip-add {
  background: none; border: 1px dashed var(--border-main); color: var(--text-muted);
  border-radius: 10px; font-size: 11px; padding: 1px 4px; cursor: pointer;
}
/* Rich text — GLOBAL on purpose: this markup is generated (v-html in RichTextView,
   ProseMirror's own DOM in the editor), so scoped styles cannot reach it. One set
   of rules for both, so a note reads the same being read and being written. */
.rich, .ProseMirror { font-size: 13px; line-height: 1.5; color: var(--text-primary); outline: none; word-break: break-word; }
.rich > :first-child, .ProseMirror > :first-child { margin-top: 0; }
.rich > :last-child, .ProseMirror > :last-child { margin-bottom: 0; }
.rich p, .ProseMirror p { margin: 0 0 0.6em; }
.rich h1, .rich h2, .rich h3, .ProseMirror h1, .ProseMirror h2, .ProseMirror h3 { margin: 0.9em 0 0.4em; line-height: 1.25; }
.rich h1, .ProseMirror h1 { font-size: 18px; } .rich h2, .ProseMirror h2 { font-size: 16px; } .rich h3, .ProseMirror h3 { font-size: 14px; }
.rich ul, .rich ol, .ProseMirror ul, .ProseMirror ol { margin: 0 0 0.6em; padding-left: 1.4em; }
.rich ul[data-type='taskList'], .ProseMirror ul[data-type='taskList'] { list-style: none; padding-left: 0.2em; }
.rich ul[data-type='taskList'] li, .ProseMirror ul[data-type='taskList'] li { display: flex; gap: 6px; }
.rich ul[data-type='taskList'] li > div, .ProseMirror ul[data-type='taskList'] li > div { flex: 1; }
.rich blockquote, .ProseMirror blockquote { margin: 0 0 0.6em; padding-left: 10px; border-left: 3px solid var(--border-main); color: var(--text-secondary); }
.rich code, .ProseMirror code { background: var(--controls-bg); border-radius: 3px; padding: 0 4px; font-size: 12px; }
.rich pre, .ProseMirror pre { background: var(--controls-bg); border-radius: 4px; padding: 8px 10px; overflow-x: auto; margin: 0 0 0.6em; }
.rich pre code, .ProseMirror pre code { background: none; padding: 0; }
.rich hr, .ProseMirror hr { border: none; border-top: 1px solid var(--border-main); margin: 0.8em 0; }
.rich a, .ProseMirror a { color: var(--accent); }
.rich img, .ProseMirror img { max-width: 100%; height: auto; border-radius: 3px; display: block; margin: 0.4em 0; }
.ProseMirror img.ProseMirror-selectednode { outline: 2px solid var(--accent); }
.rich table, .ProseMirror table { border-collapse: collapse; margin: 0 0 0.6em; max-width: 100%; display: block; overflow-x: auto; }
.rich td, .rich th, .ProseMirror td, .ProseMirror th { border: 1px solid var(--border-main); padding: 3px 8px; vertical-align: top; min-width: 40px; }
.rich th, .ProseMirror th { background: var(--controls-bg); font-weight: 600; text-align: left; }
.ProseMirror p.is-editor-empty:first-child::before { content: attr(data-placeholder); color: var(--text-faint); float: left; height: 0; pointer-events: none; }

.errors {
  margin: 0; padding: 8px 12px; background: #3a1f1f; color: #f3b8b8;
  font-size: 11px; max-height: 120px; overflow: auto; flex: none;
}
</style>
