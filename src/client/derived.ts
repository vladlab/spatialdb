/**
 * Values that are not IN a record: links, lookups, backlinks.
 *
 * A link is rows in `links`; a lookup is computed across a link; a backlink is
 * the same rows read from the other end. All three need the link index and the
 * label rule, and the grid, the canvas and the record panel had each grown their
 * own copy of both. This is the one copy. The RULES are not here — they are in
 * contract/{labels,lookups,backlinks}.ts, shared with the server; this file only
 * feeds them from the store.
 *
 * Everything is a `computed` over the store, so nothing is cached by hand: add a
 * link, edit a far record, or receive either from a peer, and every cell, card
 * row and panel line that depends on it re-renders.
 */

import { computed } from 'vue';
import type { Store } from './store';
import { compareOf, compareRecords, type ComparePair, type CompareResult, type PairResult } from '../contract/compare';
import { primaryKeys, type FieldRow } from './state';
import { labelFrom } from '../contract/labels';
import { lookupOptionsOf, lookupText, lookupValues } from '../contract/lookups';
import { backlinkRecords, backlinkSourceOf } from '../contract/backlinks';
import { endpointOfBacklink, junctionColumnTarget, junctionLabel, junctionOf, otherEnd, type JunctionConfig } from '../contract/junction';

const NONE: string[] = [];

