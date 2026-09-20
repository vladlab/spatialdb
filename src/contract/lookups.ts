/**
 * ============================================================================
 *  The lookup contract — a field whose value lives on another record.
 * ============================================================================
 *
 *  "Show the deliverable's required codec on the file's row." A lookup field has
 *  no value of its own: it FOLLOWS one of its table's link fields and READS one
 *  field off whatever records are at the far end.
 *
 *      options: { via_field_id, target_field_id }
 *
 *  Shared because both sides need the same two things. The server checks a
 *  lookup's configuration when it is written (`lookupConfigError`), so a lookup
 *  that points at nothing sensible can never be stored. The client computes the
 *  values (`lookupValues`) — it holds whole tables (see contract/views.ts), so a
 *  lookup is a Map walk, recomputed reactively the instant a link or a far value
 *  changes, including from a peer. `resolveLookup` in server/reads.ts predates
 *  that and is now unused by the grid.
 *
 *  Decisions:
 *
 *  - A LOOKUP YIELDS A LIST. A record can link to several others, so there can
 *    be several values. They are shown comma-separated; sorting uses the joined
 *    text. Rollups (sum / min / max / count) were considered and deferred until
 *    one is actually wanted — they are a different field type, not an option
 *    bolted on here.
 *  - NO LOOKUPS OF LOOKUPS, and no lookups of link fields. The first needs cycle
 *    detection and ordering; the second is "show me the far record's links",
 *    which is a second hop by another name. Both can be added; neither is free.
 *  - A BROKEN LOOKUP IS NOT AN ERROR AT READ TIME. Deleting the link field or the
 *    far field it depends on does not rewrite the lookup (same reasoning as views
 *    and field.delete: undoing the delete then repairs it for free). It resolves
 *    to `null`, which the UI shows as broken rather than as empty.
 */

export interface LookupFieldInfo {
  id: string; table_id: string; key: string; type: string;
  options?: Record<string, unknown> | null;
}

export interface LookupOptions { via_field_id: string; target_field_id: string }

export function lookupOptionsOf(f: { options?: Record<string, unknown> | null }): LookupOptions | null {
  const via = f.options?.via_field_id, target = f.options?.target_field_id;
  // Non-EMPTY strings: an unchosen <select> is '', and "does not exist" is the wrong
  // thing to tell someone who simply has not picked yet.
  return typeof via === 'string' && via && typeof target === 'string' && target
    ? { via_field_id: via, target_field_id: target } : null;
}

/** Types a lookup may read. */
export const LOOKUP_TARGET_TYPES: ReadonlySet<string> = new Set([
  'text', 'long_text', 'number', 'date', 'select', 'multi_select', 'checkbox', 'file_path',
]);

/**
 * Why this lookup configuration is not acceptable, or null. `getField` resolves
 * an id to a field — from the store on the client, from a query on the server —
 * so the RULE exists once even though the lookups differ.
 */
export function lookupConfigError(
  tableId: string,
  options: Record<string, unknown> | null | undefined,
  getField: (id: string) => LookupFieldInfo | undefined,
): string | null {
  const o = lookupOptionsOf({ options });
  if (!o) return 'a lookup needs a link field to follow and a field to show';
  const via = getField(o.via_field_id);
  if (!via) return 'the link field to follow does not exist';
  if (via.type !== 'link') return 'a lookup must follow a LINK field';
  if (via.table_id !== tableId) return 'the link field must belong to the same table as the lookup';
  const farTable = via.options?.target_table_id;
  const target = getField(o.target_field_id);
  if (!target) return 'the field to show does not exist';
  if (typeof farTable === 'string' && target.table_id !== farTable) {
    return 'the field to show must belong to the table the link points at';
  }
  if (!LOOKUP_TARGET_TYPES.has(target.type)) {
    return `a lookup cannot show a ${target.type} field`;
  }
  return null;
}

/**
 * The values, in link order. `null` means the lookup is BROKEN (its link field
 * or far field is gone) — distinct from `[]`, which means "nothing linked" or
 * "linked, but the far cell is empty". Far records that are not loaded yet are
 * skipped, so a lookup fills in as its target table arrives.
 */
export function lookupValues(
  field: LookupFieldInfo,
  recordId: string,
  getField: (id: string) => LookupFieldInfo | undefined,
  linkedFrom: (recordId: string, viaFieldId: string) => string[],
  getRecordData: (recordId: string) => Record<string, unknown> | undefined,
): unknown[] | null {
  const o = lookupOptionsOf(field);
  if (!o) return null;
  const via = getField(o.via_field_id), target = getField(o.target_field_id);
  if (!via || via.type !== 'link' || !target) return null;
  const out: unknown[] = [];
  for (const farId of linkedFrom(recordId, via.id)) {
    const v = getRecordData(farId)?.[target.key];
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) out.push(...v); else out.push(v);
  }
  return out;
}

/** One cell's worth of text. Booleans read as words: "true" in a grid is noise. */
export function lookupText(values: unknown[]): string[] {
  return values.map((v) => (v === true ? 'yes' : v === false ? 'no' : String(v)));
}
