/**
 * ============================================================================
 *  How a link-like field is SHOWN where a record gets one line.
 * ============================================================================
 *
 *  A link, a backlink and a junction column all show linked records as PILLS
 *  (client/components/RecordPill.vue). A busy one — "Files" on a Work, forty of
 *  them — is noise in a grid cell: four names, then "+36". Such a field can say
 *  so, and be shown as a COUNT instead:
 *
 *      field.options.count = true          "40 Files"
 *
 *  It is about the ONE-LINE surfaces only: the grid cell, a board (kanban) card,
 *  a canvas card's row. The record tray always lists every linked record — that
 *  is where the count's ⤢ takes you. Nothing about the data changes: sorting,
 *  filtering, search, lookups and reports read the same links as before.
 *
 *  Shared so the server refuses the setting where it means nothing (a text
 *  field) and the client reads it tolerantly (anything but `true` is "pills").
 */

const LINKLIKE = new Set(['link', 'backlink']);

/** Is this field shown as a count on the one-line surfaces? */
export function showsCount(f: { type: string; options?: Record<string, unknown> | null }): boolean {
  return LINKLIKE.has(f.type) && f.options?.count === true;
}

/** Why `options.count` is not acceptable, or null. Absent is fine. */
export function countOptionError(fieldType: string, options: Record<string, unknown> | null | undefined): string | null {
  const c = options?.count;
  if (c === undefined) return null;
  if (typeof c !== 'boolean') return 'count must be true or false';
  if (c && !LINKLIKE.has(fieldType)) return 'only a link or a backlink field can be shown as a count';
  return null;
}

/**
 * What the count reads as: the number, then what is being counted — the table's
 * name as it is typed ("3 Edits"), its singular name for exactly one ("1 Edit")
 * when the table has one. Kept apart (`n` / `noun`) because the pill draws the
 * number heavier than the noun.
 */
export function countNoun(n: number, table: { name?: string; singular_name?: string | null } | undefined): string {
  if (!table?.name) return n === 1 ? 'record' : 'records';
  return n === 1 ? table.singular_name || table.name : table.name;
}
