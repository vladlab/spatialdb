/**
 * Colour rules (contract/colorRules.ts), pure — no server, no database. What a view,
 * a canvas and a report level share: the rule shape, where it is accepted, and how
 * `paintsOf` reads ordered rules over one record. The report-specific reading (pair
 * fields, rollups) is in test/reports.ts R14.
 */
import { randomUUID } from 'node:crypto';
import { ColorRule, TINTS, legendOf, newRuleId, paintsOf, rollupPasses } from '../src/contract/colorRules.js';
import { ViewConfig, type ViewField, type ViewRecord } from '../src/contract/views.js';
import { CanvasConfig, glowOf, rulesFor } from '../src/contract/canvasConfig.js';

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

const T = randomUUID();
const fStatus: ViewField = { id: randomUUID(), key: 'status', type: 'select', options: { choices: ['Working', 'Sent', 'Pending QC', 'Accepted'] } };
const fSize: ViewField = { id: randomUUID(), key: 'size', type: 'number' };
const fDeliv: ViewField = { id: randomUUID(), key: 'deliverable', type: 'link', options: { target_table_id: T } };
const fields = new Map([fStatus, fSize, fDeliv].map((f) => [f.id, f]));
const rec = (data: Record<string, unknown>, linked: string[] = []): ViewRecord & { linked: string[] } => ({ id: randomUUID(), data, linked });
const links = (id: string, fieldId: string) => (fieldId === fDeliv.id ? (byId.get(id)?.linked ?? []) : []);
const byId = new Map<string, ReturnType<typeof rec>>();
const accepted = rec({ status: 'Accepted', size: 10 }, ['Texted ProRes']);
const sentNoDeliv = rec({ status: 'Sent', size: 400 });
const working = rec({ status: 'Working' });
for (const r of [accepted, sentNoDeliv, working]) byId.set(r.id, r);

console.log('\nC1. The shape');
check('a rule parses with defaults: when [], paint row', (() => { const p = ColorRule.safeParse({ id: 'a', tint: 'green' }); return p.success && p.data.when.length === 0 && p.data.paint === 'row'; })());
check('an unknown tint is refused — six named tints, no hex', !ColorRule.safeParse({ id: 'a', tint: '#ff0000' }).success && TINTS.length === 6);
check('paint may name one field', ColorRule.safeParse({ id: 'a', tint: 'red', paint: { field: fDeliv.id } }).success);
check('a view config may carry rules; without them it reads as before', (() => {
  const w = ViewConfig.safeParse({ sort: [], filters: [], hidden: [], rules: [{ id: 'a', tint: 'green', when: [{ fieldId: fStatus.id, op: 'eq', value: 'Accepted' }] }] });
  const wo = ViewConfig.safeParse({ sort: [], filters: [], hidden: [] });
  return w.success && w.data.rules?.length === 1 && wo.success && wo.data.rules === undefined;
})());
check('a canvas config carries rules PER TABLE, and a glow mode', (() => {
  const c = { cardFields: {}, rules: { [T]: [{ id: 'a', tint: 'amber' }] }, glow: 'ring' };
  return CanvasConfig.safeParse(c).success && rulesFor(c, T).length === 1 && rulesFor(c, randomUUID()).length === 0 && glowOf(c) === 'ring' && glowOf({ cardFields: {} }) === 'glow';
})());
check('more than 32 rules is refused', !ViewConfig.safeParse({ sort: [], filters: [], hidden: [], rules: Array.from({ length: 33 }, (_, i) => ({ id: `r${i}`, tint: 'grey' })) }).success);

console.log('\nC2. Evaluation: ordered, first match per target');
const rules = ViewConfig.parse({ sort: [], filters: [], hidden: [], rules: [
  { id: 'ok', tint: 'green', label: 'Accepted', when: [{ fieldId: fStatus.id, op: 'eq', value: 'Accepted' }] },
  { id: 'big', tint: 'violet', when: [{ fieldId: fSize.id, op: 'gt', value: 100 }] },
  { id: 'nodeliv', tint: 'red', label: 'No deliverable', paint: { field: fDeliv.id }, when: [{ fieldId: fStatus.id, op: 'eq', value: 'Sent' }, { fieldId: fDeliv.id, op: 'empty' }] },
] }).rules!;
const pa = paintsOf(accepted, rules, fields, links);
check('an accepted file: green row, with the rule\'s label and id', pa?.row?.tint === 'green' && pa.row.label === 'Accepted' && pa.row.ruleId === 'ok' && Object.keys(pa.fields).length === 0, JSON.stringify(pa));
const ps = paintsOf(sentNoDeliv, rules, fields, links);
check('a sent file with no deliverable: violet row (size) AND a red Deliverable cell — one winner per target', ps?.row?.tint === 'violet' && ps.fields[fDeliv.id]?.tint === 'red', JSON.stringify(ps));
check('a file nothing matches: undefined, not an empty paint', paintsOf(working, rules, fields, links) === undefined);
check('a rule with no conditions is a catch-all for whatever is left', paintsOf(working, [...rules, { id: 'rest', tint: 'grey', paint: 'row', when: [] }], fields, links)?.row?.tint === 'grey');
check('…but never steals a target an earlier rule painted', paintsOf(accepted, [...rules, { id: 'rest', tint: 'grey', paint: 'row', when: [] }], fields, links)?.row?.tint === 'green');
check('a condition on a field that no longer exists is skipped, as a view\'s filter is', paintsOf(working, [{ id: 'x', tint: 'blue', paint: 'row', when: [{ fieldId: randomUUID(), op: 'empty' }] }], fields, links)?.row?.tint === 'blue');
check('a rollup test with no rollup reader fails the rule rather than passing it', paintsOf(working, [{ id: 'x', tint: 'blue', paint: 'row', when: [{ rollup: 'n', op: 'gt', value: 0 }] }], fields, links) === undefined);
check('rollupPasses: the five ops', rollupPasses(2, { rollup: 'n', op: 'gt', value: 1 }) && rollupPasses(1, { rollup: 'n', op: 'gte', value: 1 }) && rollupPasses(0, { rollup: 'n', op: 'eq', value: 0 }) && !rollupPasses(null, { rollup: 'n', op: 'eq', value: 0 }) && rollupPasses(0, { rollup: 'n', op: 'lt', value: 1 }) && rollupPasses(1, { rollup: 'n', op: 'lte', value: 1 }));

console.log('\nC3. Legend and ids');
check('the legend: labelled rules only, in order, one chip per tint·label', legendOf([...rules, { tint: 'green', label: 'Accepted' }]).map((l) => `${l.tint}:${l.label}`).join('|') === 'green:Accepted|red:No deliverable');
check('a new id never collides with an existing one', newRuleId(rules) === 'r4' && !['r1', 'r3'].includes(newRuleId([{ id: 'r1' }, { id: 'r3' }])));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
