<!--
  A table's CARD WATERMARK (CANVAS-BRIEF.md B2, contract/cardIcon.ts), in Table
  settings: none, one icon for every card, or chosen per record by a field — the
  Files table's Media select, say, where video gets the film strip and audio the
  waveform. Choosing a field fills in the icons it recognises (`suggestMap`); the
  rest are one click each. Every change is one table.update, one Ctrl+Z.
-->
<template>
  <section class="wm">
    <h3>Card watermark <span class="hint">— a large, faint icon behind the rows of this table's cards, on every canvas</span></h3>
    <div class="wm-mode" role="radiogroup" aria-label="Watermark">
      <label><input type="radio" name="wm-mode" :checked="mode === 'none'" @change="setMode('none')" /> none</label>
      <label><input type="radio" name="wm-mode" :checked="mode === 'one'" @change="setMode('one')" /> one icon</label>
      <label><input type="radio" name="wm-mode" :checked="mode === 'field'" :disabled="!fields.length" @change="setMode('field')" /> by a field</label>
      <span v-if="!fields.length" class="hint">(no select, text or single-link field to choose by)</span>
    </div>

    <div v-if="mode === 'one'" class="wm-row">
      <span class="wm-key">every card</span>
      <span class="wm-swatches">
        <button v-for="id in CARD_ICONS" :key="id" type="button" class="wm-sw" :class="{ on: cfg.icon === id }" :title="CARD_ICON_LABELS[id]" :aria-label="CARD_ICON_LABELS[id]" :aria-pressed="cfg.icon === id" @click="save({ icon: id })">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path v-for="(d, i) in CARD_ICON_PATHS[id]" :key="i" :d="d" /></svg>
        </button>
      </span>
    </div>

    <template v-if="mode === 'field'">
      <label class="wm-field">
        <span class="wm-key">chosen by</span>
        <select :value="cfg.byField ?? ''" @change="pickField(($event.target as HTMLSelectElement).value)">
          <option v-for="f in fields" :key="f.id" :value="f.id">{{ f.name }}</option>
        </select>
      </label>
      <div v-for="v in values" :key="v" class="wm-row">
        <span class="wm-key wm-val" :title="v">{{ v }}</span>
        <span class="wm-swatches">
          <button type="button" class="wm-sw none" :class="{ on: !cfg.map?.[v] }" title="No icon for this value" aria-label="No icon" :aria-pressed="!cfg.map?.[v]" @click="setValue(v, null)">–</button>
          <button v-for="id in CARD_ICONS" :key="id" type="button" class="wm-sw" :class="{ on: cfg.map?.[v] === id }" :title="CARD_ICON_LABELS[id]" :aria-label="`${v}: ${CARD_ICON_LABELS[id]}`" :aria-pressed="cfg.map?.[v] === id" @click="setValue(v, id)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path v-for="(d, i) in CARD_ICON_PATHS[id]" :key="i" :d="d" /></svg>
          </button>
        </span>
      </div>
      <p v-if="!values.length" class="hint">No values yet — they are listed here once records have some.</p>
      <div class="wm-row">
        <span class="wm-key">anything else</span>
        <span class="wm-swatches">
          <button type="button" class="wm-sw none" :class="{ on: !cfg.icon }" title="No icon" aria-label="No icon" :aria-pressed="!cfg.icon" @click="save({ ...cfg, icon: undefined })">–</button>
          <button v-for="id in CARD_ICONS" :key="id" type="button" class="wm-sw" :class="{ on: cfg.icon === id }" :title="CARD_ICON_LABELS[id]" :aria-label="`anything else: ${CARD_ICON_LABELS[id]}`" :aria-pressed="cfg.icon === id" @click="save({ ...cfg, icon: id })">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path v-for="(d, i) in CARD_ICON_PATHS[id]" :key="i" :d="d" /></svg>
          </button>
        </span>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Store } from '../store';
import { fieldsOf, recordsOf } from '../state';
import { useDerived } from '../derived';
import { choicesOf } from '../../contract/values';
import { CARD_ICONS, CARD_ICON_LABELS, CardIcon, canDriveIcon, suggestMap, type CardIconId } from '../../contract/cardIcon';
import { CARD_ICON_PATHS } from '../canvas/cardIcons';

