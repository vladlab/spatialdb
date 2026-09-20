/**
 * ============================================================================
 *  The label contract — what a record is CALLED.
 * ============================================================================
 *
 *  A link chip, a canvas card's title, a row in the link picker and the tray all
 *  need one short string for a record. The rule:
 *
 *      A RECORD IS NAMED BY ITS TABLE'S PRIMARY FIELD, and the primary field is
 *      THE FIRST FIELD, by position, that holds a plain value.
 *
 *  Shared, because the server labels records too — the far ends of links to
 *  tables the client has not loaded (`labels` in GET …/records) — and a chip must
 *  not change its text the moment its table finishes loading.
 *
 *  What this replaced: "`data.name` if present, else the first non-empty string
 *  in `data`". Two things wrong with it. "First" meant first KEY, and jsonb does
 *  not preserve key order (it sorts by length, then bytes), so a record with no
 *  `name` could be labelled by one value before a reload and another after. And
 *  it was unexplainable: nobody could say which column names a record, or change
 *  it. Field POSITION is stored, ordered, user-controlled, and already streamed.
 *
 *  Why "first field" rather than a `primary_field_id` column: it needs no
 *  migration, no new mutation, no new undo capture, and it cannot dangle — there
 *  is no id to point at a deleted field. "Make this the primary field" is "move
 *  it first", which the schema could already express. It is also Airtable's rule,
 *  which is the model this app's owner already has in his head.
 */

/** Types whose value reads as a name. Links, checkboxes and sets do not. */
export const LABEL_TYPES: ReadonlySet<string> =
  new Set(['text', 'long_text', 'number', 'date', 'select', 'file_path']);

export interface LabelField { key: string; type: string; position: number; name: string }

/**
 * THE ordering of fields, used everywhere fields are listed. Position, then
 * name — positions can tie (seeded data and scripted creates sit at 0), and a
 * tie broken differently on client and server would pick different primaries.
 * Plain code-point comparison, not localeCompare: the server may not share the
 * browser's locale, and "same answer everywhere" beats "correct for Swedish".
 */
export function compareFields(a: LabelField, b: LabelField): number {
  return a.position - b.position || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}

/** The key of a table's primary field, given that table's fields (any order). */
export function primaryKeyOf(fields: LabelField[]): string | undefined {
  return [...fields].sort(compareFields).find((f) => LABEL_TYPES.has(f.type))?.key;
}

/**
 * The label. `fallback` is for a record whose primary cell is empty — callers
 * pass something that at least distinguishes it (the client uses a short id).
 */
export function labelFrom(data: unknown, primaryKey: string | undefined, fallback: string): string {
  const v = primaryKey ? (data as Record<string, unknown> | null)?.[primaryKey] : undefined;
  return v === undefined || v === null || v === '' ? fallback : String(v);
}
