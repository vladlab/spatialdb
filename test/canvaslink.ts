/**
 * Linking from the canvas with ONE handle per card (contract/canvasLink.ts).
 *
 *   C1  the rule, without a server — which WAYS a table has, what a drop does. This
 *       is where "context-aware" is pinned down: every case, including a walk over
 *       every pair of tables.
 *   C2  the handle — one per card that can link, none on a card that cannot, none
 *       on rows any more
 *   C3  one way between the two tables: linked on release, said, undoable; a single
 *       link says what it replaces; already linked says so
 *   C4  several ways: always asked; a way already made is ticked, not offered again
 *   C5  no way: the card refuses (red), nothing is written — and FORWARD only
 *   C6  a junction: a pair, from either end; its status asked when it has any
 *   C7  empty canvas, or the ⊕ clicked: every way the table has — new, or find
 *   C8  a link the card does not show, to a record that is not on the canvas, is
 *       still KNOWN: the canvas loads what a drag can write
 */
import { randomUUID } from 'node:crypto';
import { mountApp, sleep } from './uiHarness.js';
import { dropVerdict, linkWays, verdictHint, waysBetween, type LinkWay, type WayField, type WayTable } from '../src/contract/canvasLink.js';
import { CARD_W, LINK_HANDLE_OUT, linkHandleAt } from '../src/client/canvas/cardLayout.js';

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

