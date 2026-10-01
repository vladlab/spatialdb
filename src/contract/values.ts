/**
 * ============================================================================
 *  Field VALUE validation — the third shared contract file.
 * ============================================================================
 *
 *  `mutations.ts` closed the write surface; `events.ts` closed the read
 *  surface. This closes the last unshared judgement: whether a VALUE is legal
 *  for its field's type. Before this file a `number` field accepted "banana" —
 *  the keys were checked, the values were not.
 *
 *  Shared for the same structural reason as the other two: the client wants to
 *  reject bad input before it is ever queued (an optimistic write that the
 *  server will bounce is a lie on screen until the bounce arrives), and the
 *  server must enforce the same rule regardless of client. Two implementations
 *  of "what is a valid date" WILL drift; one function cannot.
 *
 *  Deliberate decisions, so they are argued with rather than rediscovered:
 *
 *  - VALIDATE ON WRITE ONLY. Rows written before a rule existed are left
 *    alone; a bad old value surfaces the next time someone edits that field,
 *    which is the moment they can actually fix it. No retro-migration.
 *  - NO NULLS. "Empty" has exactly one representation: the key is absent
 *    (`unset` removes it). Allowing null as a second empty would make every
 *    read site check two things forever.
 *  - `required` IS NOT ENFORCED HERE. This validates values that are present.
 *    Whether a value must be present is a form-level question for the UI —
 *    enforcing it in apply would make `unset` and partial creates illegal in
 *    ways that fight the per-field merge model.
 */

import type { FIELD_TYPES } from './mutations.js';
import { VOCABULARIES } from './vocab.js';
import { attachmentError, richTextError } from './richtext.js';
import { shapeOf, structuredError } from './shapes.js';
import { ReportDef } from './reports.js';

export type FieldType = (typeof FIELD_TYPES)[number];

/** What a validator needs to know about a field. A subset of the fields row. */
export interface FieldShape {
  key: string;
  type: FieldType;
  options: Record<string, unknown>;
}

/**
 * A select's choices — THE one place they are read. A select bound to a built-in
 * vocabulary (`options.vocabulary`, contract/vocab.ts) has no choices of its own:
 * they come from the code, so every bound select grows when the list grows. Null
 * when the field has none (an unconstrained select).
 */
export function choicesOf(options: Record<string, unknown> | null | undefined): string[] | null {
  const v = options?.vocabulary;
  if (typeof v === 'string' && VOCABULARIES[v]) return [...VOCABULARIES[v].choices];
  const c = options?.choices;
  if (!Array.isArray(c) || c.length === 0) return null;
  return c.filter((x): x is string => typeof x === 'string');
}

/**
 * Null when `value` is legal for the field, otherwise a human-readable reason
 * phrased for the person typing, since the client shows it verbatim.
 */
export function validateValue(field: FieldShape, value: unknown): string | null {
  if (value === null || value === undefined) {
    return `use unset to clear '${field.key}', not null`;
  }

  switch (field.type) {
    case 'text':
    case 'long_text':
    case 'file_path':
      if (typeof value !== 'string') return `'${field.key}' must be text`;
      // Postgres's jsonb cannot hold U+0000 at all. It turns up in text copied out of
      // binary metadata (a tag off a media file); refused here so it is caught at the
      // cell, with a reason, rather than by the database.
      return value.includes('\u0000') ? `'${field.key}' contains a NUL character (\\u0000), which cannot be stored` : null;

    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
        ? null
        : `'${field.key}' must be a finite number`;

    case 'checkbox':
      return typeof value === 'boolean' ? null : `'${field.key}' must be true or false`;

    case 'date': {
      // A calendar date, `YYYY-MM-DD`, stored as a string. No times and no
      // timezones on purpose: "due 2026-08-07" means the same thing in every
      // office, and the moment a timezone is attached it stops doing so. A
      // field that needs a moment-in-time is a different field type, added
      // when something actually needs it.
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return `'${field.key}' must be a date like 2026-08-07`;
      }
      const [y, mo, d] = value.split('-').map(Number);
      const dt = new Date(Date.UTC(y, mo - 1, d));
      const real = dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
      return real ? null : `'${field.key}': ${value} is not a real date`;
    }

    case 'select': {
      if (typeof value !== 'string') return `'${field.key}' must be one choice`;
      const choices = choicesOf(field.options);
      if (choices && !choices.includes(value)) {
        return `'${field.key}': '${value}' is not one of: ${choices.join(', ')}`;
      }
      return null;
    }

    case 'multi_select': {
      if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
        return `'${field.key}' must be a list of choices`;
      }
      // A multi-select is a SET that happens to be stored as an array. Accepting
      // ['x','x'] is harmless today and a wrong count the day anything groups or
      // filters by this field.
      if (new Set(value).size !== value.length) {
        return `'${field.key}' lists a choice more than once`;
      }
      const choices = choicesOf(field.options);
      if (choices) {
        const bad = value.filter((v) => !choices.includes(v));
        if (bad.length) return `'${field.key}': not among the choices: ${bad.join(', ')}`;
      }
      return null;
    }

    case 'link':
      // Relations are rows in `links`, never values in `data` — that is what
      // makes endpoint validation and undo cascades possible. A value under a
      // link key is always a mistake, usually an import that flattened links
      // into cells.
      return `'${field.key}' is a link field — use link.add, not a value`;

    case 'lookup':
      // Computed from links at read time (resolveLookup). Storing one would
      // create a cached copy that silently goes stale.
      return `'${field.key}' is a lookup — it is computed, not written`;

    case 'rich_text':
      return richTextError(field.key, value);

    case 'attachment':
      return attachmentError(field.key, value);

    case 'structured':
    {
      const shape = shapeOf(field);
      const err = structuredError(field.key, shape, value);
      if (err || shape !== 'report') return err;
      // The definition's SHAPE, on both sides. Whether the fields and tables it names
      // exist is `reportDefError`, which needs the schema: the server runs it in
      // apply.ts, the report editor runs it before saving.
      const r = ReportDef.safeParse(value);
      if (r.success) return null;
      const i = r.error.issues[0];
      return `'${field.key}' (report) — ${i.path.length ? i.path.join('.') + ': ' : ''}${i.message}`;
    }
    case 'created_at':
    case 'created_by':
      // System fields are folded in by the client and stripped by the server; a value
      // never reaches validation. Read-only everywhere.
      return `'${field.key}' is a system field and cannot be set`;

    case 'backlink':
      return `'${field.key}' is a backlink — it shows links made elsewhere; add the link on the other record`;
  }
}
