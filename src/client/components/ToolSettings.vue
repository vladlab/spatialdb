<!--
  The desktop client's TOOLS on one table — configured here, in the browser, by an
  admin; run only by the desktop app (contract/tools.ts, TAURI-HANDOFF.md §3).

  "File drop is on for Files, and its Width goes into THAT field." Each output the
  tool can produce gets a picker of this table's fields of a type that accepts it;
  "(not written)" is a legitimate answer for most of the ~40 — a table gets the
  columns its owner wants, not one per output. `+ field` makes a field shaped as the
  output wants it (choices, shape, byte format) and maps it in one go.

  Every change writes the table's WHOLE tools config (`table.update { tools }`), one
  undoable step, refused before it is queued if the server would refuse it.
-->
<template>
  <section class="tools">
    <h4>Desktop tools</h4>
    <div v-for="tool in TOOL_LIST" :key="tool.id" class="tool">
      <label class="on">
        <input type="checkbox" :checked="!!cfg(tool.id)" @change="toggle(tool.id, ($event.target as HTMLInputElement).checked)" />
        <b>{{ tool.name }}</b>
        <span class="hint">{{ tool.kind === 'ingest' ? 'makes records from files dropped onto this table in the desktop app' : 'adds to records' }}</span>
      </label>
      <template v-if="cfg(tool.id)">
        <div v-for="group in groups(tool)" :key="group.when" class="group">
          <div class="gh">{{ WHEN[group.when] }}</div>
          <div v-for="out in group.outputs" :key="out.key" class="row" :title="out.note ?? ''">
            <span class="oname">{{ out.name }}<span v-if="tool.required.includes(out.key)" class="req" title="the tool cannot run without this">*</span></span>
            <span class="otype">{{ out.type.replace('structured:', '') }}</span>
            <select :value="cfg(tool.id)!.map[out.key] ?? ''" @change="setMap(tool.id, out.key, ($event.target as HTMLSelectElement).value)">
              <option value="">(not written)</option>
              <option v-for="f in accepting(out)" :key="f.id" :value="f.id">{{ f.name }}</option>
            </select>
            <button v-if="!cfg(tool.id)!.map[out.key] && !hasKey(out.key)" class="plain mini" title="make a field for this output and map it" @click="addField(tool.id, out)">+ field</button>
          </div>
        </div>
      </template>
    </div>
    <p v-if="problem" class="problem">{{ problem }}</p>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Store } from '../store';
import { fieldsOf } from '../state';
import { useSchemaActions } from '../schemaActions';
import { TOOLS, fieldAccepts, type TablesTools, type ToolDef, type ToolOutput } from '../../contract/tools';

const props = defineProps<{ store: Store; tableId: string }>();
const actions = useSchemaActions(props.store);
const TOOL_LIST = Object.values(TOOLS);
const WHEN: Record<ToolOutput['when'], string> = {
  file: 'Every file', video: 'Video (first video stream; a sequence\'s first frame)', audio: 'Audio',
  image: 'Still image', sequence: 'Image sequence', bundle: 'IMF / DCP bundle', hash: 'Hash — computed last, only if mapped',
};

const problem = ref('');
const table = computed(() => props.store.state.tables.get(props.tableId));
const fields = computed(() => fieldsOf(props.store.state, props.tableId));
const cfg = (toolId: string) => (table.value?.tools as TablesTools | undefined)?.[toolId];
const accepting = (out: ToolOutput) => fields.value.filter((f) => fieldAccepts(out, f));
const hasKey = (key: string) => fields.value.some((f) => f.key === key);

function groups(tool: ToolDef) {
  const order: ToolOutput['when'][] = ['file', 'video', 'audio', 'image', 'sequence', 'bundle', 'hash'];
  return order.map((when) => ({ when, outputs: tool.outputs.filter((o) => o.when === when) })).filter((g) => g.outputs.length);
}

function toggle(toolId: string, on: boolean) {
  problem.value = (on ? actions.enableTool(props.tableId, toolId) : actions.disableTool(props.tableId, toolId)) ?? '';
}
function setMap(toolId: string, key: string, fieldId: string) {
  const tools = { ...(table.value?.tools as TablesTools ?? {}) };
  const map = { ...(tools[toolId]?.map ?? {}) };
  if (fieldId) map[key] = fieldId; else delete map[key];
  tools[toolId] = { map };
  problem.value = actions.setTools(props.tableId, tools) ?? '';
}
function addField(toolId: string, out: ToolOutput) {
  const made = actions.addToolFields(props.tableId, [out]);
  const id = made[out.key];
  if (id) setMap(toolId, out.key, id);
}
</script>

<style scoped>
.tools { margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--border-main); }
h4 { margin: 0 0 6px; font-size: 12px; color: var(--text-secondary); }
.on { display: flex; gap: 8px; align-items: baseline; cursor: pointer; }
.hint { color: var(--text-faint); font-size: 11px; }
.group { margin: 6px 0 0 20px; }
.gh { font-size: 11px; color: var(--text-muted); margin: 6px 0 2px; }
.row { display: grid; grid-template-columns: 1fr 70px 150px auto; gap: 6px; align-items: center; font-size: 12px; padding: 1px 0; }
.oname { color: var(--text-primary); }
.req { color: var(--accent); margin-left: 2px; }
.otype { color: var(--text-faint); font-size: 10px; }
select { background: var(--controls-bg); border: 1px solid var(--border-main); color: inherit; border-radius: 4px; padding: 2px 4px; font: inherit; font-size: 11px; min-width: 0; }
.plain { background: none; border: 1px solid var(--border-main); color: var(--text-secondary); border-radius: 4px; cursor: pointer; font: inherit; }
.mini { font-size: 10px; padding: 1px 6px; }
.plain:hover { color: var(--accent); border-color: var(--accent); }
.problem { color: var(--danger); font-size: 12px; margin: 6px 0 0; }
</style>
