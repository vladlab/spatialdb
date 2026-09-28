/**
 * SYSTEM FIELDS: "Created" and "Created by" — facts the database already keeps for
 * every record (`records.created_at`, `records.created_by`) and never exposed as
 * fields. Now every table has them, read-only, sortable and filterable like any
 * field, with NO rows in the `fields` table and no migration:
 *
 *   - The client SYNTHESISES a FieldRow per table per system field. Its id is
 *     derived from the table's id (the last group replaced by a fixed marker), so
 *     it is stable, unique, and still uuid-shaped — which is what lets a saved
 *     view sort or filter by it (`ViewConfig` ids are uuids).
 *   - The value lives in `record.data` under a RESERVED KEY (`_created_at`,
 *     `_created_by`), folded in by the client when a record arrives. Reserved keys
 *     start with "_", which the app never lets a user choose, and the server
 *     ignores them in a write.
 *
 * Both are consulted by name in the two places that matter: `client/state.ts`
 * (`fieldsOf`) and `server/apply.ts` (strip on write; refuse a field of this type).
 */

export const SYSTEM_FIELDS = [
  { suffix: '00000000c7ea', key: '_created_at', name: 'Created', type: 'created_at' },
  { suffix: '00000000c7eb', key: '_created_by', name: 'Created by', type: 'created_by' },
] as const;

export const SYSTEM_FIELD_TYPES = new Set<string>(SYSTEM_FIELDS.map((f) => f.type));
export const SYSTEM_KEYS = new Set<string>(SYSTEM_FIELDS.map((f) => f.key));
export const isSystemKey = (key: string) => key.startsWith('_');

/** The id of a system field on `tableId`: the table's uuid with its last group replaced. */
export function systemFieldId(tableId: string, suffix: string): string {
  return tableId.slice(0, 24) + suffix;
}
export const isSystemFieldId = (id: string) => SYSTEM_FIELDS.some((f) => id.endsWith(f.suffix)) && id.length === 36;

/** A stored `_created_at` (ISO) shown as a short local date-time. */
export function formatCreated(v: unknown): string {
  if (typeof v !== 'string' || !v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
