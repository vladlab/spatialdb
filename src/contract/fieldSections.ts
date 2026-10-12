/**
 * ============================================================================
 *  Field sections — a table's fields, grouped for the full record view.
 * ============================================================================
 *
 *  A table with sixty fields is a wall in the record tray. A SECTION is a named
 *  group of fields — "Video", "Audio", "File system" — defined once, in the schema
 *  editor (Table settings), and drawn in the tray as a foldable well of its own.
 *  (Not to be confused with the navigation's sections, sql/009: those group TABLES
 *  in the tree. These group FIELDS inside one table, hence the name.)
 *
 *      tables.field_sections: [
 *        { id, name, folded?: true, fields: [<field id>, …] },
 *        …
 *      ]
 *
 *  The rules, all of them:
 *
 *    * A field is in AT MOST one section. Sections are shown in list order; a
 *      section's fields in ITS list order.
 *    * The UNSECTIONED fields are shown first, above every section, with no header
 *      — the top of the record: its name, its path, what it belongs to.
 *    * A field that NO section lists belongs with the field before it in the
 *      schema's own order (`fields.position`): at the start of that order, before
 *      any sectioned field, it is unsectioned; further down, it is drawn in the
 *      section of the field before it, right after it. So a field made without
 *      the editor (a script, the raw API — last position, listed nowhere) shows at
 *      the end of the last section, where its position says it is, and NOT above
 *      everything. This is what keeps the order drawn and the order stored the
 *      same order — which matters, because the stored order names the PRIMARY
 *      field, and the editor writes the stored order from the drawn one.
 *    * `folded: true` is how the section STARTS for someone who has never touched
 *      it. Each person's own folding is remembered per browser (client/
 *      sectionFolds.ts) and is not in here: folding a section is not a schema edit.
 *    * An id that resolves to no field of the table is SKIPPED, by the precedent of
 *      views, tools and the navigation's sections: `field.delete` does not rewrite
 *      this, and undoing the delete puts the field back where it was. The schema
 *      editor writes only ids that exist, so a later edit drops the stale ones.
 *
 *  Replaced WHOLE by `table.update { fieldSections }`, like `tools` and `junction`.
 *
 *  FIELD POSITIONS are not replaced by this. `fields.position` is still THE field
 *  order (contract/labels.ts): it names the primary and is the default for grid
 *  columns and cards. The schema editor keeps the two in step — every arrangement
 *  it writes lists EVERY sectioned field and sets positions to the order shown
 *  (unsectioned, then section by section) — so a never-arranged grid reads in the
 *  same order as the tray, and "unsectioned" is, in practice, "above the first bar".
 *
 *  LATER: a custom layout for the full view (per saved view, or per person) is
 *  this same shape stored somewhere else, and "reset" is dropping it — this list
 *  being what it resets TO. Nothing here needs to change for that.
 */

import { z } from 'zod';

const uuid = z.guid();

export const FieldSection = z.strictObject({
  id: uuid,
  name: z.string().min(1).max(80),
  /** Starts folded in the record tray. Absent = starts open. */
  folded: z.literal(true).optional(),
  fields: z.array(uuid).max(500),
});
export type FieldSection = z.infer<typeof FieldSection>;

export const FieldSections = z.array(FieldSection).max(50);
export type FieldSections = z.infer<typeof FieldSections>;

/** Why this is not an acceptable `field_sections`, or null. Needs nothing but the value. */
export function fieldSectionsProblem(value: unknown): string | null {
  const parsed = FieldSections.safeParse(value);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return i ? `${i.path.join('.') || 'fieldSections'}: ${i.message}` : 'not a list of field sections';
  }
  const sections = new Set<string>(), fields = new Set<string>();
  for (const s of parsed.data) {
    if (!s.name.trim()) return 'a section needs a name';
    if (sections.has(s.id)) return `section '${s.name}': its id is used twice`;
    sections.add(s.id);
    for (const f of s.fields) {
      if (fields.has(f)) return `section '${s.name}': a field can be in only one section`;
      fields.add(f);
    }
  }
  return null;
}

/** A table's sections — parsed, or none when it has none (or something unreadable). */
export function fieldSectionsOf(t: { field_sections?: unknown } | undefined | null): FieldSections {
  const v = t?.field_sections;
  if (!Array.isArray(v) || !v.length) return [];
  return fieldSectionsProblem(v) === null ? (v as FieldSections) : [];
}

