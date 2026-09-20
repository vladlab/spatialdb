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
import { backlinkConfigError, backlinkSourceOf } from '../contract/backlinks';
import { arrowStyleOf, type ArrowStyle } from '../contract/arrows';
import { isMembership } from '../contract/scope';
import { fieldsOf, recordsOf, tablesSorted, type FieldRow } from './state';
import type { Store } from './store';
import { confirmDialog } from './dialogs';

export type FieldType = (typeof FIELD_TYPES)[number];

export const CREATABLE_TYPES = FIELD_TYPES;

export interface FieldDraft {
  name: string; key: string; type: FieldType;
  /** link: the table it points at. */
  target: string;
  /** select / multi_select: comma separated. */
  choices: string;
  /** lookup: the link field to follow, and the far field to show. */
  via: string; show: string;
  /** backlink: the link field (anywhere) this is the other end of. */
  source: string;
}
export const emptyDraft = (): FieldDraft =>
  ({ name: '', key: '', type: 'text', target: '', choices: '', via: '', show: '', source: '' });

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
export function choicesOf(f: { options?: Record<string, unknown> | null }): string[] {
  const c = f.options?.choices;
  return Array.isArray(c) ? c.filter((x): x is string => typeof x === 'string') : [];
}

export function useSchemaActions(store: Store) {
  const fields = (tableId: string) => fieldsOf(store.state, tableId);

  /* ── lookups ─────────────────────────────────────────────────────────── */

  /** Link fields on this table — what a lookup here can follow. */
  const linkFieldsOf = (tableId: string) => fields(tableId).filter((f) => f.type === 'link');
  /** Fields a lookup following `viaFieldId` can show: readable fields of the far table. */
  function lookupTargetsOf(viaFieldId: string): FieldRow[] {
    const far = store.state.fields.get(viaFieldId)?.options?.target_table_id;
    return typeof far === 'string' ? fields(far).filter((f) => LOOKUP_TARGET_TYPES.has(f.type)) : [];
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
    return { broken: false, text: `${via.name} → ${show.name}` };
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
  function createTable(rawName: string, kind: 'records' | 'canvas' = 'records'): string | null {
    const name = rawName.trim();
    if (!name) return null;
    const id = crypto.randomUUID();
    // Position after the last, so creation order is presentation order. Two
    // mutations — table.create carries no position — but they share a debounce
    // flush and therefore a transaction. (API.md: "set the position".)
    const pos = Math.max(0, ...tablesSorted(store.state).map((t) => t.position ?? 0)) + 1;
    store.mutate({ type: 'table.create', id, name, singularName: '', color: '', icon: '', ...(kind === 'canvas' ? { kind } : {}) });
    // A table of boards is useless without somewhere to put a board's NAME.
    if (kind === 'canvas') {
      store.mutate({ type: 'field.create', id: crypto.randomUUID(), tableId: id, name: 'Name', key: 'name', fieldType: 'text', options: {}, required: false });
    }
    store.mutate({ type: 'table.update', id, position: pos });
    return id;
  }

  function renameTable(id: string, rawName: string) {
    const name = rawName.trim();
    if (name && name !== store.state.tables.get(id)?.name) store.mutate({ type: 'table.update', id, name });
  }

  async function deleteTable(id: string): Promise<boolean> {
    const t = store.state.tables.get(id);
    if (!t) return false;
    const n = recordsOf(store.state, id).length;
    const boards = t.kind === 'canvas' ? ' Every record in it is a canvas — the boards and everything placed on them go too.' : '';
    if (!await confirmDialog({ title: `Delete the table “${t.name}”?`, danger: true, okText: 'Delete table',
      body: `It and its ${n} loaded record(s) will be deleted.${boards}\nEverything is captured, and can be restored from History.` })) return false;
    store.mutate({ type: 'table.delete', id });
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
    if (d.type === 'select' || d.type === 'multi_select') {
      const choices = parseChoices(d.choices);
      if (choices.length) options.choices = choices;
    }
    const id = crypto.randomUUID();
    const pos = Math.max(0, ...fields(tableId).map((f) => f.position)) + 1;
    store.mutate({ type: 'field.create', id, tableId, name: d.name.trim(),
      key: d.key || deriveKey(d.name), fieldType: d.type, options, required: false });
    store.mutate({ type: 'field.update', id, position: pos });
    return { id };
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
   * "Records of this table BELONG to what this field links to" — the flag scope
   * is built on (contract/scope.ts). One per table per target: turning it on here
   * turns it off on any other link from this table to the same target, in the
   * same step, because the server would refuse two.
   */
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

  function moveField(id: string, dir: -1 | 1) {
    const f = store.state.fields.get(id);
    if (!f) return;
    const fs = fields(f.table_id);
    const i = fs.findIndex((x) => x.id === id), j = i + dir;
    if (i === -1 || j < 0 || j >= fs.length) return;
    [fs[i], fs[j]] = [fs[j], fs[i]];
    reorder(fs);
  }

  /** "Records in this table are named by this field" = move it first. See contract/labels.ts. */
  function makePrimary(id: string) {
    const f = store.state.fields.get(id);
    if (!f || !LABEL_TYPES.has(f.type)) return;
    const fs = fields(f.table_id);
    reorder([f, ...fs.filter((x) => x.id !== id)]);
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
    const values = f.type === 'link'
      ? 'Its links are captured and can be restored.'
      : `Its values on ${n} loaded record(s) are removed, but captured — restorable from History.`;
    const naming = isPrimary(id) ? '\nIt is the PRIMARY field: records will be named by the next field instead.' : '';
    if (!await confirmDialog({ title: `Delete the field “${f.name}”?`, body: `${values}${naming}`, danger: true, okText: 'Delete field' })) return false;
    store.mutate({ type: 'field.delete', id });
    return true;
  }

  return {
    createTable, renameTable, deleteTable,
    draftError, createField, renameField, setChoices, moveField, makePrimary, isPrimary,
    canBePrimary, deleteField,
    setArrowStyle, setMembership, linkFieldsOf, lookupTargetsOf, describeLookup, linkFieldsInto, describeBacklink,
  };
}
export type SchemaActions = ReturnType<typeof useSchemaActions>;
