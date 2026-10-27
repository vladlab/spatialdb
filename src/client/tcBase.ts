/**
 * A record's own timecode base: the Frame rate (and Drop frame) its table's Resolve
 * recipe writes onto it (RESOLVE-BRIEF.md R1.2). Used by the Audio tracks block to
 * say a clip's length as a label rather than a frame count — and by the block's bar
 * to say which rate those labels count at. Null when the table has no Resolve tool,
 * the rate is unmapped, or the record holds no rate the timecode code knows.
 */
import type { State } from './state';
import { fieldsOf } from './state';
import { canDrop, TC_RATES, type TcBase } from '../contract/timecode';
import { resolveMap, type TablesTools } from '../contract/tools';

export function recordTcBase(state: State, recordId: string): TcBase | null {
  const r = state.records.get(recordId);
  const step = r ? (state.tables.get(r.table_id)?.tools as Partial<TablesTools> | undefined)?.resolve?.steps[0] : undefined;
  if (!r || !step) return null;
  const map = resolveMap(step, fieldsOf(state, r.table_id));
  const rk = map.get('frame_rate'), dk = map.get('drop_frame');
  const rate = rk ? r.data[rk] : undefined;
  if (typeof rate !== 'number' || !(TC_RATES as readonly number[]).includes(rate)) return null;
  return { rate, drop: canDrop(rate) && dk !== undefined && r.data[dk] === true };
}