/* ────────────────────────────────────────────────────────────────────────────
 *  Reading: the fields of a table, as groups
 * ──────────────────────────────────────────────────────────────────────────*/

export interface FieldGroup<F> {
  /** null = the unsectioned fields, always the FIRST group. */
  section: FieldSection | null;
  fields: F[];
}

/**
 * `fields` (in SCHEMA order) as groups: the unsectioned first, then one group per
 * section in order — EMPTY sections included (the editor shows them; the tray does
 * not). Never drops a field and never shows one twice.
 *
 * A field no section lists goes with the field before it (see the rules above):
 * unsectioned while nothing sectioned precedes it, otherwise into that field's
 * section, right after it.
 */
export function groupFields<F extends { id: string }>(fields: readonly F[], sections: readonly FieldSection[]): FieldGroup<F>[] {
  const byId = new Map(fields.map((f) => [f.id, f]));
  const home = new Map<string, number>();   // a LISTED field → the index of its section (the first to list it)
  const lists: F[][] = sections.map((section, i) => {
    const own: F[] = [];
    for (const id of section.fields) {
      const f = byId.get(id);
      if (f && !home.has(id)) { home.set(id, i); own.push(f); }
    }
    return own;
  });
  const top: F[] = [];
  let prev: F | undefined, at = -1;         // where the PREVIOUS field (schema order) is: -1 = unsectioned
  for (const f of fields) {
    const listed = home.get(f.id);
    if (listed !== undefined) at = listed;
    else if (at === -1) top.push(f);
    else { const list = lists[at]!; list.splice(list.indexOf(prev!) + 1, 0, f); }
    prev = f;
  }
  return [{ section: null, fields: top }, ...sections.map((section, i) => ({ section, fields: lists[i]! }))];
}

/* ────────────────────────────────────────────────────────────────────────────
 *  Editing: an ARRANGEMENT is every field of the table exactly once
 *
 *  What the schema editor shows and writes. All of these are pure and return the
 *  SAME object when there is nothing to do, so a caller can tell a no-op by `===`.
 * ──────────────────────────────────────────────────────────────────────────*/

export interface Arrangement {
  /** The unsectioned fields, in order. */
  top: string[];
  /** The sections, each listing only fields that EXIST, in order. */
  sections: FieldSection[];
}

/** The arrangement of a table whose own fields are `fieldIds` (schema order). */
export function arrangementOf(fieldIds: readonly string[], sections: readonly FieldSection[]): Arrangement {
  const [top, ...rest] = groupFields(fieldIds.map((id) => ({ id })), sections);
  return {
    top: top!.fields.map((f) => f.id),
    sections: rest.map((g) => ({ ...g.section!, fields: g.fields.map((f) => f.id) })),
  };
}

/** Every field, in the order shown: this is what `fields.position` is set to. */
export const flatOrder = (a: Arrangement): string[] => [...a.top, ...a.sections.flatMap((s) => s.fields)];

/** Which section holds this field — its id, or null for unsectioned (also for an unknown field). */
export function sectionOfField(a: Arrangement, fieldId: string): string | null {
  return a.sections.find((s) => s.fields.includes(fieldId))?.id ?? null;
}

const without = (a: Arrangement, fieldId: string): Arrangement => ({
  top: a.top.filter((x) => x !== fieldId),
  sections: a.sections.map((s) => (s.fields.includes(fieldId) ? { ...s, fields: s.fields.filter((x) => x !== fieldId) } : s)),
});
/** Key order is not meaning: jsonb hands an object back with its keys re-sorted. */
const canon = (sections: readonly FieldSection[]) => JSON.stringify(sections.map((s) => [s.id, s.name, s.folded === true, s.fields]));
/** Do these two lists say the same thing? */
export const sameSections = (x: readonly FieldSection[], y: readonly FieldSection[]) => canon(x) === canon(y);
/** …and these two arrangements? */
export const sameArrangement = (x: Arrangement, y: Arrangement) => x.top.join() === y.top.join() && sameSections(x.sections, y.sections);
const same = sameArrangement;

/**
 * Put a field into `sectionId` (null = unsectioned) just before the field
 * `before` of that same group — or at the group's END when `before` is null or
 * is not in it.
 */
