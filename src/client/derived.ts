/**
 * Values that are not IN a record: links, lookups, backlinks.
 *
 * A link is rows in `links`; a lookup is computed across a link; a backlink is
 * the same rows read from the other end. All three need the link index and the
 * label rule, and the grid, the canvas and the record panel had each grown their
 * own copy of both. This is the one copy. The RULES are not here — they are in
 * contract/{labels,lookups,backlinks}.ts, shared with the server; this file only
 * feeds them from the store.
 *
 * Everything is a `computed` over the store, so nothing is cached by hand: add a
 * link, edit a far record, or receive either from a peer, and every cell, card
 * row and panel line that depends on it re-renders.
 */

import { computed } from 'vue';
import type { Store } from './store';
import { primaryKeys, type FieldRow } from './state';
import { labelFrom } from '../contract/labels';
import { lookupOptionsOf, lookupText, lookupValues } from '../contract/lookups';
import { backlinkRecords, backlinkSourceOf } from '../contract/backlinks';

const NONE: string[] = [];

export function useDerived(store: Store) {
  /** Both directions, built in one pass whenever the links map changes. */
  const index = computed(() => {
    const from = new Map<string, string[]>(), to = new Map<string, string[]>();
    const push = (m: Map<string, string[]>, k: string, v: string) => {
      const a = m.get(k);
      if (a) a.push(v); else m.set(k, [v]);
    };
    for (const l of store.state.links.values()) {
      push(from, l.from_record + l.field_id, l.to_record);
      push(to, l.to_record + l.field_id, l.from_record);
    }
    return { from, to };
  });
  const labelKeys = computed(() => primaryKeys(store.state));

  /** Records `recordId` links TO through `fieldId`. */
  const linksFrom = (recordId: string, fieldId: string) => index.value.from.get(recordId + fieldId) ?? NONE;
  /** Records that link to `recordId` THROUGH `fieldId` (a link field elsewhere). */
  const linkedTo = (recordId: string, fieldId: string) => index.value.to.get(recordId + fieldId) ?? NONE;

  const getField = (id: string) => store.state.fields.get(id);
  const getData = (id: string) => store.state.records.get(id)?.data;

  function labelOfId(id: string): string {
    const r = store.state.records.get(id);
    return r ? labelFrom(r.data, labelKeys.value.get(r.table_id), id.slice(0, 8))
      : store.farLabels.get(id) ?? id.slice(0, 8);
  }

  /** Lookup values as text, or null when the lookup is broken. */
  function lookupOf(recordId: string, f: FieldRow): string[] | null {
    const vals = lookupValues(f, recordId, getField, linksFrom, getData);
    return vals === null ? null : lookupText(vals);
  }
  /** Ids of the records pointing here through a backlink's source, or null if broken. */
  const backlinkOf = (recordId: string, f: FieldRow) => backlinkRecords(f, recordId, getField, linkedTo);

  /**
   * One derived field as TEXT — what sorting, filtering, search and canvas card
   * rows all want. `broken` distinguishes "depends on something deleted" from
   * "empty".
   */
  function textOf(recordId: string, f: FieldRow): { texts: string[]; broken: boolean } {
    if (f.type === 'link') return { texts: linksFrom(recordId, f.id).map(labelOfId), broken: false };
    if (f.type === 'lookup') { const v = lookupOf(recordId, f); return { texts: v ?? [], broken: v === null }; }
    if (f.type === 'backlink') { const v = backlinkOf(recordId, f); return { texts: (v ?? []).map(labelOfId), broken: v === null }; }
    return { texts: [], broken: false };
  }

  /**
   * Tables a field reads from OTHER than its own — they must be loaded for it to
   * show anything. A lookup reads the table its link points at; a backlink reads
   * the table its source field lives on (the labels of the records linking in).
   */
  function tablesNeededBy(fields: FieldRow[]): string[] {
    const out = new Set<string>();
    for (const f of fields) {
      if (f.type === 'lookup') {
        const via = lookupOptionsOf(f)?.via_field_id;
        const far = via ? getField(via)?.options?.target_table_id : undefined;
        if (typeof far === 'string') out.add(far);
      } else if (f.type === 'backlink') {
        const src = backlinkSourceOf(f);
        const t = src ? getField(src)?.table_id : undefined;
        if (t) out.add(t);
      }
    }
    return [...out];
  }

  /**
   * EVERY incoming link to a record, grouped by the field it comes through —
   * whether or not the table has a backlink field for it. The record panel's
   * "Referenced by". Only as complete as what is loaded: links arrive with the
   * tables (and canvases) that have been opened.
   */
  function referencedBy(recordId: string): Array<{ field: FieldRow; tableName: string; from: string[] }> {
    const byField = new Map<string, string[]>();
    for (const l of store.state.links.values()) {
      if (l.to_record !== recordId) continue;
      const a = byField.get(l.field_id);
      if (a) a.push(l.from_record); else byField.set(l.field_id, [l.from_record]);
    }
    return [...byField].flatMap(([fieldId, from]) => {
      const field = getField(fieldId);
      return field ? [{ field, from, tableName: store.state.tables.get(field.table_id)?.name ?? '' }] : [];
    });
  }

  return { labelKeys, linksFrom, linkedTo, labelOfId, lookupOf, backlinkOf, textOf, tablesNeededBy, referencedBy };
}
