/**
 * Ctrl+Z — the inverse of a mutation, computed from what the client already knows.
 *
 * There were two kinds of change and only one could be undone. DELETES were: the
 * server captures what a delete destroys and the undo tab restores it. Everything
 * else — moving a card, resizing, folding, removing a card from a canvas, editing
 * a cell, adding a link — had no undo at all, because none of it destroys
 * anything the server would need to capture. It does not need to: at the moment
 * the client makes such a change it is LOOKING at the previous state. So the
 * inverse is built here, just before the change is applied, and kept on a
 * per-session stack. Undoing is simply issuing that inverse as an ordinary
 * mutation — it is logged, streamed to peers and validated like any other write.
 * There is no special "undo" path on the server for these, and none is wanted.
 *
 * What this is NOT:
 *
 * - NOT a time machine in a shared database. The inverse restores what YOU saw
 *   before YOUR change. If a colleague moved the same card in between, your undo
 *   puts it back where it was before you touched it — last write wins, as
 *   everywhere else in this app. For 3–10 people that is the honest, predictable
 *   behaviour; per-user causal undo is a research topic.
 * - NOT persistent. The stack lives in this tab and is gone on reload. The
 *   server's delete-undo (the undo tab) IS persistent and is unaffected.
 *
 * Deletes ARE on this stack too, as a pointer: undoing one asks the server to
 * restore it (the same call the undo tab makes), so Ctrl+Z after deleting a row
 * does what you expect instead of skipping back to the edit before it.
 *
 * Returns null for anything with no sensible inverse; that change simply is not
 * pushed, and Ctrl+Z skips over it.
 */

import type { Mutation } from '../contract/mutations.js';
import { placementKey, type State } from './state.js';

/** One undoable thing: inverse mutations to issue, or a server-side restore. */
export type Inverse =
  | { kind: 'mutations'; mutations: Mutation[] }
  | { kind: 'restore'; ofMutationId: string };

/** `queuedId` is the idempotency id this mutation will be sent under. */
export function inverseOf(state: State, m: Mutation, queuedId: string): Inverse | null {
  const just = (...mutations: Mutation[]): Inverse => ({ kind: 'mutations', mutations });

  switch (m.type) {
    /* ── canvas layout: all of it reversible from local state ── */
    case 'placement.move': {
      const back = m.moves.flatMap((mv) => {
        const p = state.placements.get(placementKey(m.canvasId, mv.recordId));
        return p ? [{ recordId: mv.recordId, x: p.x, y: p.y, z: p.z }] : [];
      });
      return back.length ? just({ type: 'placement.move', canvasId: m.canvasId, moves: back }) : null;
    }
    case 'placement.update': {
      const p = state.placements.get(placementKey(m.canvasId, m.recordId));
      if (!p) return null;
      return just({
        type: 'placement.update', canvasId: m.canvasId, recordId: m.recordId,
        ...(m.w !== undefined ? { w: p.w } : {}),
        ...(m.h !== undefined ? { h: p.h } : {}),
        ...(m.collapsed !== undefined ? { collapsed: p.collapsed } : {}),
        ...(m.style !== undefined ? { style: p.style } : {}),
      });
    }
    case 'placement.add':
      return just({ type: 'placement.remove', canvasId: m.canvasId, recordId: m.recordId });
    case 'placement.remove': {
      // "Unplace" destroys nothing — the record stays — but the card's position,
      // size and fold ARE lost unless they are remembered here.
      const p = state.placements.get(placementKey(m.canvasId, m.recordId));
      if (!p) return null;
      const out: Mutation[] = [{
        type: 'placement.add', id: crypto.randomUUID(), canvasId: m.canvasId, recordId: m.recordId,
        x: p.x, y: p.y, w: p.w, h: p.h, z: p.z,
      }];
      if (p.collapsed || Object.keys(p.style ?? {}).length) {
        out.push({ type: 'placement.update', canvasId: m.canvasId, recordId: m.recordId,
          collapsed: p.collapsed, style: p.style });
      }
      return just(...out);
    }

    /* ── values ── */
    case 'record.update': {
      const r = state.records.get(m.id);
      if (!r) return null;
      const set: Record<string, unknown> = {}, unset: string[] = [];
      for (const key of [...Object.keys(m.set ?? {}), ...(m.unset ?? [])]) {
        if (key in r.data) set[key] = r.data[key]; else unset.push(key);
      }
      return just({ type: 'record.update', id: m.id, set, unset });
    }
    case 'link.add':
      return just({ type: 'link.remove', fieldId: m.fieldId, fromRecord: m.fromRecord, toRecord: m.toRecord });
    case 'link.remove':
      return just({ type: 'link.add', id: crypto.randomUUID(), fieldId: m.fieldId, fromRecord: m.fromRecord, toRecord: m.toRecord });

    // Undoing a create is a delete — of a record that was, by construction, made
    // moments ago by this person. (Redoing it is then a server restore.)
    case 'record.create':
      return just({ type: 'record.delete', id: m.id });

    /* ── settings that are one value replaced by another ── */
    case 'canvas.update': {
      // Only the card settings are worth a Ctrl+Z. The camera is not a user
      // action in that sense, and a board's NAME is a record value now — renaming
      // one is a record.update, inverted above.
      if (m.config === undefined) return null;
      const c = state.canvases.get(m.id);   // may not exist yet: state is created lazily
      return just({ type: 'canvas.update', id: m.id, config: (c?.config ?? { cardFields: {} }) as never });
    }
    case 'view.update': {
      const v = state.views.get(m.id);
      if (!v) return null;
      return just({
        type: 'view.update', id: m.id,
        ...(m.name !== undefined ? { name: v.name } : {}),
        ...(m.config !== undefined ? { config: v.config as never } : {}),
        ...(m.position !== undefined ? { position: v.position } : {}),
      });
    }
    case 'field.update': {
      const f = state.fields.get(m.id);
      if (!f) return null;
      return just({
        type: 'field.update', id: m.id,
        ...(m.name !== undefined ? { name: f.name } : {}),
        ...(m.position !== undefined ? { position: f.position } : {}),
        ...(m.options !== undefined ? { options: f.options } : {}),
      });
    }

    case 'section.create':
      return just({ type: 'section.delete', id: m.id });
    case 'section.update': {
      const sec = state.sections.get(m.id);
      if (!sec) return null;
      return just({
        type: 'section.update', id: m.id,
        ...(m.name !== undefined ? { name: sec.name } : {}),
        ...(m.description !== undefined ? { description: sec.description } : {}),
        ...(m.icon !== undefined ? { icon: sec.icon } : {}),
        ...(m.color !== undefined ? { color: sec.color } : {}),
        ...(m.tableIds !== undefined ? { tableIds: [...sec.table_ids] } : {}),
        ...(m.scopeTableId !== undefined ? { scopeTableId: sec.scope_table_id } : {}),
        // Clearing the scope table also clears its marker; put that back too.
        ...(m.archivedFieldId !== undefined || m.scopeTableId === null ? { archivedFieldId: sec.archived_field_id } : {}),
        ...(m.position !== undefined ? { position: sec.position } : {}),
      });
    }

    /* ── deletes: the server holds what was destroyed ── */
    case 'record.delete':
    case 'field.delete':
    case 'table.delete':
    case 'view.delete':
    case 'section.delete':
      return { kind: 'restore', ofMutationId: queuedId };

    default:
      return null;
  }
}
