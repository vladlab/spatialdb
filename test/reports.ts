/**
 * The reports contract (REPORTS-BRIEF.md), pure — no server, no database. The
 * fixture is the brief's worked example: Projects › Works (Deliverables (bid),
 * Deliverables (added)) › Deliverables › Files (project, work, deliverable; path,
 * size, status, delivered). Every rule the brief pins is a check here.
 */
import { randomUUID } from 'node:crypto';
import {
  reportDefError, runReport, flattenReport, flattenGrid, toCsv, EMPTY_REPORT,
  type ReportDef, type ReportField, type ReportContext, type ReportSection, type ReportNode,
} from '../src/contract/reports.js';
import type { ViewRecord } from '../src/contract/views.js';

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

/* ── fixture ──────────────────────────────────────────────────────────────── */

const T = { projects: randomUUID(), works: randomUUID(), delivs: randomUUID(), files: randomUUID(), edits: randomUUID() };
const tables = [
  { id: T.projects, name: 'Projects' }, { id: T.works, name: 'Works' }, { id: T.delivs, name: 'Deliverables' },
  { id: T.files, name: 'Files' }, { id: T.edits, name: 'Edits' },
];
const fields: ReportField[] = [];
const F: Record<string, string> = {};
function field(name: string, table: string, type: string, options: Record<string, unknown> = {}) {
  const id = randomUUID(); const key = name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  fields.push({ id, key, name, type, table_id: table, options });
  F[`${tables.find((t) => t.id === table)!.name}.${name}`] = id;
  return id;
}
field('Name', T.projects, 'text');
field('Name', T.works, 'text');
const fWorkProject = field('Project', T.works, 'link', { target_table_id: T.projects, membership: true });
const fBid = field('Deliverables (bid)', T.works, 'link', { target_table_id: T.delivs });
const fAdded = field('Deliverables (added)', T.works, 'link', { target_table_id: T.delivs });
field('Name', T.delivs, 'text');
const fDCodec = field('Codec', T.delivs, 'text');
field('Name', T.files, 'text');
const fPath = field('Path', T.files, 'text');
const fSize = field('Size', T.files, 'number');
const fStatus = field('Status', T.files, 'select', { choices: ['superseded', 'accepted'] });
const fDelivered = field('Delivered', T.files, 'date');
const fFileProject = field('Project', T.files, 'link', { target_table_id: T.projects, membership: true });
const fFileWork = field('Work', T.files, 'link', { target_table_id: T.works });
const fFileDeliv = field('Deliverable', T.files, 'link', { target_table_id: T.delivs });
field('Name', T.edits, 'text');
const fPrev = field('Previous version', T.edits, 'link', { target_table_id: T.edits });

const records = new Map<string, ViewRecord[]>();
const R: Record<string, string> = {};
function record(table: string, name: string, data: Record<string, unknown> = {}) {
  const id = randomUUID();
  (records.get(table) ?? records.set(table, []).get(table)!).push({ id, data: { name, ...data } });
  R[name] = id; return id;
}
const pA = record(T.projects, 'Elvis'), pB = record(T.projects, 'Other show');
const w101 = record(T.works, 'Ep 101'), w102 = record(T.works, 'Ep 102'), w201 = record(T.works, 'Ep 201');
const dProres = record(T.delivs, 'ProRes 4444 texted', { codec: 'ProRes 4444' }), dDcp = record(T.delivs, 'DCP 2K Flat', { codec: 'JPEG 2000' }), dSister = record(T.delivs, 'Sister network');
const f1 = record(T.files, 'ep101_prores_v1.mov', { path: '/vol/ep101_prores_v1.mov', size: 10, status: 'superseded' });
const f2 = record(T.files, 'ep101_prores_v2.mov', { path: '/vol/ep101_prores_v2.mov', size: 12, status: 'accepted', delivered: '2026-09-14' });
const f3 = record(T.files, 'ep102_prores_v1.mov', { path: '/vol/ep102 "final", v1.mov', size: 11, status: 'accepted', delivered: '2026-09-20' });
const f4 = record(T.files, 'ep101_notes.txt', { path: '/vol/notes.txt', size: 1 });   // a file of ep 101 that is NOT a deliverable
const e1 = record(T.edits, 'OEV1'), e2 = record(T.edits, 'OEV2');

