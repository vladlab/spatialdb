<!--
  A table's RECIPE for File drop (contract/tools.ts) — configured here, in the
  browser, by an admin; run only by the desktop app.

  Three views of ONE piece of JSON, so that whoever reads this in a year can tell
  where every value comes from:

    Steps    a card per step, in order: the analyzer (and the program it runs, with
             the version the desktop reported, if this IS the desktop), what it runs
             on, and which outputs land in which fields. "(not written)" is the
             normal answer for most outputs — a table gets the columns its owner
             wants. `+ field` makes a field shaped as the output wants it.
    JSON     the recipe as text, validated live, saved once — the escape hatch, as
             the report editor has.
    Summary  the recipe as sentences (`describe`) — documentation that cannot drift
             from the configuration, because it is derived from it.

  Every change writes the table's WHOLE tools config (`table.update { tools }`), one
  undoable step, refused before it is queued if the server would refuse it.
-->
<template>
  <section class="tools">
    <h4>Desktop tools</h4>
    <label class="on">
      <input type="checkbox" :checked="!!recipe" @change="toggle(($event.target as HTMLInputElement).checked)" />
      <b>File drop</b>
      <span class="hint">files dropped onto this table in the desktop app become records, filled in by the steps below</span>
    </label>

    <template v-if="recipe">
      <div class="views">
        <button v-for="v in VIEWS" :key="v.id" class="plain view" :class="{ on: view === v.id }" @click="view = v.id">{{ v.label }}</button>
      </div>

      <!-- ── Steps ── -->
      <div v-if="view === 'steps'" class="steps">
        <div v-for="(step, i) in recipe.steps" :key="i" class="step">
          <div class="step-head">
            <span class="n">{{ i + 1 }}</span>
            <b>{{ analyzerOf(step.analyzer)?.name ?? step.analyzer }}</b>
            <span class="prog" :title="analyzerOf(step.analyzer)?.how ?? ''">
              <template v-if="analyzerOf(step.analyzer)?.program">runs <code>{{ analyzerOf(step.analyzer)!.program }}</code><span v-if="versionOf(step.analyzer)"> {{ versionOf(step.analyzer) }}</span></template>
              <template v-else>built in</template>
            </span>
            <span class="grow" />
            <button class="plain mini" :disabled="i === 0" title="Run earlier" @click="move(i, -1)">↑</button>
            <button class="plain mini" :disabled="i === recipe.steps.length - 1" title="Run later" @click="move(i, 1)">↓</button>
            <button class="plain mini" title="Remove this step" @click="removeStep(i)">×</button>
          </div>
          <div class="how">{{ analyzerOf(step.analyzer)?.how }}</div>

          <div class="runs-on">
            <span class="ro-label">Runs on</span>
            <span v-for="m in MEDIA" :key="m" class="chip" :class="{ on: mediaOn(step, m) }" @click="toggleMedia(i, m)">{{ m }}</span>
            <span class="ro-sep">·</span>
            <span v-for="k in KINDS" :key="k" class="chip kind" :class="{ on: kindOn(step, k) }" @click="toggleKind(i, k)">{{ k.replace('_', ' ') }}</span>
            <button v-if="step.runs_on" class="plain mini" title="Back to this analyzer's default" @click="resetRunsOn(i)">default</button>
          </div>

          <div class="rows">
            <div v-for="out in analyzerOf(step.analyzer)?.outputs ?? []" :key="out.key" class="row" :title="out.note ?? ''">
              <span class="oname">{{ out.name }}<span v-if="isRequired(step.analyzer, out.key)" class="req" title="the tool cannot run without this">*</span></span>
              <span class="otype">{{ out.type.replace('structured:', '') }}</span>
              <select :value="step.map[out.key] ?? ''" @change="setMap(i, out.key, ($event.target as HTMLSelectElement).value)">
                <option value="">(not written)</option>
                <option v-for="f in accepting(out)" :key="f.id" :value="f.id">{{ f.name }}</option>
              </select>
              <button v-if="!step.map[out.key] && !hasKey(out.key)" class="plain mini" title="make a field for this output and map it" @click="addField(i, out)">+ field</button>
            </div>
          </div>
        </div>

        <div class="add">
          <select v-model="addId">
            <option value="">Add a step…</option>
            <option v-for="a in ANALYZERS" :key="a.id" :value="a.id">{{ a.name }}{{ a.program ? ` (${a.program})` : '' }}</option>
          </select>
          <button class="plain" :disabled="!addId" @click="addStep">Add</button>
        </div>
      </div>

      <!-- ── JSON ── -->
      <div v-else-if="view === 'json'" class="json">
        <textarea v-model="draft" spellcheck="false" rows="16" @input="draftProblem = checkDraft()" />
        <div class="json-foot">
          <span v-if="draftProblem" class="problem">{{ draftProblem }}</span>
          <span v-else class="hint">valid</span>
          <span class="grow" />
          <button class="plain" :disabled="!!draftProblem || draft === current" @click="saveDraft">Save</button>
        </div>
      </div>

      <!-- ── Summary ── -->
      <div v-else class="summary">
        <p v-for="(line, i) in summary" :key="i">{{ line }}</p>
        <p v-if="!summary.length" class="hint">No steps yet.</p>
      </div>
    </template>
    <p v-if="problem" class="problem">{{ problem }}</p>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { Store } from '../store';