const props = defineProps<{ store: Store; tableId: string }>();
const derived = useDerived(props.store);

const cfg = computed<CardIcon>(() => {
  const p = CardIcon.safeParse(props.store.state.tables.get(props.tableId)?.card_icon ?? {});
  return p.success ? p.data : {};
});
const mode = computed(() => (cfg.value.byField ? 'field' : cfg.value.icon ? 'one' : 'none'));
const fields = computed(() => fieldsOf(props.store.state, props.tableId).filter(canDriveIcon));

/** The values a field has: a select's choices, else what the loaded records hold (a text, a link's label), at most 40. */
function valuesOf(fieldId: string | undefined): string[] {
  const f = fieldId ? props.store.state.fields.get(fieldId) : undefined;
  if (!f) return [];
  const choices = f.type === 'select' ? choicesOf(f.options) : null;
  if (choices) return choices;
  const seen = new Set<string>();
  for (const r of recordsOf(props.store.state, props.tableId)) {
    const v = f.type === 'link' ? derived.linksFrom(r.id, f.id).map((id) => derived.plainLabelOfId(id))[0] : r.data[f.key];
    if (v !== undefined && v !== null && String(v).trim()) seen.add(String(v));
    if (seen.size >= 40) break;
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}
const values = computed(() => valuesOf(cfg.value.byField));

function save(next: CardIcon | null) {
  const clean = next && (next.icon || next.byField) ? Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined)) as CardIcon : null;
  props.store.mutate({ type: 'table.update', id: props.tableId, cardIcon: clean });
}
function setMode(m: 'none' | 'one' | 'field') {
  if (m === 'none') save(null);
  else if (m === 'one') save({ icon: cfg.value.icon ?? 'generic' });
  // A select first (Media is one), then a single link, then a text: the likeliest to name a kind.
  else pickField((fields.value.find((f) => f.type === 'select') ?? fields.value.find((f) => f.type === 'link') ?? fields.value[0])?.id ?? '');
}
function pickField(id: string) {
  if (!id) return;
  save({ byField: id, map: suggestMap(valuesOf(id)), ...(cfg.value.icon ? { icon: cfg.value.icon } : {}) });
}
function setValue(v: string, icon: CardIconId | null) {
  const map = { ...(cfg.value.map ?? {}) };
  if (icon) map[v] = icon; else delete map[v];
  save({ ...cfg.value, map });
}
</script>

<style scoped>
.wm { margin: 12px 0; padding: 10px; border: 1px solid var(--border-main); border-radius: 6px; font-size: 12px; display: flex; flex-direction: column; gap: 6px; }
h3 { margin: 0 0 2px; font-size: 12px; font-weight: 600; }
h3 .hint, .hint { font-weight: 400; color: var(--text-faint); }
.wm-mode { display: flex; flex-wrap: wrap; gap: 14px; align-items: center; }
.wm-mode label, .wm-field { display: flex; gap: 6px; align-items: center; cursor: pointer; }
.wm-field select { background: var(--bg-app); color: inherit; border: 1px solid var(--border-main); border-radius: 4px; font: inherit; padding: 2px 6px; }
.wm-row { display: flex; align-items: center; gap: 8px; }
.wm-key { flex: none; width: 110px; color: var(--text-muted); }
.wm-val { color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wm-swatches { display: flex; flex-wrap: wrap; gap: 3px; }
.wm-sw { width: 28px; height: 28px; padding: 4px; display: inline-flex; align-items: center; justify-content: center;
  background: var(--bg-app); color: var(--text-muted); border: 1px solid var(--border-main); border-radius: 5px; cursor: pointer; font: inherit; }
.wm-sw svg { width: 18px; height: 18px; }
.wm-sw:hover { color: var(--text-primary); border-color: var(--accent); }
.wm-sw.on { color: var(--on-accent); background: var(--accent); border-color: var(--accent); }
.wm-sw.none { font-size: 14px; }
</style>