const links: { fieldId: string; from: string; to: string }[] = [];
const link = (fieldId: string, from: string, to: string) => links.push({ fieldId, from, to });
link(fWorkProject, w101, pA); link(fWorkProject, w102, pA); link(fWorkProject, w201, pB);
link(fBid, w101, dProres); link(fBid, w101, dDcp); link(fAdded, w101, dDcp);   // DCP is in BOTH bid and added on 101
link(fBid, w102, dProres); link(fBid, w201, dSister);
for (const f of [f1, f2, f4]) { link(fFileProject, f, pA); link(fFileWork, f, w101); }
link(fFileProject, f3, pA); link(fFileWork, f3, w102);
link(fFileDeliv, f1, dProres); link(fFileDeliv, f2, dProres); link(fFileDeliv, f3, dProres);
link(fPrev, e2, e1); link(fPrev, e1, e2);   // a loop: OEV1 says its previous version is OEV2, and vice versa

const labelOf = (id: string) => { for (const rs of records.values()) { const r = rs.find((x) => x.id === id); if (r) return String(r.data.name); } return id; };
const ctx: ReportContext = {
  fields, tables,
  recordsOf: (t) => records.get(t) ?? [],
  linksFrom: (rec, f) => links.filter((l) => l.fieldId === f && l.from === rec).map((l) => l.to),
  linksTo: (rec, f) => links.filter((l) => l.fieldId === f && l.to === rec).map((l) => l.from),
  labelOf,
  links: (rec, f) => links.filter((l) => l.fieldId === f && l.from === rec).map((l) => labelOf(l.to)),
};

/** The brief's report: works › expected deliverables (bid, added) › the files linked to both. */
const deliverables: ReportDef = {
  v: 1,
  root: {
    id: 'works', table: T.works, fields: [], filters: [], sort: [{ fieldId: F['Works.Name'], dir: 'asc' }],
    rollups: [
      { id: 'expected', label: 'expected', op: 'count', over: 'delivs' },
      { id: 'delivered', label: 'delivered', op: 'countWhere', over: 'delivs', where: { rollup: 'files', op: 'gt', value: 0 } },
    ],
    children: [{
      id: 'delivs', via: [{ fieldId: fBid, role: 'bid' }, { fieldId: fAdded, role: 'added' }],
      fields: [fDCodec], filters: [], sort: [{ fieldId: F['Deliverables.Name'], dir: 'asc' }],
      rollups: [
        { id: 'files', label: 'files', op: 'count', over: 'files' },
        { id: 'accepted', label: 'accepted', op: 'countWhere', over: 'files', where: [{ fieldId: fStatus, op: 'eq', value: 'accepted' }] },
        { id: 'bytes', label: 'total size', op: 'sum', over: 'files', fieldId: fSize },
        { id: 'last', label: 'last delivered', op: 'max', over: 'files', fieldId: fDelivered },
        { id: 'paths', label: 'paths', op: 'list', over: 'files', fieldId: fPath },
      ],
      children: [{
        id: 'files', via: [{ fieldId: fFileDeliv }], pins: [{ fieldId: fFileWork, levelId: 'works' }],
        fields: [fPath, fStatus, fDelivered], filters: [], sort: [{ fieldId: F['Files.Name'], dir: 'desc' }], rollups: [], children: [],
      }],
    }],
  },
};

const node = (s: ReportSection, label: string) => s.nodes.find((n) => n.record.label === label);
const section = (n: ReportNode | undefined, levelId: string) => n?.children.find((s) => s.levelId === levelId);
const roll = (n: ReportNode | undefined, id: string) => n?.rollups.find((r) => r.id === id)?.value;

/* ── the checks ───────────────────────────────────────────────────────────── */

console.log('\nR1. The definition is validated');
check('the worked example is acceptable', reportDefError(deliverables, fields, tables) === null, reportDefError(deliverables, fields, tables) ?? '');
check('EMPTY_REPORT of a table is acceptable', reportDefError(EMPTY_REPORT(T.files), fields, tables) === null);
check('a non-object is refused with a path', (reportDefError({ v: 2 }, fields, tables) ?? '').startsWith('report: v'));
const bad = (mut: (d: any) => void) => { const d = JSON.parse(JSON.stringify(deliverables)); mut(d); return reportDefError(d, fields, tables) ?? ''; };
check('a field from another table in `fields`', bad((d) => { d.root.fields = [fPath]; }).includes('not a field of this level'));
check('a via that does not connect to the parent', bad((d) => { d.root.children[0].via = [{ fieldId: fFileDeliv }]; }).includes('does not connect'));
check('vias landing in different tables', bad((d) => { d.root.children[0].via.push({ fieldId: fWorkProject }); }).includes('different tables'));
check('a pin naming a non-ancestor', bad((d) => { d.root.children[0].children[0].pins[0].levelId = 'nope'; }).includes('not an ancestor'));
check('a pin whose field does not join the two tables', bad((d) => { d.root.children[0].children[0].pins[0].fieldId = fFileProject; }).includes('does not join'));
check('a rollup over a level that is not a direct child', bad((d) => { d.root.rollups[0].over = 'files'; }).includes('direct child'));
check('sum needs a number field', bad((d) => { d.root.children[0].rollups[2].fieldId = fPath; }).includes('number field'));
check('count where needs a condition', bad((d) => { delete d.root.rollups[1].where; }).includes('needs a condition'));
check('a rollup condition naming a rollup the child does not have', bad((d) => { d.root.rollups[1].where.rollup = 'ghost'; }).includes('not a rollup'));
check('a filter field from another table', bad((d) => { d.root.filters = [{ fieldId: fPath, op: 'notEmpty' }]; }).includes('not a field of this level'));
check('a root table that does not exist', bad((d) => { d.root.table = randomUUID(); }).includes('does not exist'));

