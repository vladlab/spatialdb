/**
 * ============================================================================
 *  Duplicating records.
 * ============================================================================
 *
 *  A duplicate is the record's VALUES and its OUTGOING LINKS, as a new record:
 *
 *    - every field's value is copied, except the automatic ones — created_at and
 *      created_by are the server's to set, so the copy is created now, by whoever
 *      is duplicating, not by the original's author
 *    - the primary text gets " (copy)": two identical "Texted Master" rows are a
 *      trap, and the suffix is one Backspace-and-retype away from whatever the
 *      copy is really for
 *    - links the record holds are copied; backlinks are what OTHER records say
 *      and are not; junction pairs are not (a duplicated file is a new export —
 *      it starts unpaired; and one-per-pair forbids a second row anyway)
 *    - attachments and rich text copy by reference: the same asset, not an upload
 *    - nothing is placed on any canvas the original was on
 *
 *  A record of a junction table cannot be duplicated (the pair would be a second
 *  row for the same two records — refused by the server; refused here first).
 *  A board record duplicates its NAME; copying a board's contents is a different
 *  feature.
 *
 *  Everything for one call runs synchronously: one batch on the server, one Ctrl+Z.
 */

import type { Store } from './store';
import { fieldsOf, isJunctionTable, type RecordRow } from './state';
import { primaryKeyOf } from '../contract/labels';
import { SYSTEM_FIELD_TYPES } from '../contract/systemFields';

/** Field types whose values a duplicate does not carry. */
const NOT_COPIED = new Set([...SYSTEM_FIELD_TYPES, 'lookup', 'backlink']);

/** Duplicate `ids` (all from one table or several). Returns the new ids, in the same order; [] if nothing could be. */
export function duplicateRecords(store: Store, ids: string[]): string[] {
  const out: string[] = [];
  for (const id of ids) {
    const rec = store.state.records.get(id);
    if (!rec) continue;
    const table = store.state.tables.get(rec.table_id);
    if (!table || isJunctionTable(table)) continue;
    out.push(duplicateOne(store, rec));
  }
  return out;
}

function duplicateOne(store: Store, rec: RecordRow): string {
  const fields = fieldsOf(store.state, rec.table_id);
  const data: Record<string, unknown> = {};
  for (const f of fields) {
    if (NOT_COPIED.has(f.type)) continue;
    const v = rec.data[f.key];
    if (v !== undefined && v !== null) data[f.key] = structuredClone(v);
  }
  // " (copy)" on the primary, when it is text (a number or date primary is left alone).
  const pk = primaryKeyOf(fields);
  const primary = fields.find((f) => f.key === pk);
  if (primary && (primary.type === 'text' || primary.type === 'long_text' || primary.type === 'file_path')) {
    const cur = typeof data[pk!] === 'string' ? (data[pk!] as string) : '';
    data[pk!] = cur ? `${cur} (copy)` : 'copy';
  }
  const id = crypto.randomUUID();
  store.mutate({ type: 'record.create', id, tableId: rec.table_id, data });
  // Outgoing links, field by field, in their stored order.
  const linkFields = new Set(fields.filter((f) => f.type === 'link').map((f) => f.id));
  for (const l of store.state.links.values()) {
    if (l.from_record === rec.id && linkFields.has(l.field_id)) {
      store.mutate({ type: 'link.add', id: crypto.randomUUID(), fieldId: l.field_id, fromRecord: id, toRecord: l.to_record });
    }
  }
  return id;
}