export function useDerived(store: Store) {
  /** Both directions, built in one pass whenever the links map changes. */
  const index = computed(() => {
    const from = new Map<string, string[]>(), to = new Map<string, string[]>();
    const push = (m: Map<string, string[]>, k: string, v: string) => {
      const a = m.get(k);
      if (a) a.push(v); else m.set(k, [v]);
    };
    for (const l of store.state.links.values()) {
      push(from, l.from_record + l.field_id, l.to_record);
      push(to, l.to_record + l.field_id, l.from_record);
    }
    return { from, to };
  });
  const labelKeys = computed(() => primaryKeys(store.state));

  /** Records `recordId` links TO through `fieldId`. */
  const linksFrom = (recordId: string, fieldId: string) => index.value.from.get(recordId + fieldId) ?? NONE;
  /** Records that link to `recordId` THROUGH `fieldId` (a link field elsewhere). */
  const linkedTo = (recordId: string, fieldId: string) => index.value.to.get(recordId + fieldId) ?? NONE;

  const getField = (id: string) => store.state.fields.get(id);
  const getData = (id: string) => store.state.records.get(id)?.data;

  function plainLabelOfId(id: string): string {
    const r = store.state.records.get(id);
    return r ? labelFrom(r.data, labelKeys.value.get(r.table_id), id.slice(0, 8))
      : store.farLabels.get(id) ?? id.slice(0, 8);
  }
  /**
   * A record's label — for a JUNCTION row, composed from its ends: "reel_10.mov →
   * Texted Master › Uploaded" (contract/junction.ts). The label contract names a
   * record by its primary field, which for a junction row is the status alone —
   * true but useless in a chip. Only the client can do better: the ends are links,
   * and the server's far labels stay plain.
   */
  function labelOfId(id: string): string {
    const j = junctionRow(id);
    if (!j) return plainLabelOfId(id);
    return junctionLabel(j.status, j.a ? plainLabelOfId(j.a) : '?', j.b ? plainLabelOfId(j.b) : '?');
  }

  /* ── junctions (contract/junction.ts) ─────────────────────────────────── */

  /** A junction table's config, by table id, or null. */
  const junctionCfg = (tableId: string): JunctionConfig | null => junctionOf(store.state.tables.get(tableId));

  /** A junction row taken apart: its config, its two ends (ids), its status text. Null for any other record. */
  function junctionRow(id: string): { cfg: JunctionConfig; table: string; a?: string; b?: string; status: string } | null {
    const r = store.state.records.get(id);
    const cfg = r ? junctionCfg(r.table_id) : null;
    if (!r || !cfg) return null;
    const statusKey = cfg.status ? getField(cfg.status)?.key : undefined;
    const sv = statusKey ? r.data[statusKey] : undefined;
    return { cfg, table: r.table_id, a: linksFrom(id, cfg.a)[0], b: linksFrom(id, cfg.b)[0], status: typeof sv === 'string' ? sv : '' };
  }

  /**
   * A backlink field that mirrors a junction's endpoint — the "Delivery" column on
   * Files — with which end it is: this is what makes the column writable.
   */
  function junctionOfBacklink(f: FieldRow): { cfg: JunctionConfig; table: string; side: 'a' | 'b' } | null {
    const src = backlinkSourceOf(f);
    const link = src ? getField(src) : undefined;
    const cfg = link ? junctionCfg(link.table_id) : null;
    if (!link || !cfg) return null;
    const side = endpointOfBacklink(f, cfg);
    return side ? { cfg, table: link.table_id, side } : null;
  }

  /** What a junction row reads as on ONE of its ends: "Texted Master › Uploaded". */
  function junctionChip(rowId: string, side: 'a' | 'b'): { text: string; other?: string; status: string } {
    const j = junctionRow(rowId);
    if (!j) return { text: plainLabelOfId(rowId), status: '' };
    const other = j[otherEnd(side)];
    const a = j.a ? plainLabelOfId(j.a) : '?', b = j.b ? plainLabelOfId(j.b) : '?';
    return { text: junctionLabel(j.status, a, b, side), other, status: j.status };
  }

  /** The junction row of this table pairing `from` (on `side`) with `other`, if there is one. */
  function junctionRowFor(cfg: JunctionConfig, side: 'a' | 'b', from: string, other: string): string | undefined {
    const mine = side === 'a' ? cfg.a : cfg.b, theirs = side === 'a' ? cfg.b : cfg.a;
    return linkedTo(from, mine).find((row) => linksFrom(row, theirs).includes(other));
  }

  /** Lookup values as text, or null when the lookup is broken. */
  function lookupOf(recordId: string, f: FieldRow): string[] | null {
    const vals = lookupValues(f, recordId, getField, linksFrom, getData);
    return vals === null ? null : lookupText(vals);
  }
  /** Ids of the records pointing here through a backlink's source, or null if broken. */
  const backlinkOf = (recordId: string, f: FieldRow) => backlinkRecords(f, recordId, getField, linkedTo);

  /**
   * One derived field as TEXT — what sorting, filtering, search and canvas card
   * rows all want. `broken` distinguishes "depends on something deleted" from
   * "empty".
   */
  function textOf(recordId: string, f: FieldRow): { texts: string[]; broken: boolean } {
    if (f.type === 'link') return { texts: linksFrom(recordId, f.id).map(labelOfId), broken: false };
    if (f.type === 'lookup') { const v = lookupOf(recordId, f); return { texts: v ?? [], broken: v === null }; }
    if (f.type === 'backlink') {
      const v = backlinkOf(recordId, f);
      const j = junctionOfBacklink(f);
      return { texts: (v ?? []).map((id) => (j ? junctionChip(id, j.side).text : labelOfId(id))), broken: v === null };
    }
    return { texts: [], broken: false };
  }

  /**
   * Tables a field reads from OTHER than its own — they must be loaded for it to
   * show anything. A lookup reads the table its link points at; a backlink reads
   * the table its source field lives on (the labels of the records linking in).
   */
  function tablesNeededBy(fields: FieldRow[]): string[] {
    const out = new Set<string>();
    for (const f of fields) {
      if (f.type === 'lookup') {
        const via = lookupOptionsOf(f)?.via_field_id;
        const far = via ? getField(via)?.options?.target_table_id : undefined;
        if (typeof far === 'string') out.add(far);
      } else if (f.type === 'backlink') {
        const src = backlinkSourceOf(f);
        const t = src ? getField(src)?.table_id : undefined;
        if (t) out.add(t);
        // A junction's rows are labelled by their OTHER end: that table too.
        const j = junctionOfBacklink(f);
        const far = j ? getField(j.side === 'a' ? j.cfg.b : j.cfg.a)?.options?.target_table_id : undefined;
        if (typeof far === 'string') out.add(far);
      }
    }
    return [...out];
  }

  /**
   * EVERY incoming link to a record, grouped by the field it comes through —
   * whether or not the table has a backlink field for it. The record panel's
   * "Referenced by". Only as complete as what is loaded: links arrive with the
   * tables (and canvases) that have been opened.
   */
  function referencedBy(recordId: string): Array<{ field: FieldRow; tableName: string; from: string[] }> {
    const byField = new Map<string, string[]>();
    for (const l of store.state.links.values()) {
      if (l.to_record !== recordId) continue;
      const a = byField.get(l.field_id);
      if (a) a.push(l.from_record); else byField.set(l.field_id, [l.from_record]);
    }
    return [...byField].flatMap(([fieldId, from]) => {
      const field = getField(fieldId);
      return field ? [{ field, from, tableName: store.state.tables.get(field.table_id)?.name ?? '' }] : [];
    });
  }

  /* ── comparison (contract/compare.ts) — derived, never stored ────────────── */

  /**
   * The table a comparing field compares against: a link's target, or for a JUNCTION
   * column (sql/016) the other end's table. Null for a field that cannot compare.
   */
  function compareTargetTable(f: FieldRow): string | null {
    if (f.type === 'link') return String(f.options?.target_table_id ?? '') || null;
    return junctionColumnTarget(f, getField, store.state.tables.values());
  }
  /** The records `recordId` compares against through `f`: what it links to, or the other end of each of its pairs. */
  function compareTargets(recordId: string, f: FieldRow): string[] {
    if (f.type === 'link') return linksFrom(recordId, f.id);
    const j = junctionOfBacklink(f);
    if (!j) return [];
    return (backlinkOf(recordId, f) ?? []).flatMap((row) => { const o = junctionRow(row)?.[otherEnd(j.side)]; return o ? [o] : []; });
  }
  /**
   * The comparing fields of a record's table — comparing links AND junction columns —
   * with the records it compares against through each. One engine, two kinds of edge.
   */
  function comparisonsOf(recordId: string): Array<{ link: FieldRow; pairs: ComparePair[]; targets: string[] }> {
    const rec = store.state.records.get(recordId);
    if (!rec) return [];
    const out: Array<{ link: FieldRow; pairs: ComparePair[]; targets: string[] }> = [];
    for (const f of store.state.fields.values()) {
      if (f.table_id !== rec.table_id || (f.type !== 'link' && f.type !== 'backlink')) continue;
      const cfg = compareOf(f);
      if (cfg && cfg.pairs.length) out.push({ link: f, pairs: cfg.pairs, targets: compareTargets(recordId, f) });
    }
    return out;
  }
  /** Compare a record with one linked target through one comparing link. Null if either is not loaded. */
  function compare(linkId: string, ownerId: string, targetId: string): CompareResult | null {
    const link = getField(linkId), owner = store.state.records.get(ownerId), target = store.state.records.get(targetId);
    const pairs = link ? compareOf(link)?.pairs : undefined;
    if (!link || !pairs || !owner || !target) return null;
    return compareRecords(pairs, store.state.fields, owner, target, linksFrom, labelOfId);
  }
  /**
   * For BADGES: every pair result that is not a match, keyed by the OWNER field, across
   * all of a record's comparing links and all their targets. A field with an entry
   * here gets a ⚠; the entries are the tooltip.
   */
  function differencesOf(recordId: string): Map<string, Array<{ link: FieldRow; target: string; result: PairResult }>> {
    const out = new Map<string, Array<{ link: FieldRow; target: string; result: PairResult }>>();
    for (const c of comparisonsOf(recordId)) {
      for (const t of c.targets) {
        const r = compare(c.link.id, recordId, t);
        if (!r) continue;
        for (const pr of r.results) {
          if (pr.status !== 'differ' && pr.status !== 'missing') continue;
          const a = out.get(pr.pair.from); const e = { link: c.link, target: t, result: pr };
          if (a) a.push(e); else out.set(pr.pair.from, [e]);
        }
      }
    }
    return out;
  }

  /**
   * For the ICON beside a field, wherever a record is drawn (tray, card, grid cell,
   * board card — the same cue everywhere): `ok` when every comparison of that field
   * matches, not ok when any differs or is missing; absent when nothing compares it
   * (or every comparison is "unspecified"). `title` says why, and through which link.
   */
  function fieldVerdicts(recordId: string): Map<string, { ok: boolean; title: string }> {
    const out = new Map<string, { ok: boolean; title: string }>();
    for (const c of comparisonsOf(recordId)) {
      for (const t of c.targets) {
        const r = compare(c.link.id, recordId, t);
        if (!r) continue;
        for (const pr of r.results) {
          if (pr.status === 'unspecified') continue;
          const bad = pr.status === 'differ' || pr.status === 'missing';
          const line = `${c.link.name} → ${labelOfId(t)}: ${pr.detail}`;
          const cur = out.get(pr.pair.from);
          if (!cur) out.set(pr.pair.from, { ok: !bad, title: line });
          else out.set(pr.pair.from, { ok: cur.ok && !bad, title: `${cur.title}\n${line}` });
        }
      }
    }
    return out;
  }

  return { labelKeys, linksFrom, linkedTo, labelOfId, plainLabelOfId, lookupOf, backlinkOf, textOf, tablesNeededBy, referencedBy, comparisonsOf, compare, differencesOf, fieldVerdicts, compareTargetTable, compareTargets,
    junctionCfg, junctionRow, junctionOfBacklink, junctionChip, junctionRowFor };
}