function pure() {
  console.log('\nC1. The rule, without a server');
  const id = () => randomUUID();
  const T = { edits: id(), files: id(), works: id(), deliv: id(), delivery: id(), review: id(), mentors: id(), boards: id(), gone: id() };
  const table = (tid: string, name: string, extra: Partial<WayTable> = {}): WayTable => ({ id: tid, name, singular_name: name.replace(/s$/, ''), kind: 'records', ...extra });
  let pos = 0;
  const field = (table_id: string, name: string, type: string, options: Record<string, unknown> = {}): WayField =>
    ({ id: id(), table_id, name, key: name.toLowerCase().replace(/\W+/g, '_'), type, position: pos++, options });
  const link = (table_id: string, name: string, to: string, extra: Record<string, unknown> = {}) => field(table_id, name, 'link', { target_table_id: to, ...extra });

  // Edits: two links to Files, a single link to Works, a link to ITSELF, a broken link.
  const eName = field(T.edits, 'Name', 'text'), eIn = link(T.edits, 'Inputs', T.files), eOut = link(T.edits, 'Outputs', T.files);
  const eWork = link(T.edits, 'Work', T.works, { single: true }), eBased = link(T.edits, 'Based on', T.edits), eBroken = link(T.edits, 'Vendor', T.gone);
  // Files: a link to Works; Deliverables: nothing of its own. A Delivery junction joins the two.
  const fName = field(T.files, 'Name', 'text'), fWork = link(T.files, 'Work', T.works);
  const jStatus = field(T.delivery, 'Status', 'select', { choices: ['Uploaded'] });
  const ja = link(T.delivery, 'File', T.files, { single: true }), jb = link(T.delivery, 'Deliverable', T.deliv, { single: true });
  const jSigned = link(T.delivery, 'Signed off by', T.works);   // (any table: a junction row's OTHER links are ordinary)
  const fDelivery = field(T.files, 'Delivery', 'backlink', { source_field_id: ja.id });
  const dName = field(T.deliv, 'Name', 'text'), dDelivery = field(T.deliv, 'Delivery', 'backlink', { source_field_id: jb.id });
  // A second junction between the same two tables, with NO columns on either; and one joining a table to itself.
  const ra = link(T.review, 'File', T.files, { single: true }), rb = link(T.review, 'Deliverable', T.deliv, { single: true });
  const ma = link(T.mentors, 'Mentor', T.works, { single: true }), mb = link(T.mentors, 'Mentee', T.works, { single: true });
  const wMentees = field(T.works, 'Mentees', 'backlink', { source_field_id: ma.id }), wMentors = field(T.works, 'Mentors', 'backlink', { source_field_id: mb.id });
  const fields = [eName, eIn, eOut, eWork, eBased, eBroken, fName, fWork, jStatus, ja, jb, jSigned, fDelivery, dName, dDelivery, ra, rb, ma, mb, wMentees, wMentors];
  const tables = [
    table(T.edits, 'Edits'), table(T.files, 'Files'), table(T.works, 'Works'), table(T.deliv, 'Deliverables'), table(T.boards, 'Boards', { kind: 'canvas' }),
    table(T.delivery, 'Delivery', { kind: 'junction', singular_name: 'Delivery', junction: { a: ja.id, b: jb.id, status: jStatus.id } }),
    table(T.review, 'Reviews', { kind: 'junction', singular_name: 'Review', junction: { a: ra.id, b: rb.id } }),
    table(T.mentors, 'Mentoring', { kind: 'junction', singular_name: 'Mentoring', junction: { a: ma.id, b: mb.id } }),
  ];
  const ways = (t: string) => linkWays(fields, tables, t);
  const names = (ws: LinkWay[]) => ws.map((w) => w.name).join();
  const between = (a: string, b: string) => waysBetween(ways(a), b);

  check('a table\'s ways are its own LINK fields, in field order — a broken link (its table gone) is not one',
    names(ways(T.edits)) === 'Inputs,Outputs,Work,Based on' && ways(T.edits).every((w) => w.kind === 'link'), names(ways(T.edits)));
  check('each knows where it leads, the field that shows it, and whether it holds only one',
    ways(T.edits).map((w) => w.toTable).join() === [T.files, T.files, T.works, T.edits].join()
      && ways(T.edits).every((w) => w.kind === 'link' && w.column === w.fieldId && w.key === w.fieldId)
      && ways(T.edits).map((w) => w.kind === 'link' && w.single).join() === 'false,false,true,false');
  check('FORWARD only: Files holds no link to Edits, so there is no way from a File to an Edit — the backlink reading is not offered',
    between(T.files, T.edits).length === 0 && between(T.edits, T.files).length === 2);
  check('a JUNCTION is a way from BOTH its ends — named by its column there, keyed by the junction table',
    names(between(T.files, T.deliv)) === 'Delivery,Review' && names(between(T.deliv, T.files)) === 'Delivery,Review'
      && between(T.files, T.deliv).every((w) => w.kind === 'junction' && w.side === 'a') && between(T.deliv, T.files).every((w) => w.kind === 'junction' && w.side === 'b')
      && between(T.files, T.deliv)[0]!.key === T.delivery && between(T.files, T.deliv)[0]!.column === fDelivery.id, names(between(T.files, T.deliv)));
  check('a junction sits where its COLUMN does among the fields; one with no column is named for itself and goes last',
    names(ways(T.files)) === 'Work,Delivery,Review' && ways(T.files)[2]!.column === undefined, names(ways(T.files)));
  check('a junction table\'s own two ENDPOINT links are not ways (a pair is made whole, never re-pointed) — its other links are',
    names(ways(T.delivery)) === 'Signed off by', names(ways(T.delivery)));
  check('a junction joining a table to ITSELF is two ways — one per end — so it is always asked',
    names(between(T.works, T.works)) === 'Mentees,Mentors' && between(T.works, T.works).map((w) => w.kind === 'junction' && w.side).join() === 'a,b', names(between(T.works, T.works)));
  check('a table that links to nothing has no ways at all (its cards get no handle)', ways(T.boards).length === 0 && ways(T.gone).length === 0);

  const never = () => false, always = () => true;
  const kind = (a: string, b: string, made: (w: LinkWay) => boolean = never, same = false) => dropVerdict(between(a, b), same, made).kind;
  check('dropped on the card it started from: nothing', kind(T.edits, T.edits, never, true) === 'self' && kind(T.edits, T.files, never, true) === 'self');
  check('NO way between the tables: refused', kind(T.edits, T.deliv) === 'none' && kind(T.files, T.edits) === 'none' && kind(T.boards, T.files) === 'none');
  check('ONE way, a link field: it is made', kind(T.edits, T.works) === 'link' && kind(T.files, T.works) === 'link');
  check('…a link to its OWN table too — one field, one (forward) reading', kind(T.edits, T.edits) === 'link');
  check('ONE way, already made: said, not made twice', kind(T.edits, T.works, always) === 'linked');
  const v2 = dropVerdict(between(T.edits, T.files), false, never);
  check('SEVERAL ways: asked — all of them offered', v2.kind === 'choose' && v2.options.map((o) => `${o.way.name}:${o.linked}`).join() === 'Inputs:false,Outputs:false');
  const v2b = dropVerdict(between(T.edits, T.files), false, (w) => w.key === eIn.id);
  check('several ways, ONE already made: STILL asked (never "auto-link the one that is left") — the made one marked',
    v2b.kind === 'choose' && v2b.options.map((o) => `${o.way.name}:${o.linked}`).join() === 'Inputs:true,Outputs:false');
  check('several ways, ALL made: said', kind(T.edits, T.files, always) === 'linked');
  // One junction between two tables: strip the second for this.
  const only = between(T.files, T.deliv).filter((w) => w.key === T.delivery);
  const vp = dropVerdict(only, false, never);
  check('ONE way, a junction: a pair — its status is the caller\'s to ask', vp.kind === 'pair' && vp.way.table === T.delivery && vp.way.side === 'a');
  check('two junctions between the same tables: asked, like any several', kind(T.files, T.deliv) === 'choose');

  // THE WALK: whatever the two tables, the verdict follows the COUNT of ways and nothing else.
  let odd = '';
  for (const a of tables) for (const b of tables) {
    const n = between(a.id, b.id).length;
    const fresh = kind(a.id, b.id), done = kind(a.id, b.id, always);
    const want = n === 0 ? 'none' : n === 1 ? (between(a.id, b.id)[0]!.kind === 'link' ? 'link' : 'pair') : 'choose';
    if (fresh !== want || done !== (n === 0 ? 'none' : 'linked')) odd += `${a.name}→${b.name}: ${n} ways, ${fresh}/${done}; `;
    if (between(a.id, b.id).some((w) => w.toTable !== b.id)) odd += `${a.name}→${b.name}: a way that does not end there; `;
  }
  check(`every ordered pair of ${tables.length} tables: 0 ways refuses, 1 makes it, more asks — and all-made says so`, !odd, odd);
  check('the same answer whatever order the fields and tables arrive in', names(linkWays([...fields].reverse(), [...tables].reverse(), T.files)) === names(ways(T.files))
    && names(linkWays([...fields].reverse(), [...tables].reverse(), T.edits)) === names(ways(T.edits)));

  const N = { from: 'Edits', to: 'Files' };
  const one = dropVerdict(between(T.edits, T.works), false, never);
  check('the label by the pointer: the field, for one way', verdictHint(one, N) === 'Work');
  check('…what a single link would REPLACE, when it holds something', verdictHint(one, N, 'Ep 101') === 'Work · replaces Ep 101');
  check('…both names, for two ways; a count, for more', verdictHint(v2, N) === 'Inputs or Outputs…'
    && verdictHint({ kind: 'choose', options: [...v2.kind === 'choose' ? v2.options : [], { way: between(T.edits, T.works)[0]!, linked: false }] }, N) === '3 choices…');
  check('…a pair is still to be finished', verdictHint(vp, N) === 'Delivery…');
  check('…already linked, and no way, say so in words', verdictHint(dropVerdict(between(T.edits, T.works), false, always), N) === 'already linked · Work'
    && verdictHint({ kind: 'none' }, { from: 'Edits', to: 'Deliverables' }) === 'no link from Edits to Deliverables' && verdictHint({ kind: 'self' }, N) === '');

  const at = linkHandleAt({ x: 100, y: 50, w: 240, h: 80 });
  check('the handle\'s centre is just outside the card\'s bottom-right corner — the corner inside is the resize handle\'s',
    at.x === 340 + LINK_HANDLE_OUT && at.y === 130 + LINK_HANDLE_OUT && LINK_HANDLE_OUT > 0);
}

