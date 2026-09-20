/**
 * ============================================================================
 *  The scope contract — "I am working on Duke".
 * ============================================================================
 *
 *  A SECTION may name one of its tables as its scope table (Projects). Choosing a
 *  record of it — a project — narrows every table in the section that BELONGS to
 *  projects down to that one. The rules, all agreed before a line was written
 *  (PLAN.md, "Sections, a home page, and scope"):
 *
 *  1. MEMBERSHIP IS EXPLICIT. A link field carries `options.membership = true`:
 *     "a record of this table belongs to the record it links to". Only flagged
 *     fields scope a table — never "any link to Projects", because a table can
 *     have several ("Project", "Originally delivered for") and auto-linking a new
 *     record has to fill exactly one. At most one membership field per table per
 *     target. Any table can be a scope table this way; nothing is special about
 *     Projects.
 *  2. DIRECT ONLY. Notes → Edits → Projects is not followed. Which path? What if
 *     a note's edits are in two projects? Give Notes its own Project link; it is
 *     filled in automatically, so it costs nothing.
 *  3. IT IS A FILTER over fully loaded tables — not a different way of loading.
 *     That keeps it trivially correct (a lookup through an out-of-scope record
 *     still has its data). Server-side scoped loading can come when a table is
 *     big enough to need it.
 *  4. NOTHING BECOMES INVISIBLE. Records with no project at all are reachable as
 *     "Unassigned"; a table with no membership field is shown whole, and says so.
 *  5. A record may belong to several projects, and appears in each.
 *  6. ARCHIVED projects (a checkbox the section nominates) leave the switcher and
 *     their records leave "All" — unless you ask to see them.
 *
 *  Scope is a way of LOOKING. It is kept per browser (and in the URL, so a link
 *  can carry it); it is never written to the database and changes nothing for
 *  anyone else.
 */

export type Scope =
  | { kind: 'all' }
  | { kind: 'unassigned' }
  | { kind: 'record'; id: string };

export const ALL: Scope = { kind: 'all' };

interface FieldLike { id: string; table_id: string; type: string; options?: Record<string, unknown> | null }

export const isMembership = (f: FieldLike) => f.type === 'link' && f.options?.membership === true;

/** The field through which records of `tableId` belong to records of `scopeTableId`, if any. */
export function membershipFieldOf<F extends FieldLike>(fields: Iterable<F>, tableId: string, scopeTableId: string): F | undefined {
  for (const f of fields) {
    if (f.table_id === tableId && isMembership(f) && f.options?.target_table_id === scopeTableId) return f;
  }
  return undefined;
}

/** Why `options.membership` is not acceptable on this field, or null. Uniqueness needs the database; see apply.ts. */
export function membershipError(fieldType: string, options: Record<string, unknown> | null | undefined): string | null {
  const m = options?.membership;
  if (m === undefined) return null;
  if (typeof m !== 'boolean') return 'membership must be true or false';
  if (m && fieldType !== 'link') return 'only a link field can mean membership';
  return null;
}

/**
 * Is a record in scope, given the scope-table records it belongs to (`memberOf`,
 * from its membership links)?
 *
 *   record      it belongs to that one
 *   unassigned  it belongs to none
 *   all         everything — except records whose EVERY project is archived,
 *               unless archived ones are being shown. A record in one live and one
 *               archived project is still live.
 */
export function inScope(scope: Scope, memberOf: readonly string[], archived: ReadonlySet<string>, showArchived: boolean): boolean {
  if (scope.kind === 'record') return memberOf.includes(scope.id);
  if (scope.kind === 'unassigned') return memberOf.length === 0;
  return showArchived || memberOf.length === 0 || memberOf.some((id) => !archived.has(id));
}

export function formatScope(s: Scope): string { return s.kind === 'record' ? s.id : s.kind === 'unassigned' ? 'none' : ''; }
export function parseScope(raw: string | null | undefined): Scope {
  if (!raw) return ALL;
  if (raw === 'none') return { kind: 'unassigned' };
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw) ? { kind: 'record', id: raw } : ALL;
}
