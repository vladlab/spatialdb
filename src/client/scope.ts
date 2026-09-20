/**
 * The current SCOPE, for the client — see contract/scope.ts for the rules.
 *
 * One object, made by App.vue and handed down (provide/inject), that answers the
 * three things everything else needs to ask:
 *
 *   filterFor(tableId)   a predicate over that table's records, or NULL when the
 *                        table is not scoped (no membership field) — callers show
 *                        it whole and SAY so, rather than pretend
 *   createRecord(...)    make a record that INHERITS ITS CONTEXT — the scoped project,
 *                        the group it was added under, the board it was made on —
 *                        in the SAME synchronous run: one Ctrl+Z, and a peer never
 *                        sees the record without its links
 *   searchParams()       what to tell /api/search so it ranks by this scope
 *
 * Record creation used to be scattered: the grid, the canvas and the "+ canvas"
 * button each issued their own record.create. They all come through here now,
 * which is the only reason auto-linking can be relied on.
 */

import { computed, ref, watch, type InjectionKey, type Ref } from 'vue';
import type { Store } from './store';
import { recordsOf, type FieldRow, type RecordRow, type SectionRow } from './state';
import { ALL, formatScope, inScope, isMembership, membershipFieldOf, parseScope, type Scope } from '../contract/scope';

