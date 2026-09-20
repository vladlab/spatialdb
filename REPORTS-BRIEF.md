# Brief: reports — how data gets OUT of spatialdb

For a separate design-and-build session. Nothing here is built. The owner's words:
*"Reports are actually a huge feature and I want them. Even more broadly, reports are
how I want to get data out of this system."* He explicitly does not want this crept
into other work — design it first.

**Source of truth:** <https://github.com/vladlab/spatialdb>. Read `API.md`, then
PLAN.md → "The owner's data model, and 'a new record inherits its context'".

## The example to design against

His schema (deliberately light on data entry):

- **Works** (an episode) link to the **Deliverables** wanted of them — a shared
  catalogue ("ProRes 4444 texted", "DCP 2K Flat"). Episode 101 also wants a DCP;
  episode 106 a sister-network version. Bid vs. added later are TWO LINK FIELDS on
  Work ("roles are link fields").
- **Files** link to a Work, and — only when the file is a deliverable — to a
  Deliverable. *The file is the evidence* that the deliverable was satisfied.

The report he wants, inside a project scope:

```
Ep 101
  ProRes 4444 texted      ep101_prores_v2.mov   (delivered 2026-09-14)
                          ep101_prores_v1.mov   (superseded)
  DCP 2K Flat             — nothing yet —
Ep 102
  ProRes 4444 texted      — nothing yet —
```

And the questions behind it: *Did we satisfy every deliverable of this work? Which
files were delivered? How many were delivered versus scoped in the bid?*

## Why the grid cannot do it

Grouping exists (`groupRows` in `src/contract/views.ts`, ≤ 2 levels). Grouping Files
by Work then Deliverable shows only groups that HAVE rows — a deliverable with no
files never appears, and the missing ones are the whole point. The expected list
lives in the WORK's link to Deliverables, not in Files. So the report is a
**three-way join**: for each work, for each deliverable it links to, the files linked
to BOTH. Generic form: given a link field A → B, and a table C with links to A and
to B, show for each `a`, each `b` it links to, the `c` that link to both.

## What "reports" probably has to cover

- The join above (and whether it is a special grouping option — "empty groups come
  from the parent's link field" — or its own report view).
- **Counts and rollups**: "4 of 5 delivered" on the Work; bid vs. added totals. There
  is no count/rollup field type yet; group headers show counts, which is the only
  aggregate today.
- **Saved report definitions**, shared like views; respecting scope.
- **Getting it out**: print / PDF / CSV. Who reads these — the owner, a producer, a
  client? That decides how much layout matters.
- Whether a report is READ-ONLY (likely) — which frees it from the grid's fixed row
  height and windowing, the constraints that make the grid rigid.

## Constraints to respect

- Everything loads whole tables client-side today, and scope is a FILTER over loaded
  tables (deliberately — `contract/scope.ts` rule 3). A report may be the first thing
  that wants a server-side query; if so, design that read deliberately and document
  it in `API.md`.
- Shared contract files are the pattern: if grid and report must agree on what a
  group or a filter means, the rule lives in `src/contract/`.
- Wire-format changes stop for the owner's review before anything is built on them.
- His standing preference: conceptualise needs before building, to avoid scope creep.