console.log('\nR2. The walk: works › expected deliverables › files, with empties showing');
const out = runReport(deliverables, ctx);
check('root section is Works, sorted by name', out.tableId === T.works && out.nodes.map((n) => n.record.label).join('|') === 'Ep 101|Ep 102|Ep 201');
const ep101 = node(out, 'Ep 101'), ep102 = node(out, 'Ep 102'), ep201 = node(out, 'Ep 201');
const d101 = section(ep101, 'delivs')!;
check('Ep 101 expects DCP and ProRes (from the WORK\'s links, not from files)', d101.nodes.map((n) => n.record.label).join('|') === 'DCP 2K Flat|ProRes 4444 texted', d101.nodes.map((n) => n.record.label).join('|'));
const dcp101 = node(d101, 'DCP 2K Flat'), prores101 = node(d101, 'ProRes 4444 texted');
check('a deliverable with NO files is still a node, with an empty files section', !!dcp101 && section(dcp101, 'files')!.nodes.length === 0);
check('the files under ProRes are v2 then v1 (sorted desc), with their cells', section(prores101, 'files')!.nodes.map((n) => `${n.record.label}:${n.cells.map((c) => c.text).join('/')}`).join('|') === 'ep101_prores_v2.mov:/vol/ep101_prores_v2.mov/accepted/2026-09-14|ep101_prores_v1.mov:/vol/ep101_prores_v1.mov/superseded/');
check('a file of the work that is not a deliverable is nowhere in the report', JSON.stringify(out).includes('ep101_notes') === false);
check('a deliverable\'s own cells come from its fields list', prores101!.cells.map((c) => c.text).join() === 'ProRes 4444');

console.log('\nR3. Pins: the file must link to the Work above, not just the deliverable');
check('Ep 102\'s ProRes shows ONLY the ep102 file', section(node(section(ep102, 'delivs')!, 'ProRes 4444 texted'), 'files')!.nodes.map((n) => n.record.label).join() === 'ep102_prores_v1.mov');
check('the ep102 file does not appear under Ep 101\'s ProRes', !section(prores101, 'files')!.nodes.some((n) => n.record.label.startsWith('ep102')));

console.log('\nR4. Roles: a record reached through two vias appears once, with both');
check('DCP on Ep 101 is one node with roles bid, added', d101.nodes.filter((n) => n.record.label === 'DCP 2K Flat').length === 1 && dcp101!.roles.join() === 'bid,added');
check('ProRes on Ep 101 has role bid only', prores101!.roles.join() === 'bid');
check('Sister network on Ep 201 has role bid', node(section(ep201, 'delivs')!, 'Sister network')!.roles.join() === 'bid');

console.log('\nR5. Rollups, bottom-up');
check('files count per deliverable', roll(prores101, 'files') === 2 && roll(dcp101, 'files') === 0);
check('count where (field filter): accepted files', roll(prores101, 'accepted') === 1 && roll(dcp101, 'accepted') === 0);
check('sum of size', roll(prores101, 'bytes') === 22 && roll(dcp101, 'bytes') === null);
check('max of a date', roll(prores101, 'last') === '2026-09-14');
check('list of paths, distinct, joined', roll(prores101, 'paths') === '/vol/ep101_prores_v2.mov, /vol/ep101_prores_v1.mov');
check('"delivered" counts deliverables whose child rollup files > 0: Ep 101 is 1 of 2', roll(ep101, 'delivered') === 1 && roll(ep101, 'expected') === 2);
check('Ep 102 is 1 of 1, Ep 201 is 0 of 1', roll(ep102, 'delivered') === 1 && roll(ep102, 'expected') === 1 && roll(ep201, 'delivered') === 0 && roll(ep201, 'expected') === 1);

console.log('\nR6. Scope filters the root only');
const scoped = runReport(deliverables, { ...ctx, inScope: (r) => ctx.linksFrom(r.id, fWorkProject).includes(pA) });
check('inside Elvis: Ep 101 and Ep 102, not Ep 201', scoped.nodes.map((n) => n.record.label).join('|') === 'Ep 101|Ep 102');
check('descendants are reached by links, not by scope', section(node(section(node(scoped, 'Ep 101'), 'delivs')!, 'ProRes 4444 texted'), 'files')!.nodes.length === 2);