import { fieldsOf } from '../state';
import { useSchemaActions } from '../schemaActions';
import { available } from '../desktop';
import { ANALYZERS, KINDS, MEDIA, REQUIRED, analyzerOf, describe, fieldAccepts, runsOnOf, toolsProblem, type Kind, type Media, type Output, type Recipe, type Step, type TablesTools } from '../../contract/tools';

const props = defineProps<{ store: Store; tableId: string }>();
const actions = useSchemaActions(props.store);

type ViewId = 'steps' | 'json' | 'summary';
const VIEWS: Array<{ id: ViewId; label: string }> = [{ id: 'steps', label: 'Steps' }, { id: 'json', label: 'JSON' }, { id: 'summary', label: 'Summary' }];
const view = ref<ViewId>('steps');
const problem = ref('');
const addId = ref('');

const table = computed(() => props.store.state.tables.get(props.tableId));
const fields = computed(() => fieldsOf(props.store.state, props.tableId));
const tools = computed(() => (table.value?.tools ?? {}) as Partial<TablesTools>);
const recipe = computed<Recipe | undefined>(() => tools.value.file_drop);
const current = computed(() => JSON.stringify(recipe.value ?? null, null, 2));
const versions = computed(() => available.value?.analyzers ?? {});
const versionOf = (id: string) => versions.value[id] ?? '';
const summary = computed(() => recipe.value ? describe(recipe.value, fields.value, versions.value) : []);

const accepting = (out: Output) => fields.value.filter((f) => fieldAccepts(out, f));
const hasKey = (key: string) => fields.value.some((f) => f.key === key);
const isRequired = (analyzer: string, key: string) => REQUIRED.some((r) => r.analyzer === analyzer && r.key === key);
const mediaOn = (step: Step, m: Media) => { const r = runsOnOf(step); return !r.media || r.media.includes(m); };
const kindOn = (step: Step, k: Kind) => { const r = runsOnOf(step); return !r.kind || r.kind.includes(k); };

function write(next: Recipe) {
  problem.value = actions.setTools(props.tableId, { ...tools.value, file_drop: next } as TablesTools) ?? '';
}
function edit(fn: (r: Recipe) => void) {
  const next: Recipe = JSON.parse(JSON.stringify(recipe.value));
  fn(next);
  write(next);
}
function toggle(on: boolean) {
  problem.value = (on ? actions.enableFileDrop(props.tableId) : actions.disableFileDrop(props.tableId)) ?? '';
}
function setMap(i: number, key: string, fieldId: string) {
  edit((r) => { if (fieldId) r.steps[i].map[key] = fieldId; else delete r.steps[i].map[key]; });
}
function addField(i: number, out: Output) {
  const made = actions.addToolFields(props.tableId, [out]);
  if (made[out.key]) setMap(i, out.key, made[out.key]);
}
function move(i: number, d: number) { edit((r) => { const [s] = r.steps.splice(i, 1); r.steps.splice(i + d, 0, s); }); }
function removeStep(i: number) { edit((r) => { r.steps.splice(i, 1); }); }
function addStep() { if (!addId.value) return; edit((r) => { r.steps.push({ analyzer: addId.value, map: {} }); }); addId.value = ''; }

