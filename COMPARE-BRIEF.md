# Brief: the comparison engine

A design, agreed with the owner on Sept 22 2026, for a session that will build it.
Nothing here is built. Read `API.md` first; the idioms this leans on (roles are link
fields; derived values are computed, not stored; the file is the evidence) are all
established there and in `PLAN.md`.

**Source of truth:** <https://github.com/vladlab/spatialdb>, `main`.

## 1. What it is, and what it is not

**Comparison** is a live property of two linked records: "evaluate this record's
fields against that record's, and show the result in several ways." It is general —
any two tables joined by a link — even though the first use is files against
deliverable specs.

**QC** is broader and separate: an event that runs comparisons *and* other checks
(probe results, sequence gaps, hashes) at a moment in time and produces a document
(eventually a PDF). QC is a *consumer* of comparison. Nothing in this brief is QC;
QC gets its own design, and probably its own results table on the DeliveryPacket
side of the data model.

Lookups do NOT take part in comparison (see §5 for why).

## 2. Where the rules live: on the link field

There is no new link type. A "comparing link" is an ordinary link field with
`options.compare` set — exactly as a membership link is an ordinary link with
`options.membership`, and a single link one with `options.single`. **Roles are link
fields.**

Why the field: it is the one place that already knows both tables (its owner table
and its target table). The rules are set once, in the field's ⚙, by an admin; every
record using that link gets the comparison. A person entering data never sees a rule.

Direction is fixed by the link: **the target is what is EXPECTED; the owner is what
was FOUND.** (Files → Deliverables: the deliverable expects, the file was found. Same
a/b convention as `diffLayouts`.)

## 3. The rules: pairs

```ts
field.options.compare = {
  pairs: [{ from: fieldId /* owner table */, to: fieldId /* target table */, rule, params? }]
}
```

One target field may appear in several pairs. Names need not match. Rules are typed
by the (owner type, target type) pair — a small, closed set:

| owner ↔ target types | rules |
|---|---|
| text ↔ text, select ↔ select/text | `equals` (`params.caseInsensitive`) |
| checkbox ↔ checkbox | `equals` |
| date ↔ date | `equals`, `onOrBefore`, `onOrAfter` |
| number ↔ number | `equals`, `within` (`params.tolerance`), `atLeast`, `atMost` (a spec's "minimum bitrate" is `atLeast`) |
| link ↔ link (same target table) | `sameRecord`, `sameSet` |
| structured audio_layout ↔ same | `layout` → `diffLayouts` (exists) |
| structured manifest ↔ same | later: `kind`, `fileCount`, … |

**Empties mean something.** Target empty → `unspecified` (the spec does not say;
the pair is skipped, not failed). Owner empty while the target has a value →
`missing` (a difference). Both empty → `unspecified`.

**Name-matching is a default, not the rule.** Ticking "compare" on a link
pre-populates every same-name, same-type pair with the obvious rule; the admin edits
from there. What is saved is the explicit pair list. (Name-matching as *the* rule was
rejected: names differ — "Codec" vs "Video codec" — one spec field may govern two
owner fields, and equality is not the only rule.)

**Server validation** on `field.create/update`: both fields exist, belong to the
right tables, the rule is legal for the type pair, params are the right shape.
Unknown rule = 400. No migration: `options` is jsonb.

## 4. The result: derived, never stored

One pure function in the shared contract (`src/contract/compare.ts`, the eleventh):

```ts
compareRecords(link: FieldRow, owner: RecordRow, target: RecordRow, ctx) →
  { same: boolean; results: { pair; status: 'match' | 'differ' | 'missing' | 'unspecified'; detail: string }[] }
```

Computed live on the client, like lookups (`client/derived.ts`). Nothing is written,
so it cannot go stale; Ctrl+Z on either record updates the verdict instantly.
Snapshots belong to QC, not here.

Every consumer reads that one result:

- **Badges**: a ⚠ beside a field on a canvas card and in the record tray when a pair
  it belongs to is `differ` or `missing`. Tooltip: the rule, the expected value, and
  WHICH link (a file may target one deliverable and satisfy another — two comparing
  links, each evaluated separately).
- **Side by side**: an action on a record with a comparing link ("show side by
  side"; pick the link if several) — the two records, paired fields aligned,
  differences marked. Probably a tray mode or a dialog; the reports project may want
  it as a printable page later.
- **Views**: later, a filter/group on "has differences" — the verdict as a virtual
  field, like a lookup.
- **An endpoint**: `POST /api/compare { linkFieldId, ownerId, targetId }` → the same
  result, for Python. Thin wrapper, stateless, like `/api/qc/audio-layout-diff`.
- **QC**: reads results when it runs.

## 5. Seeding — and why there are no lookups in pairs

The reality of specs: the studios publish thorough deliverable specs, and every
project is an exception list against them. Formalising "on Elvis, the texted master
IS the official Netflix texted master" as a lookup would be wrong: the project's
deliverable is the truth; the studio spec is where it *started*.

**The chain, using the same engine twice:**

```
Studio catalogue        ─compare─▶  Project deliverable   ─compare─▶  File
"Netflix texted master"            seeded from it, then               compared against
entered once                        EDITED: the exceptions              the project's spec
                                    live here as local fields
```

- Deliverable → catalogue link: "how does Elvis deviate from Netflix's official
  spec?" A document worth having on its own. Exceptions are never hidden; they show
  as `differ` one level up.
- File → deliverable link: "did we hit the spec we actually agreed to?"

**Seed comes free with compare.** The pair list is already a field-to-field mapping;
"seed from" is that list run the other way, ONCE: copy each paired target value into
the owner's field. An action in the record tray on any comparing link; one batch,
one Ctrl+Z; by default fills only EMPTY fields, overwriting asks first. The moment a
value is copied it is the record's own fact (the file-is-evidence rule); edit freely;
the comparison shows the drift. A per-field "take theirs" re-seeds one value.

Two consequences: when the catalogue spec changes, every deliverable seeded from it
lights up `differ` on the changed fields — a change notice you would otherwise never
get. And the catalogue stays small: enter a spec when a project needs it, seed, move on.

The audio-layout copy/paste already built is a hand-done version of seeding one
field; seeding generalises it to every paired field. Layouts stay a copyable value,
not a table.

## 6. What this is not, yet

- Not QC, not a report, not a PDF, not a stored verdict.
- Not transitive: pairs are one hop. Chains are built from RECORDS (§5), not from
  lookups.
- Not a general expression language. If a rule is ever needed that the closed set
  cannot express, add a rule to the set (a contract change, reviewed), not a formula
  field.
- Not comparing manifests beyond the obvious scalars, until the Tauri drop tool
  produces them.

## 7. Build order, when the time comes

1. `contract/compare.ts`: the rule set, `compareRecords`, tests (pure; red-checked).
   Server validation of `options.compare`. **Stop for the owner's review of the wire
   format** — the standing rule.
2. The pairs editor in the link field's ⚙, with name-matching pre-fill.
3. Badges: tray, then canvas cards (card row height is fixed; a badge is inline).
4. Seed from, with the empty-only default.
5. Side by side.
6. The endpoint.

Worked example to build against: Files (path, codec, resolution, frame rate, audio
layout, total size) → Deliverables (the same, plus "max size" as `atMost`) →
Catalogue. Vladimir will supply a real Netflix-style spec for the fixture.