async function main() {
  pure();
  const PORT = Number(process.env.TEST_PORT ?? 8847);
  const tEdits = randomUUID(), tFiles = randomUUID(), tWorks = randomUUID(), tDeliv = randomUUID(), tJ = randomUUID(), tBoards = randomUUID();
  const tNotes = randomUUID(), fNName = randomUUID(), fNAbout = randomUUID(), note = randomUUID(), ep3 = randomUUID();
  const fEName = randomUUID(), fOut = randomUUID(), fIn = randomUUID(), fEWork = randomUUID();
  const fFName = randomUUID(), fFWork = randomUUID(), fWName = randomUUID(), fDName = randomUUID(), fBName = randomUUID();
  const ja = randomUUID(), jb = randomUUID(), jStatus = randomUUID();
  const oev = randomUUID(), a = randomUUID(), b = randomUUID(), c = randomUUID(), ep1 = randomUUID(), ep2 = randomUUID(), texted = randomUUID(), trailer = randomUUID(), board = randomUUID();
  const pos = (id: string, position: number) => ({ type: 'field.update', id, position });
  // Where each card is (world). Unresized, unfolded; (x + 30, y + 20) is inside any of them.
  const AT: Record<string, { x: number; y: number }> = {
    [oev]: { x: 40, y: 40 }, [a]: { x: 500, y: 40 }, [b]: { x: 500, y: 400 }, [ep1]: { x: 960, y: 40 }, [ep2]: { x: 960, y: 400 },
    [texted]: { x: 40, y: 500 }, [trailer]: { x: 40, y: 760 }, [note]: { x: 1400, y: 40 },
  };
  const ui = await mountApp(PORT, `#/all/canvas/${board}`, {}, async (post) => {
    const res = await post([
      { type: 'table.create', id: tEdits, name: 'Edits', singularName: 'Edit' }, { type: 'table.update', id: tEdits, position: 1 },
      { type: 'table.create', id: tFiles, name: 'Files', singularName: 'File' }, { type: 'table.update', id: tFiles, position: 2 },
      { type: 'table.create', id: tWorks, name: 'Works', singularName: 'Work' }, { type: 'table.update', id: tWorks, position: 3 },
      { type: 'table.create', id: tDeliv, name: 'Deliverables', singularName: 'Deliverable' }, { type: 'table.update', id: tDeliv, position: 4 },
      { type: 'field.create', id: fEName, tableId: tEdits, name: 'Name', key: 'name', fieldType: 'text' }, pos(fEName, 0),
      { type: 'field.create', id: fOut, tableId: tEdits, name: 'Outputs', key: 'outputs', fieldType: 'link', options: { target_table_id: tFiles, arrow: { color: '#d97706' } } }, pos(fOut, 1),
      { type: 'field.create', id: fIn, tableId: tEdits, name: 'Inputs', key: 'inputs', fieldType: 'link', options: { target_table_id: tFiles } }, pos(fIn, 2),
      { type: 'field.create', id: fEWork, tableId: tEdits, name: 'Work', key: 'work', fieldType: 'link', options: { target_table_id: tWorks, single: true } }, pos(fEWork, 3),
      { type: 'field.create', id: fFName, tableId: tFiles, name: 'Name', key: 'name', fieldType: 'text' }, pos(fFName, 0),
      { type: 'field.create', id: fFWork, tableId: tFiles, name: 'Work', key: 'work', fieldType: 'link', options: { target_table_id: tWorks } }, pos(fFWork, 1),
      { type: 'field.create', id: fWName, tableId: tWorks, name: 'Name', key: 'name', fieldType: 'text' },
      { type: 'field.create', id: fDName, tableId: tDeliv, name: 'Name', key: 'name', fieldType: 'text' },
      // The junction, as the new-table dialog makes it — its Status with NO choices yet.
      { type: 'table.create', id: tJ, name: 'Delivery', singularName: 'Delivery', kind: 'junction' },
      { type: 'field.create', id: jStatus, tableId: tJ, name: 'Status', key: 'status', fieldType: 'select', options: { choices: [] } },
      { type: 'field.create', id: ja, tableId: tJ, name: 'File', key: 'file', fieldType: 'link', options: { target_table_id: tFiles, single: true } },
      { type: 'field.create', id: jb, tableId: tJ, name: 'Deliverable', key: 'deliverable', fieldType: 'link', options: { target_table_id: tDeliv, single: true } },
      { type: 'table.update', id: tJ, junction: { a: ja, b: jb, status: jStatus } },
      { type: 'field.create', id: randomUUID(), tableId: tFiles, name: 'Delivery', key: 'delivery', fieldType: 'backlink', options: { source_field_id: ja } },
      { type: 'field.create', id: randomUUID(), tableId: tDeliv, name: 'Delivery', key: 'delivery', fieldType: 'backlink', options: { source_field_id: jb } },
      { type: 'table.create', id: tBoards, name: 'Boards', kind: 'canvas' },
      { type: 'field.create', id: fBName, tableId: tBoards, name: 'Name', key: 'name', fieldType: 'text' },
      { type: 'record.create', id: board, tableId: tBoards, data: { name: 'Board' } },
      { type: 'record.create', id: oev, tableId: tEdits, data: { name: 'OEV1' } },
      { type: 'record.create', id: a, tableId: tFiles, data: { name: 'a.mov' } }, { type: 'record.create', id: b, tableId: tFiles, data: { name: 'b.mov' } },
      { type: 'record.create', id: c, tableId: tFiles, data: { name: 'c.mov' } },                     // NOT placed
      { type: 'record.create', id: ep1, tableId: tWorks, data: { name: 'Ep 101' } }, { type: 'record.create', id: ep2, tableId: tWorks, data: { name: 'Ep 102' } },
      { type: 'record.create', id: texted, tableId: tDeliv, data: { name: 'Texted Master' } }, { type: 'record.create', id: trailer, tableId: tDeliv, data: { name: 'Trailer' } },
      // C8: a QC note is About one Work (a single link) — Ep 103, which is NOT on the board —
      // and its cards show no fields at all, so nothing on screen reads that table.
      { type: 'table.create', id: tNotes, name: 'QC notes', singularName: 'QC note' }, { type: 'table.update', id: tNotes, position: 5 },
      { type: 'field.create', id: fNName, tableId: tNotes, name: 'Name', key: 'name', fieldType: 'text' }, pos(fNName, 0),
      { type: 'field.create', id: fNAbout, tableId: tNotes, name: 'About', key: 'about', fieldType: 'link', options: { target_table_id: tWorks, single: true } }, pos(fNAbout, 1),
      { type: 'record.create', id: ep3, tableId: tWorks, data: { name: 'Ep 103' } },
      { type: 'record.create', id: note, tableId: tNotes, data: { name: 'Slate' } },
      { type: 'link.add', id: randomUUID(), fieldId: fNAbout, fromRecord: note, toRecord: ep3 },
      // Edit cards on this board show ONLY Outputs: Inputs and Work are links the card does not show.
      { type: 'canvas.update', id: board, config: { cardFields: { [tEdits]: [fOut], [tNotes]: [] } } },
      ...Object.entries(AT).map(([recordId, p], i) => ({ type: 'placement.add', id: randomUUID(), canvasId: board, recordId, x: p.x, y: p.y, w: null, h: null, z: i + 1 })),
    ]);
    if (res.status !== 200) throw new Error(`fixture refused: ${(await res.text()).slice(0, 300)}`);
  });
  const { w, win, pool, until, untilDb, post } = ui;
  try {
    const cards = () => w.findAll('.canvas-container .card');
    const cardBy = (t: string) => cards().find((x: any) => x.find('.card-label').text() === t)!;
    const PE = (win as any).PointerEvent ?? (win as any).MouseEvent;
    const winEv = (type: string, init: Record<string, unknown>) => win.dispatchEvent(new PE(type, { bubbles: true, ...init }));
    const hotkey = (k: string) => win.dispatchEvent(new (win as any).KeyboardEvent('keydown', { key: k, ctrlKey: true, bubbles: true }));
    // happy-dom has no layout, so the container's box is at the origin: world → client is just the viewport transform.
    const toClient = (wx: number, wy: number) => {
      const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)\s*scale\(([\d.]+)\)/.exec(w.find('.canvas-world').attributes('style') ?? '')!;
      return { clientX: wx * Number(m[3]) + Number(m[1]), clientY: wy * Number(m[3]) + Number(m[2]) };
    };
    const on = (id: string) => toClient(AT[id]!.x + 30, AT[id]!.y + 20);
    const EMPTY = { x: 2400, y: 1200 };
    const name: Record<string, string> = { [note]: 'Slate', [oev]: 'OEV1', [a]: 'a.mov', [b]: 'b.mov', [ep1]: 'Ep 101', [ep2]: 'Ep 102', [texted]: 'Texted Master', [trailer]: 'Trailer' };
    /** Press the ⊕ of `from` and carry the link to a client point — still held. */
    const carry = async (from: string, to: { clientX: number; clientY: number }) => {
      await cardBy(name[from]!).find('.link-handle').trigger('pointerdown', { button: 0, ...toClient(AT[from]!.x + CARD_W + 5, AT[from]!.y + 100) });
      winEv('pointermove', to);
      await until(() => w.find('.arrow-layer .rubber').exists());
    };
    const drop = async (from: string, to: { clientX: number; clientY: number }) => { await carry(from, to); winEv('pointerup', to); await sleep(60); };
    const links = async (fieldId: string, from: string) => (await pool.query(`select to_record from links where field_id = $1 and from_record = $2 order by to_record`, [fieldId, from])).rows.map((r: any) => r.to_record as string);
    const allLinks = async () => Number((await pool.query(`select count(*)::int n from links`)).rows[0].n);
    const untilLinks = (fieldId: string, from: string, want: string[]) =>
      untilDb(`select to_record from links where field_id = '${fieldId}' and from_record = '${from}'`, (r) => r.map((x) => x.to_record).sort().join() === [...want].sort().join());
    const linked = async (fieldId: string, from: string, want: string[]) => (await untilLinks(fieldId, from, want)).map((x) => x.to_record).sort().join() === [...want].sort().join();
    const hint = () => (w.find('.link-note.live').exists() ? w.find('.link-note.live').text() : '');
    const said = () => (w.find('.link-note.said').exists() ? w.find('.link-note.said').text() : '');
    const ctx = () => w.find('.canvas-container .ctx');
    const arrow = (key: string) => w.find(`.arrow-layer .arrow[data-key="${key}"]`);

    const seeded = await allLinks();   // (the fixture's one link)

    console.log('\nC2. One handle per card');
    check('the eight cards are up', await until(() => cards().length === 8, 8000));
    // happy-dom gives the container no size, so the fit at mount lands on the zoom FLOOR
    // (2% since fit-everything was allowed to go that small) — where a drag across the
    // whole board is a few screen pixels, under the handle's click slop. Back to 100%.
    await w.find('.canvas-controls button[title="Reset to 100%"]').trigger('click');
    check('a card whose table can link has exactly ONE ⊕ — Edits, Files (a link), Deliverables (only a junction)',
      await until(() => cardBy('OEV1').findAll('.link-handle').length === 1) && cardBy('a.mov').findAll('.link-handle').length === 1 && cardBy('Trailer').findAll('.link-handle').length === 1);
    check('a card whose table links to NOTHING has none (Works)', !cardBy('Ep 101').find('.link-handle').exists() && !cardBy('Ep 102').find('.link-handle').exists());
    check('the per-row handles are gone', !w.find('.port-handle').exists() && cardBy('OEV1').findAll('.card-field').length === 1);
    await cardBy('OEV1').find('.card-fold').trigger('click');
    check('a FOLDED card still has its handle — it does not depend on any row being visible', await until(() => cardBy('OEV1').classes('collapsed')) && cardBy('OEV1').find('.link-handle').exists());
    await cardBy('OEV1').find('.card-fold').trigger('click');
    await until(() => !cardBy('OEV1').classes('collapsed'));

    // (Out of order on purpose: it must run COLD, before anything else has had a reason to load that table.)
    console.log('\nC8. What a drag can write is known, shown or not');
    check('fixture: the note\'s card shows no rows, and Ep 103 is not on the board', cardBy('Slate').findAll('.card-field').length === 0 && !cardBy('Ep 103') && cardBy('Slate').find('.link-handle').exists());
    await carry(note, on(ep2));
    check('a single link the card does not show, to a record not on the canvas, is still known: the label says what would be replaced', await until(() => hint() === 'About · replaces Ep 103', 6000), hint());
    winEv('pointerup', on(ep2));
    check('…and it IS replaced — one link, not a second one refused by the server', await linked(fNAbout, note, [ep2]) && await until(() => said() === '✓ About · replaced Ep 103') && !w.find('.errors').exists(), said());
    hotkey('z');
    check('…one Ctrl+Z: About Ep 103 again', await linked(fNAbout, note, [ep3]));

    console.log('\nC3. One way between the two tables');
    await carry(oev, on(ep1));
    check('held over a Work: every card says what it is to this drag — from, about to take it, could take it, cannot',
      await until(() => cardBy('Ep 101').classes('link-over')) && cardBy('OEV1').classes('link-from') && cardBy('Ep 102').classes('link-ok') && cardBy('a.mov').classes('link-ok')
        && cardBy('Texted Master').classes('link-dim') && cardBy('Trailer').classes('link-dim'), cards().map((x: any) => x.classes().filter((k: string) => k.startsWith('link-')).join('+')).join());
    check('the label by the pointer names the field it would be — one the card does not even show', hint() === 'Work', hint());
    check('the line is solid', w.find('.arrow-layer .rubber').classes('valid'));
    winEv('pointermove', on(texted));
    check('over a card it cannot link to: marked, dashed, and said why — before letting go',
      await until(() => cardBy('Texted Master').classes('link-no')) && !w.find('.arrow-layer .rubber').classes('valid') && hint() === 'no link from Edits to Deliverables', hint());
    winEv('pointermove', toClient(EMPTY.x, EMPTY.y));
    check('over empty canvas: a new or existing record', await until(() => hint() === 'new or existing record…'), hint());
    check('nothing is written while it is held', await allLinks() === seeded);
    winEv('pointermove', on(ep1));
    await until(() => cardBy('Ep 101').classes('link-over'));
    winEv('pointerup', on(ep1));
    check('let go on the Work: linked through the one field there is — no menu, no question', await linked(fEWork, oev, [ep1]) && !ctx().exists());
    check('…and SAID, where it was dropped', await until(() => said() === '✓ Work'), said());
    check('…the new arrow pulses', await until(() => arrow(`${fEWork}|${oev}|${ep1}`).exists() && arrow(`${fEWork}|${oev}|${ep1}`).classes('pulse')));
    check('the drag is over: no line, no marks, and the card it came from is selected (its handle stays up)',
      !w.find('.rubber').exists() && !cards().some((x: any) => x.classes().some((k: string) => k.startsWith('link-'))) && cardBy('OEV1').classes('selected'));

    await carry(oev, on(ep2));
    check('a SINGLE link that holds something says what letting go would replace', await until(() => hint() === 'Work · replaces Ep 101'), hint());
    winEv('pointerup', on(ep2));
    check('…and replaces it', await linked(fEWork, oev, [ep2]) && await until(() => said() === '✓ Work · replaced Ep 101'), said());
    hotkey('z');
    check('…one Ctrl+Z puts the old one back', await linked(fEWork, oev, [ep1]));

    await carry(oev, on(ep1));
    check('a card it is ALREADY linked to: neither offered nor dimmed, and said', await until(() => hint() === 'already linked · Work') && cardBy('Ep 101').classes('link-linked') && !w.find('.rubber').classes('valid'), hint());
    const before = await allLinks();
    winEv('pointerup', on(ep1));
    check('…letting go writes nothing, says so, and pulses the arrow that is already there',
      await until(() => said() === 'already linked · Work') && await until(() => arrow(`${fEWork}|${oev}|${ep1}`).classes('pulse')) && await allLinks() === before && !ctx().exists(), said());

    console.log('\nC4. Several ways: asked');
    await carry(oev, on(a));
    check('an Edit over a File: two fields lead there, and the label names both', await until(() => hint() === 'Outputs or Inputs…') && cardBy('a.mov').classes('link-over'), hint());
    winEv('pointerup', on(a));
    const ways = () => ctx().findAll('.way');
    check('let go: a menu of the ways, naming the two records', await until(() => ctx().exists()) && ctx().find('.ctx-head').text() === 'Link through…' && ctx().find('.ctx-sub').text() === 'OEV1 → a.mov'
      && ways().map((x: any) => x.find('.way-name').text()).join() === 'Outputs,Inputs', ctx().exists() ? ctx().text() : 'no menu');
    check('…and nothing written until one is chosen', await allLinks() === before);
    await ways()[0].trigger('click');
    check('choosing Outputs makes THAT link', await linked(fOut, oev, [a]) && (await links(fIn, oev)).length === 0 && await until(() => said() === '✓ Outputs' && !ctx().exists()), said());
    check('the card\'s Outputs row shows it', await until(() => cardBy('OEV1').find('.card-field .pill-text').exists() && cardBy('OEV1').find('.card-field .pill-text').text() === 'a.mov'));

    await drop(oev, on(a));
    check('the same two cards again: STILL asked — the way already made is ticked and cannot be made twice',
      await until(() => ctx().exists()) && ways().length === 2 && ways()[0].classes('made') && ways()[0].attributes('disabled') !== undefined && /✓ linked/.test(ways()[0].text())
        && !ways()[1].classes('made') && ways()[1].attributes('disabled') === undefined, ctx().exists() ? ctx().html().slice(0, 400) : 'no menu');
    await ways()[1].trigger('click');
    check('choosing Inputs makes the other', await linked(fIn, oev, [a]) && await linked(fOut, oev, [a]));
    await carry(oev, on(a));
    check('both made: nothing left to ask', await until(() => hint() === 'already linked · Outputs, Inputs') && cardBy('a.mov').classes('link-linked'), hint());
    winEv('pointerup', on(a));
    await sleep(80);
    check('…no menu', !ctx().exists());

    const mid = await allLinks();
    await drop(oev, on(b));
    await until(() => ctx().exists());
    await w.find('.canvas-container').trigger('keydown', { key: 'Escape' });
    check('Escape on the menu: nothing is linked', await until(() => !ctx().exists()) && await allLinks() === mid);
    await carry(oev, on(b));
    win.dispatchEvent(new (win as any).KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    check('Escape while a link is held abandons it', await until(() => !w.find('.rubber').exists() && !w.find('.link-note.live').exists()));
    winEv('pointerup', on(b));
    await sleep(80);
    check('…and the release that follows does nothing', !ctx().exists() && await allLinks() === mid);

    console.log('\nC5. No way: refused');
    await drop(oev, on(texted));
    check('an Edit dropped on a Deliverable: the card flashes red', await until(() => cardBy('Texted Master').classes('refused')));
    check('…and that is all: no link, no menu, no error — and a word on why', await allLinks() === mid && !ctx().exists() && !w.find('.errors').exists() && said() === 'no link from Edits to Deliverables', said());
    check('the flash ends by itself', await until(() => !cardBy('Texted Master').classes('refused'), 2000));
    await carry(a, on(oev));
    check('FORWARD only: a File dragged onto the Edit it is an input of is not a way (yet) — refused, like any other',
      await until(() => cardBy('OEV1').classes('link-no')) && hint() === 'no link from Files to Edits', hint());
    winEv('pointerup', on(oev));
    check('…', await until(() => cardBy('OEV1').classes('refused')) && await allLinks() === mid);
    await until(() => !cardBy('OEV1').classes('refused'), 2000);
    await drop(oev, on(oev));
    check('dropped back on the card it came from: nothing at all', !ctx().exists() && await allLinks() === mid && !cardBy('OEV1').classes('refused'));

    console.log('\nC6. A junction: a pair, from either end');
    const pairs = async () => (await pool.query(
      `select r.id, coalesce(r.data->>'status', '') s, (select to_record from links where from_record = r.id and field_id = $2) f, (select to_record from links where from_record = r.id and field_id = $3) d
         from records r where r.table_id = $1 order by r.created_at`, [tJ, ja, jb])).rows as Array<{ id: string; s: string; f: string; d: string }>;
    const untilPairs = (n: number) => untilDb(`select r.id, (select count(*)::int from links where from_record = r.id) n from records r where r.table_id = '${tJ}'`, (r) => r.length === n && r.every((x) => x.n === 2));
    await carry(a, on(texted));
    check('a File over a Deliverable: the junction is the one way', await until(() => hint() === 'Delivery…') && cardBy('Texted Master').classes('link-over') && cardBy('Trailer').classes('link-ok') && cardBy('OEV1').classes('link-dim'), hint());
    winEv('pointerup', on(texted));
    await untilPairs(1);
    let ps = await pairs();
    check('its status has no choices yet, so there is nothing to ask: the pair is made — row and both links', ps.length === 1 && ps[0]!.f === a && ps[0]!.d === texted && !w.find('.je').exists(), JSON.stringify(ps));
    check('…said, and drawn as the junction\'s arrow', await until(() => said() === '✓ Delivery') && await until(() => arrow(`${tJ}|${a}|${texted}`).exists()), said());

    check('status choices added', (await post([{ type: 'field.update', id: jStatus, options: { choices: ['Uploaded', 'Accepted'] } }])).status === 200);
    await sleep(400);
    await drop(a, on(trailer));
    check('now a pair has a status to pick: the pair editor opens on the two records — nothing written yet',
      await until(() => w.find('.junction-anchor .je').exists()) && !w.find('.je .picker').exists() && w.find('.je .head').text().includes('Trailer') && (await pairs()).length === 1, w.find('.je').exists() ? w.find('.je').text() : 'no editor');
    await w.findAll('.je .st').find((x: any) => x.text() === 'Uploaded').trigger('click');
    await w.find('.je .act.primary').trigger('click');
    await untilPairs(2);
    ps = await pairs();
    check('Add: the pair, with its status', ps.length === 2 && ps[1]!.f === a && ps[1]!.d === trailer && ps[1]!.s === 'Uploaded', JSON.stringify(ps));
    await w.find('.je .act:not(.primary):not(.danger)').trigger('click');   // Done
    await until(() => !w.find('.je').exists());

    await drop(trailer, on(b));
    check('from the OTHER end — a Deliverable onto a File — the same junction, the same question', await until(() => w.find('.junction-anchor .je').exists()) && w.find('.je .head').text().includes('b.mov'), w.find('.je').exists() ? w.find('.je').text() : 'no editor');
    await w.find('.je .act.primary').trigger('click');
    await untilPairs(3);
    ps = await pairs();
    check('…and the pair is the right way round: the file is the File, whichever card it was dragged from', ps.length === 3 && ps[2]!.f === b && ps[2]!.d === trailer, JSON.stringify(ps));
    await w.find('.je .act:not(.primary):not(.danger)').trigger('click');
    await until(() => !w.find('.je').exists());

    await carry(a, on(texted));
    check('a pair that already exists is "already linked" — one row per pair', await until(() => hint() === 'already linked · Delivery'), hint());
    winEv('pointerup', on(texted));
    await sleep(120);
    check('…dropping makes no second row and opens nothing', (await pairs()).length === 3 && !w.find('.je').exists());

    console.log('\nC7. Empty canvas, or the ⊕ clicked: every way this table has');
    const groups = () => ctx().findAll('.ctx-title').map((x: any) => x.text());
    const rows = () => ctx().findAll('.way-row');
    const rowNames = () => rows().map((r: any) => r.find('.way-name').text()).join();
    const base = await allLinks();
    await drop(oev, toClient(EMPTY.x, EMPTY.y));
    check('an Edit\'s link let go on EMPTY canvas: a menu of every link field it has — the one its card shows first, the rest under their own heading',
      await until(() => ctx().exists()) && ctx().find('.ctx-head').text() === 'OEV1' && groups().join('|') === 'New record, linked through…|Not shown on this card' && rowNames() === 'Outputs,Inputs,Work',
      ctx().exists() ? `${groups().join('|')} / ${rowNames()}` : 'no menu');
    check('…each says what it would make, and has a "find…" beside it', rows().map((r: any) => r.find('.way-note').text()).join() === 'new File,new File,new Work' && rows().every((r: any) => r.find('.way-find').exists()));
    check('…nothing written by opening it', await allLinks() === base);
    await rows()[1].find('.new-via').trigger('click');   // Inputs
    const made = await untilDb(`select l.to_record id from links l where l.field_id = '${fIn}' and l.from_record = '${oev}' and l.to_record <> '${a}'`, (r) => r.length === 1);
    const newId = made[0]?.id as string;
    const pl = await untilDb(`select x, y from placements where canvas_id = '${board}' and record_id = '${newId}'`, (r) => r.length === 1);
    check('a row: a NEW File, linked from the Edit through THAT field', made.length === 1 && (await pool.query(`select table_id from records where id = $1`, [newId])).rows[0]?.table_id === tFiles);
    check('…placed where the link was let go', pl.length === 1 && pl[0].x === EMPTY.x - CARD_W / 2 && pl[0].y === EMPTY.y - 24, JSON.stringify(pl));
    check('…selected, and open in the tray to be named', await until(() => w.find('.record-panel').exists()) && await until(() => cards().length === 9) && cards().filter((x: any) => x.classes('selected')).length === 1);
    hotkey('z');
    check('…and all of it is ONE Ctrl+Z: record, link and card', (await untilDb(`select 1 from records where id = '${newId}'`, (r) => r.length === 0)).length === 0
      && (await pool.query(`select count(*)::int n from placements where record_id = $1`, [newId])).rows[0].n === 0 && await allLinks() === base);
    if (w.find('.record-panel .rp-close').exists()) await w.find('.record-panel .rp-close').trigger('click');

    await drop(oev, toClient(EMPTY.x, EMPTY.y));
    await until(() => ctx().exists());
    await rows()[0].find('.way-find').trigger('click');   // Outputs → find…
    const lp = () => w.find('.link-pick');
    check('"find…": the link picker, there, on that field\'s table', await until(() => lp().exists()) && !ctx().exists() && /OEV1/.test(lp().text()) && /Files/.test(lp().text()), lp().exists() ? lp().text() : 'no picker');
    await lp().find('.picker input').setValue('c.mov');
    await until(() => lp().findAll('.picker .list li').some((li: any) => li.find('.name').text() === 'c.mov'));
    await lp().findAll('.picker .list li').find((li: any) => li.find('.name').text() === 'c.mov')!.trigger('mousedown');
    const cp = await untilDb(`select x, y from placements where canvas_id = '${board}' and record_id = '${c}'`, (r) => r.length === 1);
    check('choosing an EXISTING record links it through that field and places it where the link was let go — the same spot a new one takes',
      await linked(fOut, oev, [a, c]) && cp.length === 1 && cp[0].x === EMPTY.x - CARD_W / 2 && cp[0].y === EMPTY.y - 24 && !lp().exists(), JSON.stringify(cp));

    await drop(a, toClient(EMPTY.x, EMPTY.y + 400));
    check('a File\'s menu: its link, and its junction as a row of its own — a pair is picked, not blank-made',
      await until(() => ctx().exists()) && rowNames() === 'Work,Delivery' && rows()[1].find('.pair-via').exists() && !rows()[1].find('.way-find').exists() && rows()[1].find('.way-note').text() === 'pick a Deliverable…', ctx().exists() ? ctx().text() : 'no menu');
    await rows()[1].find('.pair-via').trigger('click');
    check('…it opens the pair editor on its picker', await until(() => w.find('.junction-anchor .je .picker').exists()) && !ctx().exists());
    await w.find('.je .picker input').trigger('keydown', { key: 'Escape' });
    await until(() => !w.find('.je').exists());

    // A CLICK: press and release on the handle without moving.
    const hx = toClient(AT[oev]!.x + CARD_W + 5, AT[oev]!.y + 100);
    await cardBy('OEV1').find('.link-handle').trigger('pointerdown', { button: 0, ...hx });
    winEv('pointerup', hx);
    check('the ⊕ CLICKED, not dragged: the same menu — and no line was ever drawn', await until(() => ctx().exists()) && rowNames() === 'Outputs,Inputs,Work' && !w.find('.rubber').exists());
    await rows()[2].find('.new-via').trigger('click');   // Work (single: replaces Ep 101)
    const nw = await untilDb(`select l.to_record id, p.x, p.y from links l join placements p on p.record_id = l.to_record and p.canvas_id = '${board}' where l.field_id = '${fEWork}' and l.from_record = '${oev}'`, (r) => r.length === 1 && r[0].id !== ep1);
    const others = (await pool.query(`select x, y from placements where canvas_id = $1 and record_id <> $2`, [board, nw[0]?.id])).rows as Array<{ x: number; y: number }>;
    check('…the new record goes BESIDE the card, to its right, clear of the cards already there',
      nw.length === 1 && nw[0].x === AT[oev]!.x + CARD_W + 64 && nw[0].y >= AT[oev]!.y && !others.some((o) => Math.abs(o.x - nw[0].x) < CARD_W && Math.abs(o.y - nw[0].y) < 96), JSON.stringify(nw));
    check('…a single link made this way replaces too, in the same step', await linked(fEWork, oev, [nw[0]?.id]));
    hotkey('z');
    check('…and one Ctrl+Z undoes the whole step: the new Work gone, Ep 101 linked again', await linked(fEWork, oev, [ep1]) && (await untilDb(`select 1 from records where id = '${nw[0]?.id}'`, (r) => r.length === 0)).length === 0);

    check('nothing went wrong along the way', !w.find('.errors').exists());
  } finally {
    console.log(`\n${pass} passed, ${fail} failed\n`);
    await ui.close();
  }
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); console.log('\nSUITE ABORTED — an exception ended it early; the tally above is incomplete\n'); process.exit(1); });
