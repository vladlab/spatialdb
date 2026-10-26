/**
 * Every schema operation the UI can perform — in ONE place.
 *
 * There are two schema UIs: editing in place from the grid's column headers, and
 * the explicit designer on the schema tab. The designer is kept on the condition
 * that it costs nothing to keep, and this file (with FieldForm.vue and
 * FieldSettings.vue) is how that condition is met: both UIs are thin shells over
 * the same functions and the same two components, so they cannot drift apart. A
 * new capability is added here and shows up in both.
 *
 * Nothing here talks to the server directly. Each function validates what the
 * contract would reject (so the error lands next to the input, not in the error
 * banner a round trip later) and then calls `store.mutate`.
 */

import { FIELD_TYPES } from '../contract/mutations';
import { LABEL_TYPES } from '../contract/labels';
import { LOOKUP_TARGET_TYPES, lookupConfigError, lookupOptionsOf } from '../contract/lookups';
import { backlinkConfigError, backlinkSourceOf, leadsTo } from '../contract/backlinks';
import { arrowStyleOf, type ArrowStyle } from '../contract/arrows';
import { isMembership } from '../contract/scope';
import { shapeOptionError } from '../contract/shapes';
import { SYSTEM_FIELD_TYPES } from '../contract/systemFields';
import { choicesOf as contractChoices } from '../contract/values';
import { ALIASES_KEY, vocabularyOptionError } from '../contract/vocab';
import { REQUIRED_BY_TOOL, analyzerOf, defaultRecipe, fieldAccepts, toolsProblem, type Output, type TablesTools, type ToolId } from '../contract/tools';
import { fieldsOf, recordsOf, tablesSorted, type FieldRow } from './state';
import { notice } from './desktop';
import { junctionOf, junctionProblem, type JunctionConfig } from '../contract/junction';
import { linkMatchError, type MatchPair } from '../contract/match';
import {
  addSection as arrAddSection, appendFields, arrangementOf, fieldFirst, fieldSectionsOf, fieldSectionsProblem, flatOrder, placeField,
  removeSection as arrRemoveSection, sameSections, stepField, updateSection as arrUpdateSection, type Arrangement,
} from '../contract/fieldSections';
import type { Store } from './store';
import { askFull, confirmDialog } from './dialogs';

export type FieldType = (typeof FIELD_TYPES)[number];

export const CREATABLE_TYPES = FIELD_TYPES;

export interface FieldDraft {
  name: string; key: string; type: FieldType;
  /** link: the table it points at. */
  target: string;
  /** select / multi_select: comma separated. */
  choices: string;
  /** A select bound to a built-in vocabulary (contract/vocab.ts) instead of typed choices. */
  vocabulary: string;
  /** lookup: the link field to follow, and the far field to show. */
  via: string; show: string;
  /** link: also make its other face — a backlink on the target table, named after this table. Default on (Airtable's two-way). */
  pair?: boolean;
  /** backlink: the link field (anywhere) this is the other end of. */
  source: string;
  /** structured: which shape its values take (contract/shapes.ts). */
  shape: string;
}
export const emptyDraft = (): FieldDraft =>
  ({ name: '', key: '', type: 'text', target: '', choices: '', vocabulary: '', via: '', show: '', source: '', shape: '', pair: true });

/**
 * name → key, the way a person would: "Frame Rate" → frame_rate. A convenience,
 * not a rule — the form lets you override it — but the result always satisfies
 * the contract's snake_case regex, or is '' for a name with nothing usable in it.
 */
export function deriveKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
    .replace(/^([0-9])/, '_$1');
}

export const parseChoices = (raw: string) => raw.split(',').map((c) => c.trim()).filter(Boolean);
/** A field's choices — through the contract, so a vocabulary-bound select resolves. */
export function choicesOf(f: { options?: Record<string, unknown> | null }): string[] {
  return contractChoices(f.options) ?? [];
}
/** The choices a select field STORES (typed by hand) — empty for a vocabulary-bound one. */
export function ownChoices(f: { options?: Record<string, unknown> | null }): string[] {
  const c = f.options?.choices;
  return Array.isArray(c) ? c.filter((x): x is string => typeof x === 'string') : [];
}