console.log('\nR7. Lenient at read time');
const fewer = fields.filter((f) => f.id !== fDCodec && f.id !== fAdded);
const lenient = runReport(deliverables, { ...ctx, fields: fewer });
const l101 = node(lenient, 'Ep 101')!;
check('a deleted field in `fields` is skipped, not an error', node(section(l101, 'delivs')!, 'ProRes 4444 texted')!.cells.length === 0);
check('a deleted via is skipped: DCP now arrives through bid alone', node(section(l101, 'delivs')!, 'DCP 2K Flat')!.roles.join() === 'bid');
check('a report whose root level filters to nothing is an empty section, not an error', runReport({ ...deliverables, root: { ...deliverables.root, filters: [{ fieldId: F['Works.Name'], op: 'eq', value: 'nothing' }] } }, ctx).nodes.length === 0);

console.log('\nR8. A loop in the data is walked once');
const chain: ReportDef = { v: 1, root: { id: 'edits', table: T.edits, fields: [], filters: [{ fieldId: F['Edits.Name'], op: 'eq', value: 'OEV2' }], sort: [], rollups: [],
  children: [{ id: 'prev', via: [{ fieldId: fPrev }], fields: [], filters: [], sort: [], rollups: [], children: [{ id: 'prev2', via: [{ fieldId: fPrev }], fields: [], filters: [], sort: [], rollups: [], children: [] }] }] } };
check('two levels with one id', (reportDefError({ ...chain, root: { ...chain.root, children: [{ ...chain.root.children[0], id: 'edits' }] } }, fields, tables) ?? '').includes('used twice'));
check('a self-linking table is a legal definition', reportDefError(chain, fields, tables) === null, reportDefError(chain, fields, tables) ?? '');
const loop = runReport(chain, ctx);
const oev2 = node(loop, 'OEV2')!, oev1 = node(section(oev2, 'prev')!, 'OEV1')!;
check('OEV2 › previous OEV1 › previous is EMPTY (OEV2 is already on the path)', !!oev1 && section(oev1, 'prev2')!.nodes.length === 0);
check('a definition deeper than MAX_DEPTH is refused', (() => { let d: any = { id: 'l8', via: [{ fieldId: fPrev }], children: [] }; for (let i = 7; i >= 1; i--) d = { id: `l${i}`, via: [{ fieldId: fPrev }], children: [d] }; return reportDefError({ v: 1, root: { id: 'r', table: T.edits, children: [d] } }, fields, tables) ?? ''; })().includes('deeper than'));

console.log('\nR9. Flattening: one row per leaf, ancestors repeated, empties as rows');
const flat = flattenReport(deliverables, out, ctx);
check('columns: Works, its rollups; Deliverables, role, Codec, its rollups; Files, its fields',
  flat.columns.join('|') === 'Works|Works: expected|Works: delivered|Deliverables|Deliverables: role|Deliverables: Codec|Deliverables: files|Deliverables: accepted|Deliverables: total size|Deliverables: last delivered|Deliverables: paths|Files|Files: Path|Files: Status|Files: Delivered', flat.columns.join('|'));
check('five rows: 101×DCP (empty), 101×ProRes×2, 102×ProRes×1, 201×Sister (empty)', flat.rows.length === 5, String(flat.rows.length));
check('the empty deliverable is a row with blank file columns', flat.rows[0].slice(0, 5).join('|') === 'Ep 101|2|1|DCP 2K Flat|bid, added' && flat.rows[0].slice(11).join('') === '');
check('ancestor columns repeat on every leaf row', flat.rows[1][0] === 'Ep 101' && flat.rows[2][0] === 'Ep 101' && flat.rows[1][11] === 'ep101_prores_v2.mov');
const csv = toCsv(flat);
check('CSV quotes a cell holding quotes and commas, doubling the quotes', csv.includes('"/vol/ep102 ""final"", v1.mov"'));
check('CSV starts with a BOM and ends every line with CRLF', csv.startsWith('\uFEFF') && csv.endsWith('\r\n') && csv.split('\r\n').length === 7);

console.log('\nR10. A grid as rows');
const g = flattenGrid(records.get(T.files)!, fields, [fPath, fSize, fStatus, fFileWork], ctx.links, labelOf);
check('columns are the visible fields by name, after the record label', g.columns.join('|') === 'Record|Path|Size|Status|Work');
check('a link cell is its labels; a number is its text; an empty select is blank', g.rows[3].join('|') === 'ep101_notes.txt|/vol/notes.txt|1||Ep 101', g.rows[3].join('|'));
check('a hidden (unlisted) field is not a column', !g.columns.includes('Delivered'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