export function placeField(a: Arrangement, fieldId: string, sectionId: string | null, before: string | null): Arrangement {
  if (!flatOrder(a).includes(fieldId)) return a;
  if (sectionId !== null && !a.sections.some((s) => s.id === sectionId)) return a;
  const rest = without(a, fieldId);
  const into = (list: string[]) => {
    const i = before === null ? -1 : list.indexOf(before);
    const out = [...list];
    out.splice(i === -1 ? out.length : i, 0, fieldId);
    return out;
  };
  const next: Arrangement = sectionId === null
    ? { top: into(rest.top), sections: rest.sections }
    : { top: rest.top, sections: rest.sections.map((s) => (s.id === sectionId ? { ...s, fields: into(s.fields) } : s)) };
  return same(next, a) ? a : next;
}

/**
 * One step up or down the list AS SHOWN: within its group, and at the group's
 * edge across the section bar — to the end of the group above, or the start of the
 * one below.
 */
export function stepField(a: Arrangement, fieldId: string, dir: -1 | 1): Arrangement {
  const groups: Array<{ id: string | null; fields: string[] }> = [{ id: null, fields: a.top }, ...a.sections.map((s) => ({ id: s.id, fields: s.fields }))];
  const g = groups.findIndex((x) => x.fields.includes(fieldId));
  if (g === -1) return a;
  const list = groups[g]!.fields, i = list.indexOf(fieldId);
  if (dir === -1) {
    if (i > 0) return placeField(a, fieldId, groups[g]!.id, list[i - 1]!);
    return g > 0 ? placeField(a, fieldId, groups[g - 1]!.id, null) : a;
  }
  if (i < list.length - 1) return placeField(a, fieldId, groups[g]!.id, list[i + 2] ?? null);
  const below = groups[g + 1];
  return below ? placeField(a, fieldId, below.id, below.fields[0] ?? null) : a;
}

/** "Records are named by this field": first of all, which is first of the unsectioned. */
export function fieldFirst(a: Arrangement, fieldId: string): Arrangement {
  if (!flatOrder(a).includes(fieldId)) return a;
  const rest = without(a, fieldId);
  const next = { top: [fieldId, ...rest.top], sections: rest.sections };
  return same(next, a) ? a : next;
}

/** New fields go where the list ends: the LAST section when there is one, else unsectioned. */
export function appendFields(a: Arrangement, fieldIds: readonly string[]): Arrangement {
  const last = a.sections[a.sections.length - 1];
  if (!last || !fieldIds.length) return a;
  let next = a;
  for (const id of fieldIds) next = placeField(next, id, last.id, null);
  return same(next, a) ? a : next;
}

/** A new, empty section at the end. */
export function addSection(a: Arrangement, section: { id: string; name: string }): Arrangement {
  if (a.sections.some((s) => s.id === section.id)) return a;
  return { top: a.top, sections: [...a.sections, { id: section.id, name: section.name, fields: [] }] };
}

export function updateSection(a: Arrangement, sectionId: string, patch: { name?: string; folded?: boolean }): Arrangement {
  const s = a.sections.find((x) => x.id === sectionId);
  if (!s) return a;
  const name = patch.name === undefined ? s.name : patch.name.trim() || s.name;
  const folded = patch.folded === undefined ? s.folded === true : patch.folded;
  const { folded: _old, ...bare } = s;
  void _old;
  const next: FieldSection = folded ? { ...bare, name, folded: true } : { ...bare, name };
  return sameSections([next], [s]) ? a : { top: a.top, sections: a.sections.map((x) => (x.id === sectionId ? next : x)) };
}

/** Remove the BAR, keep the fields: they join the group above it (the unsectioned, for the first). */
export function removeSection(a: Arrangement, sectionId: string): Arrangement {
  const i = a.sections.findIndex((s) => s.id === sectionId);
  if (i === -1) return a;
  const gone = a.sections[i]!;
  const sections = a.sections.filter((s) => s.id !== sectionId);
  if (i === 0) return { top: [...a.top, ...gone.fields], sections };
  return { top: a.top, sections: sections.map((s, j) => (j === i - 1 ? { ...s, fields: [...s.fields, ...gone.fields] } : s)) };
}

/** Move a whole section (its fields with it) to index `to` among the sections. */
export function moveSection(a: Arrangement, sectionId: string, to: number): Arrangement {
  const from = a.sections.findIndex((s) => s.id === sectionId);
  if (from === -1) return a;
  const sections = a.sections.filter((s) => s.id !== sectionId);
  const at = Math.max(0, Math.min(sections.length, to));
  if (at === from) return a;
  sections.splice(at, 0, a.sections[from]!);
  return { top: a.top, sections };
}