export function useSchemaActions(store: Store) {
  // The table's OWN fields: the schema actions reorder, rename and delete these. The
  // system fields (Created, Created by — contract/systemFields.ts) are not schema, and
  // counting them here once renumbered a table's real fields above 1,000,000.
  const fields = (tableId: string) => fieldsOf(store.state, tableId).filter((f) => !SYSTEM_FIELD_TYPES.has(f.type));

  /* ── lookups ─────────────────────────────────────────────────────────── */

  /** Link fields on this table. */
  const linkFieldsOf = (tableId: string) => fields(tableId).filter((f) => f.type === 'link');
  const fieldById = (id: string) => store.state.fields.get(id);
  /**
   * What a lookup here can FOLLOW (contract/lookups.ts): this table's links, and its
   * backlinks — the same relationships read from the other end. Each with the table
   * it leads to, which is where the field to show is picked from. A broken backlink
   * leads nowhere and is not offered.
   */
  function lookupViasOf(tableId: string): Array<{ field: FieldRow; far: string; label: string }> {
    const out: Array<{ field: FieldRow; far: string; label: string }> = [];
    for (const f of fields(tableId)) {
      const far = leadsTo(f, fieldById);
      if (!far) continue;
      const farName = store.state.tables.get(far)?.name ?? '?';
      out.push({ field: f, far, label: f.type === 'link' ? `${f.name} → ${farName}` : `${f.name} ← ${farName} (backlink)` });
    }
    return out;
  }
  /** Fields a lookup following `viaFieldId` can show: readable fields of the far table. */
  function lookupTargetsOf(viaFieldId: string): FieldRow[] {
    const far = leadsTo(fieldById(viaFieldId), fieldById);
    return far ? fields(far).filter((f) => LOOKUP_TARGET_TYPES.has(f.type)) : [];
  }
  /** "Deliverable → Required codec", or why it is broken. For the settings panel. */
  function describeLookup(f: FieldRow): { text: string; broken: boolean } {
    const o = lookupOptionsOf(f);
    const via = o && store.state.fields.get(o.via_field_id);
    const show = o && store.state.fields.get(o.target_field_id);
    if (!via || !show) {
      return { broken: true, text: !via ? 'broken — the link field it followed was deleted'
        : 'broken — the field it showed was deleted' };
    }
    // Through a backlink whose own link is gone: the backlink is still there, and leads nowhere.
    if (!leadsTo(via, fieldById)) return { broken: true, text: `broken — “${via.name}” is itself broken (the link it is the other end of was deleted)` };
    // "Files ← Status": the arrow says which way the relationship is read.
    return { broken: false, text: `${via.name} ${via.type === 'backlink' ? '←' : '→'} ${show.name}` };
  }

  /* ── backlinks ───────────────────────────────────────────────────────── */

  /** Every link field, on ANY table (this one included), that points at `tableId`. */
  function linkFieldsInto(tableId: string): Array<{ field: FieldRow; label: string }> {
    return [...store.state.fields.values()]
      .filter((f) => f.type === 'link' && f.options?.target_table_id === tableId)
      .map((field) => ({ field, label: `${store.state.tables.get(field.table_id)?.name ?? '?'} · ${field.name}` }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }
  function describeBacklink(f: FieldRow): { text: string; broken: boolean } {
    const src = store.state.fields.get(backlinkSourceOf(f) ?? '');
    if (!src) return { broken: true, text: 'broken — the link field it mirrored was deleted' };
    return { broken: false, text: `← ${store.state.tables.get(src.table_id)?.name ?? '?'} · ${src.name}` };
  }

  /* ── tables ───────────────────────────────────────────────────────────── */

  /** Returns the new table's id, or null for a blank name. */
  function createTable(rawName: string, kind: 'records' | 'canvas' | 'report' | 'calendar' = 'records'): string | null {
    const name = rawName.trim();
    if (!name) return null;
    const id = crypto.randomUUID();
    // Position after the last, so creation order is presentation order. Two
    // mutations — table.create carries no position — but they share a debounce
    // flush and therefore a transaction. (API.md: "set the position".)
    const pos = Math.max(0, ...tablesSorted(store.state).map((t) => t.position ?? 0)) + 1;
    store.mutate({ type: 'table.create', id, name, singularName: '', color: '', icon: '', ...(kind !== 'records' ? { kind } : {}) });
    // A table of boards is useless without somewhere to put a board's NAME; a
    // table of reports also needs the field that holds the DEFINITION.
    if (kind !== 'records') {
      store.mutate({ type: 'field.create', id: crypto.randomUUID(), tableId: id, name: 'Name', key: 'name', fieldType: 'text', options: {}, required: false });
    }
    if (kind === 'report') {
      store.mutate({ type: 'field.create', id: crypto.randomUUID(), tableId: id, name: 'Report', key: 'report', fieldType: 'structured', options: { shape: 'report' }, required: false });
    }
    if (kind === 'calendar') {
      store.mutate({ type: 'field.create', id: crypto.randomUUID(), tableId: id, name: 'Calendar', key: 'calendar', fieldType: 'structured', options: { shape: 'calendar' }, required: false });
    }
    store.mutate({ type: 'table.update', id, position: pos });
    return id;
  }

  /**
   * A JUNCTION between two tables (sql/016, contract/junction.ts), fully wired in
   * one synchronous run — one batch, one Ctrl+Z:
   *   the table (kind 'junction'), its two "single" endpoint links named after the
   *   tables they point at, a Status select with NO choices (the vocabulary is the
   *   owner's to type, not ours to guess), a Notes field, the config — and a
   *   backlink column on EACH endpoint table, named after the junction, which is
   *   where pairs get made. Returns the new table's id, or null.
   */
  function createJunction(rawName: string, tableA: string, tableB: string): string | null {
    const name = rawName.trim();
    const A = store.state.tables.get(tableA), B = store.state.tables.get(tableB);
    if (!name || !A || !B) return null;
    const id = crypto.randomUUID();
    const pos = Math.max(0, ...tablesSorted(store.state).map((t) => t.position ?? 0)) + 1;
    store.mutate({ type: 'table.create', id, name, singularName: '', color: '', icon: '', kind: 'junction' });
    // Two endpoints on the same table get distinct keys even when A === B.
    const keyA = deriveKey(A.singular_name || A.name) || 'a';
    let keyB = deriveKey(B.singular_name || B.name) || 'b';
    if (keyB === keyA) keyB = `${keyB}_2`;
    const a = crypto.randomUUID(), b = crypto.randomUUID(), status = crypto.randomUUID();
    store.mutate({ type: 'field.create', id: status, tableId: id, name: 'Status', key: 'status', fieldType: 'select', options: { choices: [] }, required: false });
    store.mutate({ type: 'field.create', id: a, tableId: id, name: A.singular_name || A.name, key: keyA, fieldType: 'link', options: { target_table_id: tableA, single: true }, required: false });
    store.mutate({ type: 'field.create', id: b, tableId: id, name: B.singular_name || B.name, key: keyB, fieldType: 'link', options: { target_table_id: tableB, single: true }, required: false });
    store.mutate({ type: 'field.create', id: crypto.randomUUID(), tableId: id, name: 'Notes', key: 'notes', fieldType: 'long_text', options: {}, required: false });
    store.mutate({ type: 'table.update', id, position: pos, junction: { a, b, status } });
    // The columns on the endpoint tables: a backlink each, at the junction's `a` / `b`.
    const columnKey = (tableId: string) => {
      const have = new Set(fields(tableId).map((f) => f.key));
      const base = deriveKey(name) || 'pairs';
      let k = base; for (let i = 2; have.has(k); i++) k = `${base}_${i}`;
      return k;
    };
    const colA = crypto.randomUUID(), colB = crypto.randomUUID();
    store.mutate({ type: 'field.create', id: colA, tableId: tableA, name, key: columnKey(tableA), fieldType: 'backlink', options: { source_field_id: a }, required: false });
    // Same table on both ends (a file derived from a file): one column per end, told apart by name.
    const nameB = tableA === tableB ? `${name} (other end)` : name;
    store.mutate({ type: 'field.create', id: colB, tableId: tableB, name: nameB, key: columnKey(tableB), fieldType: 'backlink', options: { source_field_id: b }, required: false });
    if (tableA === tableB) joinLastSection(tableA, [colA, colB]);
    else { joinLastSection(tableA, [colA]); joinLastSection(tableB, [colB]); }
    return id;
  }


  /* ── a select into a link: a vocabulary table (Oct 17) ───────────────────────

     The one type change allowed, and it is not a change: "convert into a NEW field,
     leaving the original until you delete it" (FieldSettings.vue's own rule). A
     select's choices become a TABLE — one row per choice, and per value stored under
     the select that is not a choice (a bound list may have shrunk), with a Name and
     an Aliases column, ticked utility — and a single link to it stands where the
     select stood, every record linked to the row of its value. The recipe's output
     that wrote the select now writes the link. One synchronous run: one Ctrl+Z.
     The select stays, renamed "(old select)", so nothing is lost until someone has
     looked and deletes it — compare pairs and views that named it still do. */
  async function convertSelectToLink(fieldId: string): Promise<string | null> {
    const f = store.state.fields.get(fieldId);
    if (!f || f.type !== 'select') return null;
    const tableId = f.table_id, name = f.name, oldKey = f.key;
    const r = await askFull({
      title: `Convert “${f.name}” into a link`, label: 'Name of the new table', initial: f.name, okText: 'Convert',
      body: `A new table gets one row per choice (a Name and an Aliases column), ticked “utility” so it folds away in the tree. `
        + `A single link to it takes this field's place and every record is linked to the row of its value; a File drop output mapped here is re-pointed. `
        + `This select stays as “${f.name} (old select)” until you delete it. One Ctrl+Z undoes the lot.`,
    });
    const tableName = r?.value.trim();
    if (!tableName) return null;
    // Every record, so every stored value gets its row and its link.
    await store.loadTable(tableId);
    const have = new Set(fields(tableId).map((x) => x.key));
    const base = deriveKey(name) || 'link';
    let key = base; for (let i = 2; have.has(key); i++) key = `${base}_${i}`;
    const values: string[] = [...(contractChoices(f.options) ?? [])];
    for (const rec of recordsOf(store.state, tableId)) { const v = rec.data[oldKey]; if (typeof v === 'string' && v.trim() && !values.includes(v)) values.push(v); }

    // ── one synchronous run from here ──
    const newTable = crypto.randomUUID();
    const tpos = Math.max(0, ...tablesSorted(store.state).map((t) => t.position ?? 0)) + 1;
    store.mutate({ type: 'table.create', id: newTable, name: tableName, singularName: '', color: '', icon: '' });
    const nameField = crypto.randomUUID(), aliasField = crypto.randomUUID();
    store.mutate({ type: 'field.create', id: nameField, tableId: newTable, name: 'Name', key: 'name', fieldType: 'text', options: {}, required: false });
    store.mutate({ type: 'field.update', id: nameField, position: 0 });
    store.mutate({ type: 'field.create', id: aliasField, tableId: newTable, name: 'Aliases', key: ALIASES_KEY, fieldType: 'long_text', options: {}, required: false });
    store.mutate({ type: 'field.update', id: aliasField, position: 1 });
    store.mutate({ type: 'table.update', id: newTable, position: tpos, utility: true });
    const rowOf = new Map<string, string>();
    for (const v of values) { const id = crypto.randomUUID(); rowOf.set(v, id); store.mutate({ type: 'record.create', id, tableId: newTable, data: { name: v } }); }

    const linkId = crypto.randomUUID();
    store.mutate({ type: 'field.create', id: linkId, tableId, name, key, fieldType: 'link', options: { target_table_id: newTable, single: true }, required: false });
    store.mutate({ type: 'field.update', id: linkId, position: Math.max(0, ...fields(tableId).map((x) => x.position)) + 1 });
    store.mutate({ type: 'field.update', id: fieldId, name: `${name} (old select)` });
    // In the select's place: the same section, right after it.
    const a = arrangement(tableId);
    const sec = a.sections.find((s) => s.fields.includes(fieldId));
    const group = sec ? sec.fields : a.top;
    const after = group[group.indexOf(fieldId) + 1] ?? null;
    setArrangement(tableId, placeField(a, linkId, sec?.id ?? null, after === linkId ? null : after), true);
    pairLink(linkId, tableId, newTable, name);
    for (const rec of recordsOf(store.state, tableId)) {
      const v = rec.data[oldKey];
      const row = typeof v === 'string' ? rowOf.get(v) : undefined;
      if (row) store.mutate({ type: 'link.add', id: crypto.randomUUID(), fieldId: linkId, fromRecord: rec.id, toRecord: row });
    }
    // The recipe: an output that wrote the select writes the link now — when it may
    // (a vocabulary output; "media" into a link is refused by the rule both sides run).
    const t = store.state.tables.get(tableId);
    const tools = t?.tools as TablesTools | undefined;
    if (tools?.file_drop) {
      let changed = false;
      const steps = tools.file_drop.steps.map((step) => {
        const map = { ...step.map };
        for (const [k, id] of Object.entries(map)) {
          const out = analyzerOf(step.analyzer)?.outputs.find((o) => o.key === k);
          if (id === fieldId && out && fieldAccepts(out, { id: linkId, type: 'link', options: { target_table_id: newTable } })) { map[k] = linkId; changed = true; }
        }
        return { ...step, map };
      });
      if (changed) store.mutate({ type: 'table.update', id: tableId, tools: { ...tools, file_drop: { ...tools.file_drop, steps } } });
    }
    notice(`“${name}” is a link to ${tableName} now (${values.length} row${values.length === 1 ? '' : 's'}); the old select is kept as “${name} (old select)” — delete it once you have looked`);
    return newTable;
  }

  function renameTable(id: string, rawName: string) {
    const name = rawName.trim();
    if (name && name !== store.state.tables.get(id)?.name) store.mutate({ type: 'table.update', id, name });
  }

  /* ── deleting: say what will really go, and whether it can come back ─────────

     The server is asked first (POST /api/capture-preview — the same capture the
     delete itself takes, cascades included). These dialogs used to count the records
     the BROWSER happened to have loaded and promise "everything is captured, and can
     be restored from History" — which stopped being true at 10,000 captured rows
     (records, links, cards and pairs all count), where the server kept only the
     numbers and deleted anyway. Over that, the delete is now refused unless it says
     it is meant to be permanent, and saying so takes typing the name. */
  interface Preview { exists: boolean; counts: Record<string, number>; total: number; truncated: boolean; limit: number }
  const num = (x: number) => x.toLocaleString('en-US');
  const WORDS: Record<string, [string, string]> = {
    records: ['record', 'records'], links: ['link', 'links'], placements: ['card on a canvas', 'cards on canvases'],
    fields: ['field', 'fields'], views: ['saved view', 'saved views'], canvases: ['canvas', 'canvases'],
    canvas_annotations: ['canvas annotation', 'canvas annotations'], record_values: ['value', 'values'],
  };
  function goes(counts: Record<string, number>, only?: string[]): string {
    const parts = (only ?? ['records', 'record_values', 'links', 'placements', 'canvases', 'canvas_annotations', 'fields', 'views'])
      .filter((k) => counts[k] > 0).map((k) => `${num(counts[k])} ${WORDS[k][counts[k] === 1 ? 0 : 1]}`);
    return parts.length ? parts.join(', ') : 'nothing else';
  }
  async function previewOf(mutation: { type: 'table.delete' | 'field.delete'; id: string }): Promise<Preview | null> {
    await store.settled(3000);            // a table made a moment ago has to exist there before it can be counted
    const r = await store.call<Preview>('POST', '/api/capture-preview', mutation).catch(() => null);
    return r && r.ok ? r.data : null;
  }
  /** The confirmation for a delete that is over the cap: the name has to be typed. */
  const typeToDelete = async (what: string, name: string, p: Preview, extra = '') => !!(await askFull({
    title: `Delete the ${what} “${name}” — this cannot be undone`, danger: true, okText: 'Delete for good',
    body: `${num(p.total)} rows go with it (${goes(p.counts)}) — more than History can keep (${num(p.limit)}).${extra}\n`
      + 'They would be gone for good. The only way back is a backup.',
    label: `Type “${name}” to go ahead`, mustMatch: name,
  }));

  async function deleteTable(id: string): Promise<boolean> {
    const t = store.state.tables.get(id);
    if (!t) return false;
    const n = recordsOf(store.state, id).length;
    const boards = t.kind === 'canvas' ? ' Every record in it is a canvas — the boards and everything placed on them go too.'
      : t.kind === 'report' ? ' Every record in it is a report — their definitions and any snapshots attached to them go too.'
      : t.kind === 'calendar' ? ' Every record in it is a calendar — their definitions go too (the records they show do not).'
      : t.kind === 'junction' ? ' Every record in it is a pair — the columns it put on the two tables it connects go too.' : '';
    const p = await previewOf({ type: 'table.delete', id });
    if (p?.truncated) {
      if (!await typeToDelete('table', t.name, p, boards)) return false;
    } else {
      const body = p
        ? `It will be deleted with everything that goes with it: ${goes(p.counts)}.${boards}\nEverything is captured, and can be restored from History.`
        // The server could not be asked. Promise nothing it has not confirmed.
        : `It and its ${n} loaded record(s) will be deleted.${boards}\nThe server could not be asked how much goes with it: if that is more than History can keep, it will refuse the delete.`;
      if (!await confirmDialog({ title: `Delete the table “${t.name}”?`, danger: true, okText: 'Delete table', body })) return false;
    }
    // A junction's columns on its endpoint tables would be left "broken backlink":
    // take them in the same run, so the delete is one Ctrl+Z either way.
    const j = junctionOf(t);
    if (j) {
      for (const f of store.state.fields.values()) {
        if (f.type === 'backlink' && (f.options?.source_field_id === j.a || f.options?.source_field_id === j.b)) store.mutate({ type: 'field.delete', id: f.id });
      }
    }
    store.mutate(p?.truncated ? { type: 'table.delete', id, withoutUndo: true } : { type: 'table.delete', id });
    return true;
  }

  /* ── fields ───────────────────────────────────────────────────────────── */

  /** Why this draft cannot be created, or null. Same rules the server applies. */
  function draftError(tableId: string, d: FieldDraft): string | null {
    if (!d.name.trim()) return 'a field needs a name';
    const key = d.key || deriveKey(d.name);
    if (!/^[a-z][a-z0-9_]*$/.test(key)) return 'key must be lowercase snake_case, starting with a letter';
    if (fields(tableId).some((f) => f.key === key)) return `key '${key}' already exists on this table`;
    if (d.type === 'link' && !d.target) return 'a link field needs a target table';
    if (d.type === 'structured') return shapeOptionError({ shape: d.shape || undefined });
    if (d.type === 'backlink') {
      return backlinkConfigError(tableId, { source_field_id: d.source }, (id) => store.state.fields.get(id));
    }
    if (d.type === 'lookup') {
      // The server runs this same function (contract/lookups.ts) on write.
      return lookupConfigError(tableId, { via_field_id: d.via, target_field_id: d.show },
        (id) => store.state.fields.get(id));
    }
    return null;
  }

  /** Creates the field LAST in the table. Returns its id, or the reason it can't. */
  function createField(tableId: string, d: FieldDraft): { id: string } | { error: string } {
    const error = draftError(tableId, d);
    if (error) return { error };
    const options: Record<string, unknown> = {};
    if (d.type === 'link') options.target_table_id = d.target;
    if (d.type === 'lookup') { options.via_field_id = d.via; options.target_field_id = d.show; }
    if (d.type === 'backlink') options.source_field_id = d.source;
    if (d.type === 'structured') options.shape = d.shape;
    if (d.type === 'select' || d.type === 'multi_select') {
      if (d.vocabulary) options.vocabulary = d.vocabulary;
      else { const choices = parseChoices(d.choices); if (choices.length) options.choices = choices; }
    }
    const id = crypto.randomUUID();
    const pos = Math.max(0, ...fields(tableId).map((f) => f.position)) + 1;
    store.mutate({ type: 'field.create', id, tableId, name: d.name.trim(),
      key: d.key || deriveKey(d.name), fieldType: d.type, options, required: false });
    store.mutate({ type: 'field.update', id, position: pos });
    joinLastSection(tableId, [id]);
    // A link's OTHER FACE: a backlink on the target, named after this table ("Deliverables"
    // on Works for Works.Deliverables → "Work"... on Deliverables), in the same run — one
    // Ctrl+Z makes both. One relation, two faces (contract/backlinks.ts); a link to its own
    // table gets "<name> (other end)", as a junction on one table does.
    if (d.type === 'link' && d.pair !== false) pairLink(id, tableId, d.target, d.name.trim());
    return { id };
  }

  /**
   * The backlink that is the other face of link `linkId` — made unless the target already
   * has one for it. Named after the source table ("Online Edits"); when that table links to
   * the target MORE than once, every face says which link it is ("Online Edits (via Inputs)",
   * "Online Edits (via Outputs)") — and a sibling still wearing the bare name is renamed in
   * the same run, or the two columns would be indistinguishable. A name someone chose is
   * left alone. Returns the backlink's id (new or existing).
   */
  function pairLink(linkId: string, tableId?: string, targetId?: string, linkName?: string): string | null {
    const link = store.state.fields.get(linkId);
    const from = tableId ?? link?.table_id, to = targetId ?? (link?.options?.target_table_id as string | undefined);
    const lname = linkName ?? link?.name ?? 'link';
    if (!from || !to) return null;
    const existing = fields(to).find((f) => f.type === 'backlink' && f.options?.source_field_id === linkId);
    if (existing) return existing.id;
    const own = store.state.tables.get(from)?.name ?? 'Links';
    const siblings = [...store.state.fields.values()].filter((f) => f.type === 'link' && f.id !== linkId && f.table_id === from && f.options?.target_table_id === to);
    const via = siblings.length > 0;
    const name = to === from ? `${lname} (other end)` : via ? `${own} (via ${lname})` : own;
    for (const sib of siblings) {
      const face = fields(to).find((f) => f.type === 'backlink' && f.options?.source_field_id === sib.id);
      if (face && face.name === own) store.mutate({ type: 'field.update', id: face.id, name: `${own} (via ${sib.name})` });
    }
    const have = new Set(fields(to).map((f) => f.key));
    const base = deriveKey(name) || 'links';
    let key = base; for (let i = 2; have.has(key); i++) key = `${base}_${i}`;
    const id = crypto.randomUUID();
    const pos = Math.max(0, ...fields(to).map((f) => f.position)) + 1;
    store.mutate({ type: 'field.create', id, tableId: to, name, key, fieldType: 'backlink', options: { source_field_id: linkId }, required: false });
    store.mutate({ type: 'field.update', id, position: pos });
    joinLastSection(to, [id]);
    return id;
  }
  /** The backlinks that are this link's other face, wherever they are. */
  const facesOf = (linkId: string) => [...store.state.fields.values()].filter((f) => f.type === 'backlink' && f.options?.source_field_id === linkId);

  /* ── the desktop client's tools on a table (contract/tools.ts) ──────────── */

  /**
   * Write a table's whole tools config (a recipe per tool). Refused here, before it
   * is queued, with the same rule the server runs — a bad recipe must never reach
   * the log. Returns the problem, or null.
   */
  /** A junction's config, replaced whole — validated here as the server does (contract/junction.ts). */
  function setJunction(tableId: string, junction: JunctionConfig): string | null {
    const err = junctionProblem(tableId, junction, store.state.fields.values());
    if (err) return err;
    store.mutate({ type: 'table.update', id: tableId, junction });
    return null;
  }

  function setTools(tableId: string, tools: TablesTools): string | null {
    const err = toolsProblem(tools, fields(tableId));
    if (err) return err;
    store.mutate({ type: 'table.update', id: tableId, tools });
    return null;
  }

  /**
   * Turn a tool on with its DEFAULT recipe (File drop: filesystem, then ffprobe;
   * Resolve: its one step), every output mapped to a same-KEY field that accepts
   * it, and a field CREATED for each output the tool cannot run without (File
   * drop's Path; the Resolve tool has none). One Ctrl+Z. Nothing else is created:
   * the admin picks which outputs deserve a column.
   */
  function enableTool(tableId: string, tool: ToolId): string | null {
    const recipe = defaultRecipe(tool);
    for (const step of recipe.steps) {
      const a = analyzerOf(step.analyzer)!;
      for (const out of a.outputs) {
        const f = fields(tableId).find((x) => x.key === out.key && fieldAccepts(out, x));
        if (f) step.map[out.key] = f.id;
      }
    }
    for (const r of REQUIRED_BY_TOOL[tool]) {
      const step = recipe.steps.find((s) => s.analyzer === r.analyzer);
      if (!step || r.key in step.map) continue;
      const out = analyzerOf(r.analyzer)!.outputs.find((o) => o.key === r.key)!;
      const made = addToolFields(tableId, [out]);
      if (made[r.key]) step.map[r.key] = made[r.key];
    }
    return setTools(tableId, { ...currentTools(tableId), [tool]: recipe });
  }
  function disableTool(tableId: string, tool: ToolId) {
    const tools = { ...currentTools(tableId) } as Partial<TablesTools>;
    delete tools[tool];
    return setTools(tableId, tools as TablesTools);
  }
  const enableFileDrop = (tableId: string) => enableTool(tableId, 'file_drop');
  const disableFileDrop = (tableId: string) => disableTool(tableId, 'file_drop');

  function currentTools(tableId: string): TablesTools {
    return (store.state.tables.get(tableId)?.tools ?? {}) as TablesTools;
  }

  /**
   * A field per output, shaped as the output wants it (a select gets the analyzer's
   * choices, a structured field its shape, a byte count its display format), named
   * and keyed like the output. Skips keys the table already has. Returns output
   * key → new field id.
   */
  function addToolFields(tableId: string, outputs: readonly Output[]): Record<string, string> {
    const have = new Set(fields(tableId).map((f) => f.key));
    let pos = Math.max(0, ...fields(tableId).map((f) => f.position));
    const made: Record<string, string> = {};
    for (const out of outputs) {
      if (have.has(out.key)) continue;
      // A LINK output needs to know which table to link into, which only the owner
      // can say: he makes the link field himself, then maps the output to it.
      if (out.type === 'link') continue;
      const id = crypto.randomUUID();
      let [type, shape] = out.type.split(':');
      // A text output meant to be READ at length (ffprobe's raw dump) gets a long-text column.
      if (type === 'text' && out.key === 'raw_dump') type = 'long_text';
      const options: Record<string, unknown> = {};
      if (shape) options.shape = shape;
      if (out.vocabulary) options.vocabulary = out.vocabulary;
      else if (out.choices) options.choices = [...out.choices];
      if (out.key === 'total_size') options.format = 'bytes';
      store.mutate({ type: 'field.create', id, tableId, name: out.name, key: out.key, fieldType: type as FieldType, options, required: false });
      store.mutate({ type: 'field.update', id, position: ++pos });
      made[out.key] = id;
      have.add(out.key);
    }
    joinLastSection(tableId, Object.values(made));
    return made;
  }

  function renameField(id: string, rawName: string) {
    const name = rawName.trim();
    if (name && name !== store.state.fields.get(id)?.name) store.mutate({ type: 'field.update', id, name });
  }

  function setChoices(id: string, raw: string) {
    const f = store.state.fields.get(id);
    if (!f) return;
    // Merged into the existing options rather than replacing them — a select
    // field may grow other options later, and this line should not eat them.
    store.mutate({ type: 'field.update', id, options: { ...f.options, choices: parseChoices(raw) } });
  }

  /**
   * Bind a select to a built-in vocabulary (contract/vocab.ts), or unbind it (''):
   * bound, its choices come from the code and the typed list is dropped; unbound,
   * it is an ordinary select again with no choices until some are typed.
   */
  function setVocabulary(id: string, vocabulary: string): string | null {
    const f = store.state.fields.get(id);
    if (!f) return null;
    const options: Record<string, unknown> = { ...f.options };
    delete options.choices;
    if (vocabulary) options.vocabulary = vocabulary; else delete options.vocabulary;
    const err = vocabularyOptionError(options);
    if (err) return err;
    store.mutate({ type: 'field.update', id, options });
    return null;
  }

  /**
   * "Records of this table BELONG to what this field links to" — the flag scope
   * is built on (contract/scope.ts). One per table per target: turning it on here
   * turns it off on any other link from this table to the same target, in the
   * same step, because the server would refuse two.
   */
  /** "At most one link per record." The server refuses a second; pickers replace. */
  /**
   * "single", on either face. On a link: its holder links to one record (`single`). On a
   * backlink: a target is linked from one record — written to the LINK as `single_target`,
   * because the rule is the relation's, and the server enforces it there.
   */
  function setSingle(id: string, on: boolean) {
    const f = store.state.fields.get(id);
    if (!f) return;
    if (f.type === 'backlink') {
      const src = store.state.fields.get(backlinkSourceOf(f) ?? '');
      if (!src || src.type !== 'link') return;
      const { single_target: _old, ...rest } = src.options ?? {};
      void _old;
      store.mutate({ type: 'field.update', id: src.id, options: on ? { ...rest, single_target: true } : rest });
      return;
    }
    if (f.type !== 'link') return;
    const { single: _old, ...rest } = f.options ?? {};
    void _old;
    store.mutate({ type: 'field.update', id, options: on ? { ...rest, single: true } : rest });
  }

  /**
   * A link field's MATCH — the pairs of fields its picker narrows by
   * (contract/match.ts). Checked here by the rule the server runs, so a bad pair is
   * said in the form rather than refused on the wire. An empty list removes the
   * option. Pairs already BROKEN (a field deleted since) are not held against the
   * edit: removing one of them is exactly what the form is for.
   */
  function setMatch(id: string, pairs: MatchPair[]): string | null {
    const f = store.state.fields.get(id);
    if (!f || f.type !== 'link') return 'only a link field narrows its picker';
    const { match: _old, ...rest } = f.options ?? {};
    void _old;
    const err = linkMatchError({ ...f, options: { ...rest, match: pairs } }, (fid) => store.state.fields.get(fid), f.options?.match);
    if (err) return err;
    store.mutate({ type: 'field.update', id, options: pairs.length ? { ...rest, match: pairs } : rest });
    return null;
  }

  /**
   * Show a link or backlink as a COUNT — "3 Edits" — where a record gets one line:
   * the grid, a board card, a canvas card (contract/pills.ts). The tray still lists.
   */
  function setCount(id: string, on: boolean) {
    const f = store.state.fields.get(id);
    if (!f || (f.type !== 'link' && f.type !== 'backlink')) return;
    const { count: _old, ...rest } = f.options ?? {};
    void _old;
    store.mutate({ type: 'field.update', id, options: on ? { ...rest, count: true } : rest });
  }

  function setMembership(id: string, on: boolean) {
    const f = store.state.fields.get(id);
    if (!f || f.type !== 'link') return;
    if (on) {
      for (const other of fields(f.table_id)) {
        if (other.id !== id && isMembership(other) && other.options?.target_table_id === f.options?.target_table_id) {
          const { membership: _drop, ...rest } = other.options ?? {};
          void _drop;
          store.mutate({ type: 'field.update', id: other.id, options: rest });
        }
      }
    }
    const { membership: _old, ...rest } = f.options ?? {};
    void _old;
    store.mutate({ type: 'field.update', id, options: on ? { ...rest, membership: true } : rest });
  }

  /**
   * How a link field's relationships are drawn (contract/arrows.ts). Merged into
   * the field's options — a link field's options also hold its target table, and
   * `field.update` replaces options whole. `color: null` clears the colour.
   */
  function setArrowStyle(id: string, patch: { color?: string | null; reversed?: boolean }) {
    const f = store.state.fields.get(id);
    if (!f || f.type !== 'link') return;
    const next: ArrowStyle = { ...arrowStyleOf(f) };
    if (patch.color === null) delete next.color; else if (patch.color) next.color = patch.color;
    if (patch.reversed !== undefined) { if (patch.reversed) next.reversed = true; else delete next.reversed; }
    const options: Record<string, unknown> = { ...f.options };
    if (Object.keys(next).length) options.arrow = next; else delete options.arrow;
    store.mutate({ type: 'field.update', id, options });
  }

  /**
   * Put the table's fields in exactly this order. Every reorder goes through
   * here, and it writes positions 0..n-1 for anything not already there —
   * normalising first. Positions can COLLIDE (seeded data and scripted creates
   * all sit at 0), and swapping two fields that are both at 0 changes nothing.
   */
  function reorder(ordered: FieldRow[]) {
    ordered.forEach((f, i) => {
      if (f.position !== i) store.mutate({ type: 'field.update', id: f.id, position: i });
    });
  }

  /** The whole order at once (a drag in Table settings): every changed position, one batch. */
  function reorderFields(tableId: string, ids: string[]) {
    const by = new Map(fields(tableId).map((f) => [f.id, f]));
    const ordered = ids.map((id) => by.get(id)).filter((f): f is FieldRow => !!f);
    // System fields (created_at …) are not in the list: they keep to the end, in their order.
    for (const f of fields(tableId)) if (!ids.includes(f.id)) ordered.push(f);
    reorder(ordered);
  }

  /* ── sections: the fields, grouped for the record tray (contract/fieldSections.ts) ──

     The schema editor shows ONE list: the unsectioned fields, then each section's
     bar with its fields under it. That list is an ARRANGEMENT, and every change to
     it — a field dragged, a bar dragged, a section made, renamed or removed, a new
     field — goes through `setArrangement`, which writes both halves in one run (one
     Ctrl+Z): the fields' positions, in the order shown, and the sections. */

  /** The table's fields as the editor shows them. */
  function arrangement(tableId: string): Arrangement {
    return arrangementOf(fields(tableId).map((f) => f.id), fieldSectionsOf(store.state.tables.get(tableId)));
  }

  /**
   * Write an arrangement: the fields' positions in the order shown, and the sections.
   * Each half only if IT changed — renaming a section must not renumber the fields
   * (positions name the primary; an edit that is not about order has no business near
   * them). `renumber` writes the positions regardless. Returns the problem, or null.
   */
  function setArrangement(tableId: string, a: Arrangement, renumber = false): string | null {
    const t = store.state.tables.get(tableId);
    if (!t) return 'no such table';
    const err = fieldSectionsProblem(a.sections);
    if (err) return err;
    if (renumber || flatOrder(a).join() !== flatOrder(arrangement(tableId)).join()) reorderFields(tableId, flatOrder(a));
    // Compared with what is STORED, not with how it reads: an edit also lists the fields a
    // section held only by position, and drops the ids of fields long gone.
    if (!sameSections(a.sections, fieldSectionsOf(t))) {
      store.mutate({ type: 'table.update', id: tableId, fieldSections: a.sections });
    }
    return null;
  }

  /**
   * New fields go where the list ENDS — which, on a table with sections, is the end
   * of its last section. Said explicitly: left unlisted, a new field would be drawn
   * with the field before it (contract/fieldSections.ts), and so miss a last section
   * that is still EMPTY — the one just made to hold it.
   */
  function joinLastSection(tableId: string, fieldIds: string[]) {
    const a = arrangement(tableId);
    if (!a.sections.length || !fieldIds.length) return;
    const next = appendFields(a, fieldIds);
    // Against what is STORED: a field already drawn there by position is still to be LISTED there.
    if (!sameSections(next.sections, fieldSectionsOf(store.state.tables.get(tableId)))) store.mutate({ type: 'table.update', id: tableId, fieldSections: next.sections });
  }

  /** A new, empty section at the end of the list. Returns its id. */
  function addSection(tableId: string, rawName: string): string | null {
    const name = rawName.trim();
    if (!name) return null;
    const id = crypto.randomUUID();
    return setArrangement(tableId, arrAddSection(arrangement(tableId), { id, name })) === null ? id : null;
  }
  /** Rename a section, or set whether it STARTS folded in the record tray. */
  function updateSection(tableId: string, sectionId: string, patch: { name?: string; folded?: boolean }) {
    const a = arrangement(tableId), next = arrUpdateSection(a, sectionId, patch);
    if (next !== a) setArrangement(tableId, next);
  }
  /** Remove a section's bar. Its fields stay: they join the group above. */
  function removeSection(tableId: string, sectionId: string) {
    const a = arrangement(tableId), next = arrRemoveSection(a, sectionId);
    if (next !== a) setArrangement(tableId, next);
  }

  /** One step up or down the list as shown — across a section's bar at its edge. */
  function moveField(id: string, dir: -1 | 1) {
    const f = store.state.fields.get(id);
    if (!f) return;
    const a = arrangement(f.table_id), next = stepField(a, id, dir);
    if (next !== a) setArrangement(f.table_id, next);
  }

  /**
   * "Records in this table are named by this field" = move it first (contract/
   * labels.ts) — and first of all is first of the UNSECTIONED, so it leaves its section.
   */
  function makePrimary(id: string) {
    const f = store.state.fields.get(id);
    if (!f || !LABEL_TYPES.has(f.type)) return;
    // Renumbered whatever the list says: this is THE act about which field is first.
    setArrangement(f.table_id, fieldFirst(arrangement(f.table_id), id), true);
  }

  /** Is this the field that names the table's records? */
  function isPrimary(id: string): boolean {
    const f = store.state.fields.get(id);
    return !!f && fields(f.table_id).find((x) => LABEL_TYPES.has(x.type))?.id === id;
  }
  const canBePrimary = (f: { type: string }) => LABEL_TYPES.has(f.type);

  async function deleteField(id: string): Promise<boolean> {
    const f = store.state.fields.get(id);
    if (!f) return false;
    const n = recordsOf(store.state, f.table_id).filter((r) => f.key in r.data).length;
    // A link's other faces go with it: a backlink with no link is a broken column.
    const faces = f.type === 'link' ? facesOf(id) : [];
    const naming = (isPrimary(id) ? '\nIt is the PRIMARY field: records will be named by the next field instead.' : '')
      + (faces.length ? `\nIts other side${faces.length > 1 ? 's' : ''} — ${faces.map((x) => `“${x.name}” on ${store.state.tables.get(x.table_id)?.name ?? '?'}`).join(', ')} — go${faces.length > 1 ? '' : 'es'} with it.` : '');
    const p = await previewOf({ type: 'field.delete', id });
    if (p?.truncated) {
      if (!await typeToDelete('field', f.name, p, naming)) return false;
    } else {
      const held = p?.counts[f.type === 'link' ? 'links' : 'record_values'] ?? 0;
      const values = !p
        ? (f.type === 'link' ? 'Its links go with it.' : `Its values on ${n} loaded record(s) are removed.`)
          + ' The server could not be asked how many that is: if it is more than History can keep, it will refuse the delete.'
        : f.type === 'link'
          ? (held ? `Its ${num(held)} link(s) are captured and can be restored from History.` : 'It holds no links. The field itself can be restored from History.')
          : (held ? `Its value on ${num(held)} record(s) is removed, but captured — restorable from History.` : 'No record has a value in it. The field itself can be restored from History.');
      if (!await confirmDialog({ title: `Delete the field “${f.name}”?`, body: `${values}${naming}`, danger: true, okText: 'Delete field' })) return false;
    }
    for (const x of faces) store.mutate({ type: 'field.delete', id: x.id });
    store.mutate(p?.truncated ? { type: 'field.delete', id, withoutUndo: true } : { type: 'field.delete', id });
    return true;
  }

  return {
    createTable, createJunction, renameTable, deleteTable, setJunction, convertSelectToLink,
    draftError, createField, renameField, setChoices, moveField, reorderFields, makePrimary, isPrimary,
    arrangement, setArrangement, addSection, updateSection, removeSection,
    canBePrimary, deleteField,
    pairLink, facesOf, setArrowStyle, setMembership, setSingle, setCount, setMatch, setVocabulary, setTools, enableTool, disableTool, enableFileDrop, disableFileDrop, addToolFields, linkFieldsOf, lookupViasOf, lookupTargetsOf, describeLookup, linkFieldsInto, describeBacklink,
  };
}
export type SchemaActions = ReturnType<typeof useSchemaActions>;