export function useScope(store: Store, section: Ref<SectionRow | null>, labelOf: (id: string) => string) {
  const scope = ref<Scope>(ALL);
  const showArchived = ref(false);

  const scopeTableId = computed(() => section.value?.scope_table_id ?? '');
  /** Is there anything to scope BY here at all? */
  const available = computed(() => !!scopeTableId.value && store.state.tables.has(scopeTableId.value));

  // The switcher lists the scope table's records, so that table must be loaded.
  watch(scopeTableId, (id) => { if (id) void store.loadTable(id); }, { immediate: true });

  // Remembered per browser, per section. A way of looking, not data.
  const key = () => `spatialdb.scope.${section.value?.id ?? ''}`;
  watch(() => section.value?.id, () => {
    let saved: Scope = ALL;
    try { saved = parseScope(localStorage.getItem(key())); } catch { /* unavailable */ }
    scope.value = available.value ? saved : ALL;
  }, { immediate: true });
  watch(scope, (s) => { try { if (section.value) localStorage.setItem(key(), formatScope(s)); } catch { /* unavailable */ } });

  const archivedKey = computed(() => {
    const f = section.value?.archived_field_id ? store.state.fields.get(section.value.archived_field_id) : undefined;
    return f?.type === 'checkbox' ? f.key : '';
  });
  const scopeRecords = computed(() => (available.value ? recordsOf(store.state, scopeTableId.value) : []));
  const archived = computed(() => new Set(archivedKey.value
    ? scopeRecords.value.filter((r) => r.data[archivedKey.value] === true).map((r) => r.id) : []));

  /** What the switcher offers: live projects, plus archived ones if asked for. */
  const choices = computed(() => scopeRecords.value
    .filter((r) => showArchived.value || !archived.value.has(r.id))
    .map((r) => ({ id: r.id, label: labelOf(r.id), archived: archived.value.has(r.id) }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })));

  // The scoped project was deleted (here or by a peer), or archived out of view:
  // fall back to All rather than sit in a scope that no longer exists.
  watch([scope, scopeRecords, available], () => {
    const s = scope.value;
    if (!available.value) { if (s.kind !== 'all') scope.value = ALL; return; }
    // Only once the table has actually arrived — before that "not found" means nothing.
    if (s.kind === 'record' && store.tableLoads.get(scopeTableId.value)?.state === 'loaded'
      && !store.state.records.has(s.id)) scope.value = ALL;
  });

  /** record id + membership field id → the scope-table records it belongs to. */
  const memberIndex = computed(() => {
    const flagged = new Set<string>();
    for (const f of store.state.fields.values()) if (isMembership(f)) flagged.add(f.id);
    const m = new Map<string, string[]>();
    for (const l of store.state.links.values()) {
      if (!flagged.has(l.field_id)) continue;
      const k = l.from_record + l.field_id;
      const a = m.get(k);
      if (a) a.push(l.to_record); else m.set(k, [l.to_record]);
    }
    return m;
  });
  const NONE: string[] = [];

  const membershipField = (tableId: string): FieldRow | undefined =>
    (available.value ? membershipFieldOf(store.state.fields.values(), tableId, scopeTableId.value) : undefined);

  /** null = this table is not scoped (or nothing is): show everything. */
  function filterFor(tableId: string): ((r: RecordRow) => boolean) | null {
    if (!available.value || tableId === scopeTableId.value) return null;
    const f = membershipField(tableId);
    if (!f) return null;
    const s = scope.value, arch = archived.value, show = showArchived.value, idx = memberIndex.value;
    // Even under "All" the filter exists: it is what hides archived projects' records.
    return (r) => inScope(s, idx.get(r.id + f.id) ?? NONE, arch, show);
  }

  /** Why this table's grid looks the way it does under the current scope. */
  function describe(tableId: string): { scoped: boolean; note: string } {
    if (!available.value || scope.value.kind === 'all') return { scoped: false, note: '' };
    const name = scope.value.kind === 'record' ? labelOf(scope.value.id) : 'Unassigned';
    if (tableId === scopeTableId.value) return { scoped: false, note: '' };
    return membershipField(tableId)
      ? { scoped: true, note: `in ${name}` }
      : { scoped: false, note: `not scoped — this table has no membership link to ${store.state.tables.get(scopeTableId.value)?.name ?? 'the scope table'}, so all of it is shown` };
  }

  /**
   * Create a record — inheriting the CONTEXT it is created in.
   *
   * One principle, three sources, all additive, all in the same synchronous run as
   * the create (one Ctrl+Z; a peer never sees the record without its links):
   *
   *   SCOPE   inside a project, it becomes a member of that project.
   *   GROUP   added under a group header in a grouped grid, it gets that group's
   *           value — the select choice, the checkbox state, the linked records —
   *           for EVERY level it sits under. (`context.data` / `context.links`.)
   *   BOARD   created on a canvas, it joins whatever that board belongs to. A canvas
   *           is a record (sql/010); if the Episode 101 board has a membership link
   *           to the work "Ep 101", a file made on it is linked to Ep 101 — wherever
   *           the file's table has its OWN membership link to the same table. The
   *           same explicit flag scope uses, so the field is never guessed, and no
   *           new setting: you say what a board is about by filling in its fields.
   *
   * This is deliberately NOT a nested scope. Nothing is filtered by it; it only
   * decides what a new record starts out linked to.
   */
  function createRecord(
    tableId: string, data: Record<string, unknown> = {}, id = crypto.randomUUID(),
    context: { data?: Record<string, unknown>; links?: Array<{ fieldId: string; toRecord: string }>; boardId?: string } = {},
  ): string {
    store.mutate({ type: 'record.create', id, tableId, data: { ...context.data, ...data } });

    const links = new Map<string, { fieldId: string; toRecord: string }>();
    const want = (fieldId: string, toRecord: string) => links.set(fieldId + toRecord, { fieldId, toRecord });

    const s = scope.value;
    const viaScope = s.kind === 'record' ? membershipField(tableId) : undefined;
    if (viaScope && s.kind === 'record') want(viaScope.id, s.id);

    for (const l of context.links ?? []) want(l.fieldId, l.toRecord);
    for (const l of context.boardId ? boardMemberships(context.boardId, tableId) : []) want(l.fieldId, l.toRecord);

    for (const l of links.values()) {
      store.mutate({ type: 'link.add', id: crypto.randomUUID(), fieldId: l.fieldId, fromRecord: id, toRecord: l.toRecord });
    }
    return id;
  }

  /**
   * What a record of `tableId` inherits from being created on `boardId`: for each
   * membership link the BOARD's record has (to table T), a link through `tableId`'s
   * own membership field to T — if it has one. A table with no such field inherits
   * nothing from that link, silently: not every table belongs to works.
   */
  function boardMemberships(boardId: string, tableId: string): Array<{ fieldId: string; toRecord: string }> {
    const board = store.state.records.get(boardId);
    if (!board) return [];
    const out: Array<{ fieldId: string; toRecord: string }> = [];
    for (const bf of store.state.fields.values()) {
      if (bf.table_id !== board.table_id || !isMembership(bf)) continue;
      const target = String(bf.options?.target_table_id ?? '');
      const mine = membershipFieldOf(store.state.fields.values(), tableId, target);
      if (!mine) continue;
      for (const to of memberIndex.value.get(boardId + bf.id) ?? NONE) out.push({ fieldId: mine.id, toRecord: to });
    }
    return out;
  }

  function searchParams(): string {
    if (!available.value) return '';
    return `&scopeTable=${scopeTableId.value}&scope=${formatScope(scope.value)}`
      + `&archived=${[...archived.value].join(',')}${showArchived.value ? '&showArchived=1' : ''}`;
  }

  const label = computed(() => (scope.value.kind === 'record' ? labelOf(scope.value.id) : scope.value.kind === 'unassigned' ? 'Unassigned' : 'All'));

  return { scope, showArchived, available, scopeTableId, choices, archived, label, filterFor, describe, createRecord, boardMemberships, searchParams, membershipField };
}

export type ScopeApi = ReturnType<typeof useScope>;
export const SCOPE: InjectionKey<ScopeApi> = Symbol('scope');
