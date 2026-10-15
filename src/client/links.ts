/**
 * Adding a link, the ONE way. A link field ticked "single" holds at most one link
 * per record; the server refuses a second. So adding to a single field means
 * REPLACING: remove the old link and add the new one in the same synchronous run —
 * one batch, one Ctrl+Z. Every place that adds a link goes through here so none of
 * them can forget.
 */
import type { Store } from './store';

export function addLink(store: Store, fieldId: string, fromRecord: string, toRecord: string) {
  if (!toRecord) return;
  const f = store.state.fields.get(fieldId);
  if (f?.options?.single === true) {
    for (const l of store.state.links.values()) {
      if (l.field_id === fieldId && l.from_record === fromRecord && l.to_record !== toRecord) {
        store.mutate({ type: 'link.remove', fieldId, fromRecord, toRecord: l.to_record });
      }
    }
  }
  store.mutate({ type: 'link.add', id: crypto.randomUUID(), fieldId, fromRecord, toRecord });
}

/**
 * A relation edited from EITHER FACE. A link field: the row is held on `recordId`.
 * A backlink: the row is held on `other`, through the backlink's source link — the
 * same row, the same undo, the same "single" rule (a single link on `other` is
 * replaced). A junction column is a pair, not a link: nothing here (JunctionEditor).
 */
export function addLinkThrough(store: Store, field: { id: string; type: string; options?: Record<string, unknown> | null }, recordId: string, other: string) {
  if (field.type === 'link') return addLink(store, field.id, recordId, other);
  const src = field.type === 'backlink' ? field.options?.source_field_id : undefined;
  if (typeof src === 'string') addLink(store, src, other, recordId);
}
export function removeLinkThrough(store: Store, field: { id: string; type: string; options?: Record<string, unknown> | null }, recordId: string, other: string) {
  if (field.type === 'link') { store.mutate({ type: 'link.remove', fieldId: field.id, fromRecord: recordId, toRecord: other }); return; }
  const src = field.type === 'backlink' ? field.options?.source_field_id : undefined;
  if (typeof src === 'string') store.mutate({ type: 'link.remove', fieldId: src, fromRecord: other, toRecord: recordId });
}

/**
 * Making a junction PAIR, the one way (sql/016): the row and its two endpoint links,
 * in one synchronous run — one batch (whole or nothing, apply.ts checks) and one
 * Ctrl+Z. `from` is the record on `side`; `other` the record at the other end.
 * Returns the new row's id. The caller has already made sure the pair has no row.
 */
export function addPair(store: Store, table: string, cfg: { a: string; b: string; status?: string }, side: 'a' | 'b', from: string, other: string, status = ''): string {
  const id = crypto.randomUUID();
  const key = cfg.status ? store.state.fields.get(cfg.status)?.key : undefined;
  store.mutate({ type: 'record.create', id, tableId: table, data: key && status ? { [key]: status } : {} });
  store.mutate({ type: 'link.add', id: crypto.randomUUID(), fieldId: side === 'a' ? cfg.a : cfg.b, fromRecord: id, toRecord: from });
  store.mutate({ type: 'link.add', id: crypto.randomUUID(), fieldId: side === 'a' ? cfg.b : cfg.a, fromRecord: id, toRecord: other });
  return id;
}
