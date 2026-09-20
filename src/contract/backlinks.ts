/**
 * ============================================================================
 *  The backlink contract — the other end of a link, shown as a field.
 * ============================================================================
 *
 *  `Edits.inputs → Files` lives on the edit. A backlink field on Files, pointed
 *  at that link field, shows the same relationships from the file's side:
 *  "Input to: OEV3, DCP v1". It is how a record's ROLE becomes visible — and,
 *  being a column, sortable and filterable ("files nothing uses").
 *
 *      options: { source_field_id }     // a link field whose TARGET is this table
 *
 *  Same arrangement as lookups.ts, for the same reasons: the configuration rule
 *  is shared (the field form runs it, the server runs it on write), the values
 *  are computed on the client from links it already holds, nothing is stored in
 *  records.data, and a backlink whose source field has been deleted resolves to
 *  null — BROKEN, shown as such, and repaired if that delete is undone.
 *
 *  The source may be a link field on the SAME table. That is the OEV1 → OEV2 →
 *  OEV3 case: "Previous version" is a link from Edits to Edits, and a backlink
 *  on it is "Next version".
 *
 *  Why not Airtable's approach — creating a paired link field on the other table
 *  and keeping the two in sync? Because that is two copies of one fact, and the
 *  schema comment that mentions it (`symmetric_field_id`) was never implemented
 *  for good reason: every link write would become two, atomically, with its own
 *  undo story. A backlink is a VIEW of the one fact.
 */

import type { LookupFieldInfo } from './lookups.js';

export function backlinkSourceOf(f: { options?: Record<string, unknown> | null }): string | null {
  const id = f.options?.source_field_id;
  return typeof id === 'string' && id ? id : null;
}

/** Why this backlink configuration is not acceptable, or null. */
export function backlinkConfigError(
  tableId: string,
  options: Record<string, unknown> | null | undefined,
  getField: (id: string) => LookupFieldInfo | undefined,
): string | null {
  const id = backlinkSourceOf({ options });
  if (!id) return 'a backlink needs the link field it is the other end of';
  const src = getField(id);
  if (!src) return 'that link field does not exist';
  if (src.type !== 'link') return 'a backlink must be the other end of a LINK field';
  if (src.options?.target_table_id !== tableId) {
    return 'that link field does not point at this table';
  }
  return null;
}

/**
 * The records linking TO `recordId` through the source field, oldest link first.
 * `null` = broken (the source field is gone).
 */
export function backlinkRecords(
  field: { options?: Record<string, unknown> | null },
  recordId: string,
  getField: (id: string) => LookupFieldInfo | undefined,
  linkedTo: (recordId: string, sourceFieldId: string) => string[],
): string[] | null {
  const id = backlinkSourceOf(field);
  const src = id ? getField(id) : undefined;
  if (!src || src.type !== 'link') return null;
  return linkedTo(recordId, src.id);
}
