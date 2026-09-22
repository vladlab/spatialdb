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