// "Runs on" chips: a click MATERIALISES the analyzer's default into an explicit
// runs_on, then toggles the one value — so the JSON shows what was meant. A list
// that covers everything is dropped again (no constraint).
function toggleMedia(i: number, m: Media) {
  edit((r) => {
    const step = r.steps[i];
    const cur = runsOnOf(step);
    const list = cur.media ? [...cur.media] : [...MEDIA];
    const next = list.includes(m) ? list.filter((x) => x !== m) : [...list, m];
    step.runs_on = { ...cur };
    if (next.length === MEDIA.length) delete step.runs_on.media; else step.runs_on.media = next;
  });
}
function toggleKind(i: number, k: Kind) {
  edit((r) => {
    const step = r.steps[i];
    const cur = runsOnOf(step);
    const list = cur.kind ? [...cur.kind] : [...KINDS];
    const next = list.includes(k) ? list.filter((x) => x !== k) : [...list, k];
    step.runs_on = { ...cur };
    if (next.length === KINDS.length) delete step.runs_on.kind; else step.runs_on.kind = next;
  });
}
function resetRunsOn(i: number) { edit((r) => { delete r.steps[i].runs_on; }); }

/* ── JSON view: a draft, validated live, saved once ── */
const draft = ref(current.value);
const draftProblem = ref('');
watch(current, (c) => { draft.value = c; draftProblem.value = ''; });
function checkDraft(): string {
  try {
    const parsed = JSON.parse(draft.value);
    return toolsProblem({ ...tools.value, file_drop: parsed }, fields.value) ?? '';
  } catch (e) { return `not JSON: ${(e as Error).message}`; }
}
function saveDraft() { if (!checkDraft()) write(JSON.parse(draft.value)); }
</script>

<style scoped>
.tools { margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--border-main); }
h4 { margin: 0 0 6px; font-size: 12px; color: var(--text-secondary); }
.on { display: flex; gap: 8px; align-items: baseline; cursor: pointer; }
.hint { color: var(--text-faint); font-size: 11px; }
.views { display: flex; gap: 4px; margin: 8px 0 6px 20px; }
.view.on { color: var(--accent); border-color: var(--accent); }
.steps { margin-left: 20px; }
.step { border: 1px solid var(--border-main); border-radius: 6px; padding: 8px 10px; margin-bottom: 8px; background: var(--controls-bg); }
.step-head { display: flex; align-items: center; gap: 8px; }
.n { display: inline-block; min-width: 18px; height: 18px; line-height: 18px; text-align: center; border-radius: 9px; background: var(--border-main); font-size: 11px; color: var(--text-secondary); }
.prog { color: var(--text-muted); font-size: 11px; }
.prog code { font-size: 11px; }
.grow { flex: 1; }
.how { color: var(--text-faint); font-size: 11px; margin: 2px 0 6px 26px; }
.runs-on { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin: 0 0 6px 26px; }
.ro-label { color: var(--text-muted); font-size: 11px; margin-right: 4px; }
.ro-sep { color: var(--text-faint); }
.chip { font-size: 10px; padding: 1px 7px; border-radius: 10px; border: 1px solid var(--border-main); color: var(--text-faint); cursor: pointer; user-select: none; }
.chip.on { color: var(--text-primary); border-color: var(--accent); background: color-mix(in srgb, var(--accent) 18%, transparent); }
.rows { margin-left: 26px; }
.row { display: grid; grid-template-columns: 1fr 70px 160px auto; gap: 6px; align-items: center; font-size: 12px; padding: 1px 0; }
.oname { color: var(--text-primary); }
.req { color: var(--accent); margin-left: 2px; }
.otype { color: var(--text-faint); font-size: 10px; }
select { border: 1px solid var(--border-main); border-radius: 4px; padding: 2px 4px; font: inherit; font-size: 11px; min-width: 0; }
.add { display: flex; gap: 6px; align-items: center; }
.plain { background: none; border: 1px solid var(--border-main); color: var(--text-secondary); border-radius: 4px; cursor: pointer; font: inherit; padding: 2px 8px; }
.plain:disabled { opacity: 0.4; cursor: default; }
.mini { font-size: 10px; padding: 1px 6px; }
.plain:not(:disabled):hover { color: var(--accent); border-color: var(--accent); }
.json { margin-left: 20px; }
.json textarea { width: 100%; font: 11px/1.4 ui-monospace, monospace; background: var(--bg-app); color: var(--text-primary); border: 1px solid var(--border-main); border-radius: 4px; padding: 6px; resize: vertical; }
.json-foot { display: flex; align-items: center; gap: 8px; margin-top: 4px; }
.summary { margin-left: 20px; font-size: 12px; }
.summary p { margin: 4px 0; }
.problem { color: var(--danger); font-size: 12px; margin: 6px 0 0; }
</style>
