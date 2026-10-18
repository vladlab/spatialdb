/**
 * Field sections (contract/fieldSections.ts, sql/017): a table's fields grouped
 * for the record tray.
 *
 *   F1  the pure rules — what is acceptable, how fields fall into groups, and the
 *       arrangement edits the schema editor makes
 *   F2  the server — `table.update { fieldSections }` stored, validated, read back;
 *       a field.delete leaves it alone and undoing the delete heals it
 *   F3  the schema editor in Table settings — bars among the fields: add, rename,
 *       starts folded, drag a field across a bar, drag a section, ↑ ↓, remove
 *   F4  the record tray — one well per group, fold rows, folding remembered, a
 *       folded section still says a comparison fails, Enter skips folded fields
 */
import { randomUUID } from 'node:crypto';
import { mountApp, sleep } from './uiHarness.js';
import {
  addSection, appendFields, arrangementOf, fieldFirst, fieldSectionsOf, fieldSectionsProblem, flatOrder, groupFields,
  moveSection, placeField, removeSection, sameSections, stepField, updateSection, type Arrangement,
} from '../src/contract/fieldSections.js';

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

function pure() {
  console.log('\nF1. The rules, without a server');
  const [a, b, c, d, e] = ['a', 'b', 'c', 'd', 'e'].map(() => randomUUID()) as [string, string, string, string, string];
  const s1 = randomUUID(), s2 = randomUUID();
  const sec = (id: string, name: string, fields: string[], folded = false) => ({ id, name, ...(folded ? { folded: true as const } : {}), fields });

  check('none, and a well-formed list, are acceptable', fieldSectionsProblem([]) === null && fieldSectionsProblem([sec(s1, 'Video', [a, b]), sec(s2, 'Audio', [], true)]) === null);
  check('not a list is refused', fieldSectionsProblem({}) !== null && fieldSectionsProblem('x') !== null);
  check('a section without a name is refused', fieldSectionsProblem([sec(s1, '', [a])]) !== null && fieldSectionsProblem([sec(s1, '   ', [a])]) !== null);
  check('an unknown key is refused (strict, like every contract object)', fieldSectionsProblem([{ ...sec(s1, 'Video', []), colour: 'red' }]) !== null);
  check('`folded: false` is not a thing — absent means open', fieldSectionsProblem([{ id: s1, name: 'Video', folded: false, fields: [] }]) !== null);
  check('two sections with one id are refused', /twice/.test(fieldSectionsProblem([sec(s1, 'Video', []), sec(s1, 'Audio', [])]) ?? ''));
  check('a field in two sections is refused', /only one section/.test(fieldSectionsProblem([sec(s1, 'Video', [a]), sec(s2, 'Audio', [a])]) ?? ''));
  check('…and so is a field twice in one', fieldSectionsProblem([sec(s1, 'Video', [a, a])]) !== null);
  check('a table with nothing (or something unreadable) has no sections', fieldSectionsOf(undefined).length === 0 && fieldSectionsOf({}).length === 0 && fieldSectionsOf({ field_sections: [{ nope: 1 }] }).length === 0);

  // In SCHEMA order — a, c, e first: nothing sectioned precedes them.
  const F = [a, c, e, d, b].map((id) => ({ id }));
  const ghost = randomUUID();
  const g = groupFields(F, [sec(s1, 'Video', [d, ghost, b]), sec(s2, 'Audio', [])]);
  check('groups: the unsectioned FIRST, in schema order', g[0]!.section === null && g[0]!.fields.map((f) => f.id).join() === [a, c, e].join());
  check('…then each section, its fields in ITS order — an id of no field skipped', g[1]!.section!.name === 'Video' && g[1]!.fields.map((f) => f.id).join() === [d, b].join());
  check('…an empty section is still a group (the editor shows it)', g.length === 3 && g[2]!.section!.name === 'Audio' && g[2]!.fields.length === 0);
  check('every field exactly once', g.flatMap((x) => x.fields).length === 5);
  // A field NO section lists goes with the field before it in the schema's order.
  const ids = (fs: Array<{ id: string }>) => fs.map((f) => f.id).join();
  let u = groupFields([a, d, c, b, e].map((id) => ({ id })), [sec(s1, 'Video', [d, b]), sec(s2, 'Audio', [])]);
  check('an unlisted field AFTER a sectioned one is drawn in that section, right after it — not above everything', ids(u[0]!.fields) === a && ids(u[1]!.fields) === [d, c, b, e].join() && u[2]!.fields.length === 0, `${ids(u[0]!.fields)} / ${ids(u[1]!.fields)}`);
  u = groupFields([d, a, b, c].map((id) => ({ id })), [sec(s1, 'Video', [d]), sec(s2, 'Audio', [b])]);
  check('…each run of unlisted fields following its own predecessor', u[0]!.fields.length === 0 && ids(u[1]!.fields) === [d, a].join() && ids(u[2]!.fields) === [b, c].join());
  u = groupFields([b, a, d].map((id) => ({ id })), [sec(s1, 'Video', [d, b])]);
  check('…a section\'s own order still rules its LISTED fields (d before b), the unlisted one after the field it follows', u[0]!.fields.length === 0 && ids(u[1]!.fields) === [d, b, a].join(), ids(u[1]!.fields));
  check('with no sections every field is unsectioned', ids(groupFields(F, [])[0]!.fields) === [a, c, e, d, b].join());

  const arr: Arrangement = arrangementOf([a, c, e, d, b], [sec(s1, 'Video', [d, ghost, b]), sec(s2, 'Audio', [], true)]);
  check('an arrangement lists only fields that exist', arr.top.join() === [a, c, e].join() && arr.sections[0]!.fields.join() === [d, b].join() && arr.sections[1]!.folded === true);
  check('…and every field a section holds only by position', arrangementOf([a, d, c, b], [sec(s1, 'Video', [d, b])]).sections[0]!.fields.join() === [d, c, b].join());
  check('its flat order is top, then section by section', flatOrder(arr).join() === [a, c, e, d, b].join());

  let x = placeField(arr, c, s1, b);
  check('place a field into a section before another', x.top.join() === [a, e].join() && x.sections[0]!.fields.join() === [d, c, b].join());
  x = placeField(arr, c, s2, null);
  check('…or at a section\'s end', x.sections[1]!.fields.join() === c);
  x = placeField(arr, d, null, a);
  check('…or out of every section', x.top.join() === [d, a, c, e].join() && x.sections[0]!.fields.join() === b);
  check('placing a field where it already is returns the SAME arrangement', placeField(arr, d, s1, b) === arr && placeField(arr, e, null, null) === arr);
  check('an unknown field or section changes nothing', placeField(arr, ghost, s1, null) === arr && placeField(arr, a, ghost, null) === arr);

  check('a step down inside a group swaps neighbours', stepField(arr, a, 1).top.join() === [c, a, e].join());
  x = stepField(arr, e, 1);
  check('a step down at the group\'s edge crosses the bar: first of the section below', x.top.join() === [a, c].join() && x.sections[0]!.fields.join() === [e, d, b].join());
  x = stepField(arr, d, -1);
  check('a step up at a section\'s top: last of the group above', x.top.join() === [a, c, e, d].join() && x.sections[0]!.fields.join() === b);
  x = stepField(arr, b, 1);
  check('a step down into an EMPTY section lands in it', x.sections[0]!.fields.join() === d && x.sections[1]!.fields.join() === b);
  check('the very first cannot go up, the very last cannot go down', stepField(arr, a, -1) === arr && stepField(x, b, 1) === x);

  x = fieldFirst(arr, b);
  check('"make primary": first of all — which is first of the unsectioned', flatOrder(x)[0] === b && x.top.join() === [b, a, c, e].join() && x.sections[0]!.fields.join() === d);
  check('new fields join the LAST section', appendFields(placeField(arr, e, null, null), [e]).sections[1]!.fields.join() === e);
  const tail = appendFields(arr, [a, c]);
  check('…and appending what is already its tail returns the SAME arrangement', appendFields(tail, [a, c]) === tail && tail.sections[1]!.fields.join() === [a, c].join());
  check('…or stay unsectioned when the table has no sections', appendFields({ top: [a, b], sections: [] }, [b]).top.join() === [a, b].join());

  const s3 = randomUUID();
  x = addSection(arr, { id: s3, name: 'Colour' });
  check('a new section is appended, empty', x.sections.length === 3 && x.sections[2]!.name === 'Colour' && x.sections[2]!.fields.length === 0);
  check('rename; "starts folded" on and OFF (off removes the key)', updateSection(arr, s1, { name: ' Picture ' }).sections[0]!.name === 'Picture'
    && updateSection(arr, s1, { folded: true }).sections[0]!.folded === true && !('folded' in updateSection(arr, s2, { folded: false }).sections[1]!));
  check('a blank rename keeps the name; no change returns the same arrangement', updateSection(arr, s1, { name: '  ' }) === arr && updateSection(arr, s2, { folded: true }) === arr);
  x = removeSection(placeField(arr, e, s2, null), s2);
  check('removing a section keeps its fields: they join the section above', x.sections.length === 1 && x.sections[0]!.fields.join() === [d, b, e].join());
  x = removeSection(arr, s1);
  check('…and the FIRST section\'s fields join the unsectioned', x.top.join() === [a, c, e, d, b].join() && x.sections.length === 1);
  x = moveSection(arr, s2, 0);
  check('a section moves whole', x.sections.map((s) => s.name).join() === 'Audio,Video' && x.sections[1]!.fields.join() === [d, b].join() && moveSection(arr, s1, 0) === arr);
  // Whatever is done to an arrangement, every field stays in it exactly once.
  let rnd = 7; const rand = (n: number) => { rnd = (rnd * 1103515245 + 12345) & 0x7fffffff; return rnd % n; };
  const all = [a, b, c, d, e], secIds = [s1, s2, s3];
  let cur: Arrangement = arr, broke = '';
  for (let i = 0; i < 3000 && !broke; i++) {
    const f = all[rand(5)]!, sid = secIds[rand(3)]!;
    const ops: Array<() => Arrangement> = [
      () => placeField(cur, f, rand(2) ? sid : null, rand(2) ? all[rand(5)]! : null), () => stepField(cur, f, rand(2) ? 1 : -1), () => fieldFirst(cur, f),
      () => appendFields(cur, [f, all[rand(5)]!]), () => addSection(cur, { id: sid, name: 'S' }), () => removeSection(cur, sid),
      () => moveSection(cur, sid, rand(4)), () => updateSection(cur, sid, { folded: !!rand(2) }),
    ];
    cur = ops[rand(ops.length)]!();
    if ([...flatOrder(cur)].sort().join() !== [...all].sort().join() || fieldSectionsProblem(cur.sections) !== null) broke = `step ${i}: ${JSON.stringify(cur)}`;
  }
  check('3,000 random edits: every field exactly once, and always something the server would accept', !broke, broke);
  check('key order is not a difference (jsonb re-sorts keys)', sameSections([{ id: s1, name: 'V', fields: [a], folded: true }], [{ fields: [a], folded: true, id: s1, name: 'V' } as never]));
}

async function main() {
  pure();
  const ui = await mountApp(Number(process.env.TEST_PORT ?? 8845));
  const { w, win, pool, API, until, untilDb, post } = ui;
  const { nav } = ui;
  try {
    const tFiles = randomUUID(), tSpecs = randomUUID();
    const fName = randomUUID(), fPath = randomUUID(), fCodec = randomUUID(), fWidth = randomUUID(), fChannels = randomUUID(), fHash = randomUUID(), fSpec = randomUUID();
    const fSName = randomUUID(), fSCodec = randomUUID();
    const recA = randomUUID(), recB = randomUUID(), spec = randomUUID();
    const pos = (id: string, position: number) => ({ type: 'field.update', id, position });
    const fld = (id: string, name: string, key: string, fieldType = 'text', options: Record<string, unknown> = {}) => ({ type: 'field.create', id, tableId: tFiles, name, key, fieldType, options });
    let r = await post([
      { type: 'table.create', id: tFiles, name: 'Files', singularName: 'File' }, { type: 'table.update', id: tFiles, position: 1 },
      { type: 'table.create', id: tSpecs, name: 'Specs', singularName: 'Spec' }, { type: 'table.update', id: tSpecs, position: 2 },
      { type: 'field.create', id: fSName, tableId: tSpecs, name: 'Name', key: 'name', fieldType: 'text' }, pos(fSName, 0),
      { type: 'field.create', id: fSCodec, tableId: tSpecs, name: 'Codec', key: 'codec', fieldType: 'text' }, pos(fSCodec, 1),
      fld(fName, 'Name', 'name'), pos(fName, 0), fld(fPath, 'Path', 'path'), pos(fPath, 1), fld(fCodec, 'Codec', 'codec'), pos(fCodec, 2),
      fld(fWidth, 'Width', 'width', 'number'), pos(fWidth, 3), fld(fChannels, 'Channels', 'channels', 'number'), pos(fChannels, 4), fld(fHash, 'Hash', 'hash'), pos(fHash, 5),
      fld(fSpec, 'Spec', 'spec', 'link', { target_table_id: tSpecs, compare: { pairs: [{ from: fCodec, to: fSCodec, rule: 'equals' }] } }), pos(fSpec, 6),
      { type: 'record.create', id: spec, tableId: tSpecs, data: { name: 'Network master', codec: 'ProRes 4444' } },
      { type: 'record.create', id: recA, tableId: tFiles, data: { name: 'a.mov', path: '/m/a.mov', codec: 'prores', width: 3840, channels: 6, hash: 'xx:1' } },
      { type: 'record.create', id: recB, tableId: tFiles, data: { name: 'b.mov', path: '/m/b.mov', codec: 'ProRes 4444', width: 1920, channels: 2, hash: 'xx:2' } },
      { type: 'link.add', id: randomUUID(), fieldId: fSpec, fromRecord: recA, toRecord: spec },
    ]);
    check('fixture accepted', r.status === 200, (await r.text()).slice(0, 300));

    const stored = async () => (await pool.query(`select field_sections from tables where id = $1`, [tFiles])).rows[0].field_sections as Array<{ id: string; name: string; folded?: true; fields: string[] }>;
    const order = async () => (await pool.query(`select key from fields where table_id = $1 order by position, name`, [tFiles])).rows.map((x: any) => x.key).join();
    const say = (s: Array<{ name: string; folded?: true; fields: string[] }>) => s.map((x) => `${x.name}${x.folded ? '*' : ''}[${x.fields.map((id) => KEY[id] ?? '?').join(' ')}]`).join(' ');
    const KEY: Record<string, string> = { [fName]: 'name', [fPath]: 'path', [fCodec]: 'codec', [fWidth]: 'width', [fChannels]: 'channels', [fHash]: 'hash', [fSpec]: 'spec' };

    /* ───────────────────────────────────────────────────────────────────── */
    console.log('\nF2. The server');
    const sVideo = randomUUID(), sAudio = randomUUID();
    check('a fresh table has NO sections — an empty list, not null', JSON.stringify(await stored()) === '[]');
    r = await post([{ type: 'table.update', id: tFiles, fieldSections: [{ id: sVideo, name: 'Video', fields: [fCodec, fWidth] }, { id: sAudio, name: 'Audio', folded: true, fields: [fChannels] }] }]);
    check('table.update { fieldSections } is stored', r.status === 200 && say(await stored()) === 'Video[codec width] Audio*[channels]', say(await stored()));
    const schema = await (await fetch(`${API}/api/schema`)).json() as Array<{ id: string; field_sections: unknown[] }>;
    check('GET /api/schema returns field_sections on each table', (schema.find((t) => t.id === tFiles)?.field_sections as any[])?.[1]?.folded === true && JSON.stringify(schema.find((t) => t.id === tSpecs)?.field_sections) === '[]');
    r = await post([{ type: 'table.update', id: tFiles, fieldSections: [{ id: sVideo, name: 'Video', fields: [fCodec] }, { id: sAudio, name: 'Audio', fields: [fCodec] }] }]);
    check('a field in two sections is refused (400), saying so', r.status === 400 && /only one section/.test(await r.text()));
    r = await post([{ type: 'table.update', id: tFiles, fieldSections: [{ id: sVideo, fields: [] }] }]);
    check('a malformed section is refused (400)', r.status === 400);
    r = await post([{ type: 'table.update', id: tFiles, name: 'Files' }]);
    check('a table.update WITHOUT fieldSections leaves them alone', r.status === 200 && say(await stored()) === 'Video[codec width] Audio*[channels]');
    const delWidth = randomUUID();
    r = await fetch(`${API}/api/mutate`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: randomUUID(), mutations: [{ id: delWidth, mutation: { type: 'field.delete', id: fWidth } }] }) });
    check('deleting a sectioned field does NOT rewrite the sections (its id simply resolves to nothing)', r.status === 200 && (await stored())[0]!.fields.join() === [fCodec, fWidth].join());
    const cap = await (await fetch(`${API}/api/mutations/${delWidth}/undo`)).json() as { rows: unknown };
    r = await post([{ type: 'restore', id: randomUUID(), undoOf: delWidth, rows: cap.rows }]);
    check('…so undoing the delete puts the field back in its section, nothing else written', r.status === 200 && say(await stored()) === 'Video[codec width] Audio*[channels]'
      && (await pool.query(`select 1 from fields where id = $1`, [fWidth])).rowCount === 1);
    r = await post([{ type: 'table.update', id: tFiles, fieldSections: [] }]);
    check('an empty list removes every section', r.status === 200 && JSON.stringify(await stored()) === '[]');

    /* ───────────────────────────────────────────────────────────────────── */
    console.log('\nF3. The schema editor: bars among the fields');
    win.location.hash = `#/all/table/${tFiles}`; win.dispatchEvent(new (win as any).HashChangeEvent('hashchange'));
    await until(() => w.findAll('.tree .table-row').length === 2 && w.findAll('.gridview tr.row').length === 2, 8000);
    await nav.tableSettings(tFiles);
    await until(() => w.find('.ts').exists());
    /** The list as the editor shows it: "## Bar" for a section, a leading space for a field inside one. */
    const list = () => w.findAll('.ts .field-list [data-row]').map((x: any) => (x.classes('sitem') ? `## ${x.find('.sname').text()}` : `${x.classes('in') ? ' ' : ''}${x.find('.fname').text()}`)).join('|');
    const bar = (name: string) => w.findAll('.ts .sitem').find((x: any) => x.find('.sname').text() === name)!;
    const item = (name: string) => w.findAll('.ts .fitem').find((x: any) => x.find('.fname').text() === name)!;
    check('no sections: the plain list, and a "+ add section"', list() === 'Name|Path|Codec|Width|Channels|Hash|Spec' && !w.find('.ts .sitem').exists() && w.find('.ts .add-section').exists(), list());

    await w.find('.ts .add-section').trigger('click');
    check('+ add section: a bar at the END, its settings open on the name', await until(() => w.findAll('.ts .sitem').length === 1 && w.find('.ts .sitem .sopen input.name').exists())
      && (w.find('.ts .sitem .sopen input.name').element as HTMLInputElement).value === 'New section' && /\|## New section$/.test(list()), list());
    check('an empty section says so', w.find('.ts .sempty').exists() && /0 fields/.test(bar('New section').find('.fsum').text()));
    await w.find('.ts .sitem .sopen input.name').setValue('Video');
    await w.find('.ts .sitem .sopen input.name').trigger('change');
    let st = await untilDb(`select field_sections s from tables where id = '${tFiles}'`, (x) => x[0].s[0]?.name === 'Video');
    check('renamed in place — written as the table\'s fieldSections', st[0].s.length === 1 && st[0].s[0].fields.length === 0 && await until(() => /## Video$/.test(list())), JSON.stringify(st[0].s));
    const videoId = st[0].s[0].id as string;

    const form = () => w.find('.ts .fadd');
    await form().find('select.type').setValue('number');
    await form().find('input.name').setValue('Height');
    await form().find('input.name').trigger('keydown', { key: 'Enter' });
    st = await untilDb(`select field_sections s from tables where id = '${tFiles}'`, (x) => x[0].s[0]?.fields.length === 1);
    const fHeight = st[0].s[0].fields[0] as string; KEY[fHeight] = 'height';
    check('a NEW field joins the last section — and is last in the field order', say(st[0].s) === 'Video[height]' && await order() === 'name,path,codec,width,channels,hash,spec,height' && await until(() => /## Video\| Height$/.test(list())), `${say(st[0].s)} / ${await order()} / ${list()}`);

    await form().find('select.type').setValue('text');
    await form().find('input.name').setValue('Oops');
    await form().find('input.name').trigger('keydown', { key: 'Enter' });
    st = await untilDb(`select field_sections s from tables where id = '${tFiles}'`, (x) => x[0].s[0]?.fields.length === 2);
    check('(a second one joins it too)', st[0].s[0].fields.length === 2 && await until(() => / Height\| Oops$/.test(list())), list());
    win.dispatchEvent(new (win as any).KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    st = await untilDb(`select field_sections s from tables where id = '${tFiles}'`, (x) => x[0].s[0]?.fields.length === 1);
    check('Ctrl+Z on an add takes the field AND its place in the section back', say(st[0].s) === 'Video[height]'
      && (await untilDb(`select count(*)::int n from fields where table_id = '${tFiles}'`, (x) => x[0].n === 8))[0].n === 8 && await until(() => /## Video\| Height$/.test(list())), `${say(st[0].s)} / ${list()}`);

    // Drag. happy-dom has no layout: give each row a rect, 30px apiece from y = 100.
    const PE = (win as any).PointerEvent ?? (win as any).MouseEvent;
    const winEv = (type: string, init: Record<string, unknown>) => win.dispatchEvent(new PE(type, { bubbles: true, ...init }));
    const lay = () => ([...(win.document.querySelectorAll('.ts .field-list [data-row]') as any)] as HTMLElement[]).forEach((el, i) => {
      el.getBoundingClientRect = () => ({ top: 100 + i * 30, bottom: 130 + i * 30, height: 30, left: 0, right: 500, width: 500, x: 0, y: 100 + i * 30, toJSON() {} }) as DOMRect; });
    const yOf = (key: string) => { const i = w.findAll('.ts .field-list [data-row]').findIndex((x: any) => x.attributes('data-row') === key); return 115 + i * 30; };
    const hold = async (grip: any, fromY: number, toY: number) => { await grip.trigger('pointerdown', { button: 0, clientY: fromY }); winEv('pointermove', { clientY: toY }); await sleep(30); };
    const undo = () => win.dispatchEvent(new (win as any).KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));

    lay();
    // Codec, to just under the Video bar (above Height's middle).
    await hold(item('Codec').find('.grip'), yOf(`f:${fCodec}`), yOf(`s:${videoId}`) + 20);
    check('held under the bar: the list shows Codec in Video, first', await until(() => list() === 'Name|Path|Width|Channels|Hash|Spec|## Video| Codec| Height'), list());
    check('nothing written yet', say(await stored()) === 'Video[height]' && await order() === 'name,path,codec,width,channels,hash,spec,height');
    winEv('pointerup', {});
    st = await untilDb(`select field_sections s from tables where id = '${tFiles}'`, (x) => x[0].s[0]?.fields.length === 2);
    check('released: Codec is in the section', say(st[0].s) === 'Video[codec height]', say(st[0].s));
    check('…and the field ORDER is the list\'s order (so a never-arranged grid reads the same way)', (await untilDb(`select key from fields where table_id = '${tFiles}' order by position, name`, (x) => x.map((y: any) => y.key).join() === 'name,path,width,channels,hash,spec,codec,height')).map((y: any) => y.key).join() === 'name,path,width,channels,hash,spec,codec,height', await order());
    undo();
    st = await untilDb(`select field_sections s from tables where id = '${tFiles}'`, (x) => x[0].s[0]?.fields.length === 1);
    check('one Ctrl+Z puts BOTH back — the section and the order', say(st[0].s) === 'Video[height]' && (await untilDb(`select key from fields where table_id = '${tFiles}' order by position, name`, (x) => x.map((y: any) => y.key).join() === 'name,path,codec,width,channels,hash,spec,height')).length === 8 && await order() === 'name,path,codec,width,channels,hash,spec,height', `${say(st[0].s)} / ${await order()}`);

    // ↑ ↓ cross a bar.
    await until(() => list() === 'Name|Path|Codec|Width|Channels|Hash|Spec|## Video| Height');
    check('↑ is off on the very first field, ↓ on the very last', (item('Name').find('.mv.prev').element as HTMLButtonElement).disabled && (item('Height').find('.mv.next').element as HTMLButtonElement).disabled
      && !(item('Height').find('.mv.prev').element as HTMLButtonElement).disabled);
    await item('Spec').find('.mv.next').trigger('click');
    st = await untilDb(`select field_sections s from tables where id = '${tFiles}'`, (x) => x[0].s[0]?.fields.length === 2);
    check('↓ on the last unsectioned field takes it over the bar: first in the section', say(st[0].s) === 'Video[spec height]' && await until(() => list() === 'Name|Path|Codec|Width|Channels|Hash|## Video| Spec| Height'), `${say(st[0].s)} / ${list()}`);
    await item('Spec').find('.mv.prev').trigger('click');
    st = await untilDb(`select field_sections s from tables where id = '${tFiles}'`, (x) => x[0].s[0]?.fields.length === 1);
    check('↑ on a section\'s first field takes it back out', say(st[0].s) === 'Video[height]' && await until(() => list() === 'Name|Path|Codec|Width|Channels|Hash|Spec|## Video| Height'));

    // A second section, filled by a peer's write (the stream) — then dragged whole.
    const audioId = randomUUID();
    // (As a well-behaved script does it: the positions in the order the sections imply.)
    r = await post([...[fName, fPath, fHash, fSpec, fCodec, fWidth, fHeight, fChannels].map((id, i) => pos(id, i)),
      { type: 'table.update', id: tFiles, fieldSections: [{ id: videoId, name: 'Video', fields: [fCodec, fWidth, fHeight] }, { id: audioId, name: 'Audio', fields: [fChannels] }] }]);
    check('a peer\'s sections arrive: the list regroups', r.status === 200 && await until(() => list() === 'Name|Path|Hash|Spec|## Video| Codec| Width| Height|## Audio| Channels', 8000), list());
    lay();
    await hold(bar('Audio').find('.grip'), yOf(`s:${audioId}`), yOf(`s:${videoId}`) + 5);
    check('a bar held above another section: the whole section moves, its fields with it', await until(() => list() === 'Name|Path|Hash|Spec|## Audio| Channels|## Video| Codec| Width| Height'), list());
    check('…both of its rows lifted', bar('Audio').classes('lifted') && item('Channels').classes('lifted') && !item('Codec').classes('lifted'));
    winEv('pointerup', {});
    st = await untilDb(`select field_sections s from tables where id = '${tFiles}'`, (x) => x[0].s[0]?.name === 'Audio');
    check('released: the sections are in the new order, and the field order follows', say(st[0].s) === 'Audio[channels] Video[codec width height]'
      && (await untilDb(`select key from fields where table_id = '${tFiles}' order by position, name`, (x) => x.map((y: any) => y.key).join() === 'name,path,hash,spec,channels,codec,width,height')).length === 8 && await order() === 'name,path,hash,spec,channels,codec,width,height', `${say(st[0].s)} / ${await order()}`);
    check('a bar\'s own ↑ ↓: the first cannot go up, the last cannot go down', (bar('Audio').find('.mv.prev').element as HTMLButtonElement).disabled && (bar('Video').find('.mv.next').element as HTMLButtonElement).disabled);
    await bar('Video').find('.mv.prev').trigger('click');
    st = await untilDb(`select field_sections s from tables where id = '${tFiles}'`, (x) => x[0].s[0]?.name === 'Video');
    check('↑ on a bar moves the section', say(st[0].s) === 'Video[codec width height] Audio[channels]', say(st[0].s));

    // A drag that ends where it began; an edit that is not about order.
    const logged = async () => (await pool.query(`select count(*)::int n from mutations`)).rows[0].n as number;
    await sleep(400);
    let before = await logged();
    lay();
    await hold(item('Width').find('.grip'), yOf(`f:${fWidth}`), yOf(`s:${audioId}`) + 14);
    await until(() => / Channels\| Width$/.test(list()));
    winEv('pointermove', { clientY: yOf(`f:${fHeight}`) - 14 });
    await until(() => list() === 'Name|Path|Hash|Spec|## Video| Codec| Width| Height|## Audio| Channels');
    winEv('pointerup', {});
    await sleep(500);
    check('a field dragged away and BACK writes nothing', await logged() === before && list() === 'Name|Path|Hash|Spec|## Video| Codec| Width| Height|## Audio| Channels', `${await logged() - before} mutation(s); ${list()}`);

    // A field made WITHOUT the editor: last position, listed nowhere.
    const fRaw = randomUUID(); KEY[fRaw] = 'checksum';
    r = await post([fld(fRaw, 'Checksum', 'checksum')]);
    check('a field made by a script (last position, no section) is drawn where its position is: the END of the last section', r.status === 200
      && await until(() => list() === 'Name|Path|Hash|Spec|## Video| Codec| Width| Height|## Audio| Channels| Checksum', 8000) && say(await stored()) === 'Video[codec width height] Audio[channels]', `${list()} / ${say(await stored())}`);
    check('…the ★ stays on Name, and nothing warns', item('Name').find('.star').classes('on') && !w.find('.ts .primary-warning').exists());
    await sleep(300);
    before = await logged();
    await bar('Video').find('.gear').trigger('click');
    await until(() => bar('Video').find('.sopen input.name').exists());
    await bar('Video').find('.sopen input.name').setValue('   ');
    check('a blank rename is no rename: the box goes back to the name', (bar('Video').find('.sopen input.name').element as HTMLInputElement).value === 'Video');
    await bar('Video').find('.sopen input.name').setValue('Picture');   // (setValue fires `change` itself)
    st = await untilDb(`select field_sections s from tables where id = '${tFiles}'`, (x) => x[0].s[0]?.name === 'Picture');
    await sleep(400);
    const wrote = (await pool.query(`select type from mutations order by seq desc limit ${Math.max(0, await logged() - before)}`)).rows.map((x: any) => x.type).join();
    check('renaming a section is ONE table.update — it does not renumber the fields', wrote === 'table.update', wrote);
    check('…and, being an edit, it lists the field the section held only by position', say(st[0].s) === 'Picture[codec width height] Audio[channels checksum]', say(st[0].s));
    await bar('Picture').find('.sopen input.name').setValue('Video');
    await untilDb(`select field_sections s from tables where id = '${tFiles}'`, (x) => x[0].s[0]?.name === 'Video');
    await bar('Video').find('.gear').trigger('click');
    r = await post([{ type: 'field.delete', id: fRaw }]);
    await until(() => list() === 'Name|Path|Hash|Spec|## Video| Codec| Width| Height|## Audio| Channels', 8000);
    await untilDb(`select field_sections s from tables where id = '${tFiles}'`, (x) => x[0].s[1]?.fields.length === 2);

    // Sections written by a script whose lists DISAGREE with the positions about which field is first.
    r = await post([{ type: 'table.update', id: tFiles, fieldSections: [{ id: videoId, name: 'Video', fields: [fCodec, fWidth, fHeight, fName] }, { id: audioId, name: 'Audio', fields: [fChannels] }] }]);
    check('lists and positions that disagree about the primary: the ★ stays on the field that IS primary, and the editor says what the next reorder would do',
      r.status === 200 && await until(() => w.find('.ts .primary-warning').exists(), 8000) && /“Codec”/.test(w.find('.ts .primary-warning').text()) && item('Name').find('.star').classes('on') && item('Name').classes('in'), w.find('.ts .primary-warning').exists() ? w.find('.ts .primary-warning').text() : list());
    await sleep(300);
    before = await logged();
    await bar('Audio').find('.gear').trigger('click');
    await until(() => bar('Audio').find('.sopen .starts-folded').exists());
    await bar('Audio').find('.sopen .starts-folded').setValue(true);
    await untilDb(`select field_sections s from tables where id = '${tFiles}'`, (x) => x[0].s[1]?.folded === true);
    await sleep(400);
    check('…and an edit that is not about order leaves the primary alone', (await pool.query(`select key from fields where table_id = $1 order by position, name limit 1`, [tFiles])).rows[0].key === 'name' && await logged() - before === 1, `${await logged() - before} mutation(s)`);
    await bar('Audio').find('.sopen .starts-folded').setValue(false);
    await untilDb(`select field_sections s from tables where id = '${tFiles}'`, (x) => x[0].s[1]?.folded === undefined);
    await bar('Audio').find('.gear').trigger('click');
    r = await post([{ type: 'table.update', id: tFiles, fieldSections: [{ id: videoId, name: 'Video', fields: [fCodec, fWidth, fHeight] }, { id: audioId, name: 'Audio', fields: [fChannels] }] }]);
    check('(put right again: no warning)', r.status === 200 && await until(() => !w.find('.ts .primary-warning').exists() && list() === 'Name|Path|Hash|Spec|## Video| Codec| Width| Height|## Audio| Channels', 8000), list());

    // Starts folded; folding here; dropping under a folded bar.
    await bar('Audio').find('.gear').trigger('click');
    await until(() => bar('Audio').find('.sopen .starts-folded').exists());
    await bar('Audio').find('.sopen .starts-folded').setValue(true);
    st = await untilDb(`select field_sections s from tables where id = '${tFiles}'`, (x) => x[0].s[1]?.folded === true);
    check('"starts folded" is the section\'s `folded` — and the bar says so', say(st[0].s) === 'Video[codec width height] Audio*[channels]' && await until(() => /starts folded/.test(bar('Audio').find('.fsum').text())));
    check('…ticking it did not fold the bar HERE', list() === 'Name|Path|Hash|Spec|## Video| Codec| Width| Height|## Audio| Channels', list());
    await bar('Audio').find('.gear').trigger('click');
    await bar('Audio').find('.fold').trigger('click');
    check('▾ folds a section in this dialog: its fields leave the list, the count stays', await until(() => list() === 'Name|Path|Hash|Spec|## Video| Codec| Width| Height|## Audio') && /1 field\b/.test(bar('Audio').find('.fsum').text()), list());
    check('…which wrote nothing', say(await stored()) === 'Video[codec width height] Audio*[channels]');
    lay();
    await hold(item('Hash').find('.grip'), yOf(`f:${fHash}`), yOf(`s:${audioId}`) + 14);
    winEv('pointerup', {});
    st = await untilDb(`select field_sections s from tables where id = '${tFiles}'`, (x) => x[0].s[1]?.fields.length === 2);
    check('a field dropped under a FOLDED bar lands at that section\'s end', say(st[0].s) === 'Video[codec width height] Audio*[channels hash]' && /2 fields/.test(bar('Audio').find('.fsum').text()), say(st[0].s));
    await bar('Audio').find('.fold').trigger('click');
    await until(() => / Hash$/.test(list()));

    // "make primary" on a sectioned field.
    await item('Codec').find('.gear').trigger('click');
    await until(() => item('Codec').find('.fopen .make-primary').exists());
    await item('Codec').find('.fopen .make-primary').trigger('click');
    st = await untilDb(`select field_sections s from tables where id = '${tFiles}'`, (x) => x[0].s[0]?.fields.length === 2);
    check('"make primary" on a field in a section: it leaves the section and is first of all', say(st[0].s) === 'Video[width height] Audio*[channels hash]'
      && (await untilDb(`select key from fields where table_id = '${tFiles}' order by position, name`, (x) => x[0]?.key === 'codec')).map((y: any) => y.key).join() === 'codec,name,path,spec,width,height,channels,hash'
      && await until(() => item('Codec').find('.star').classes('on') && !item('Codec').classes('in')), `${say(st[0].s)} / ${await order()}`);
    undo();
    await untilDb(`select field_sections s from tables where id = '${tFiles}'`, (x) => x[0].s[0]?.fields.length === 3);
    check('…and Ctrl+Z gives the name back to Name', await until(() => item('Name').find('.star').classes('on')) && say(await stored()) === 'Video[codec width height] Audio*[channels hash]');

    // Remove.
    await bar('Audio').find('.gear').trigger('click');
    await until(() => bar('Audio').find('.sopen .remove-section').exists());
    await bar('Audio').find('.sopen .remove-section').trigger('click');
    st = await untilDb(`select field_sections s from tables where id = '${tFiles}'`, (x) => x[0].s.length === 1);
    check('remove section: the bar goes, its fields join the section above — no field is deleted', say(st[0].s) === 'Video[codec width height channels hash]'
      && (await pool.query(`select count(*)::int n from fields where table_id = $1`, [tFiles])).rows[0].n === 8 && await until(() => list() === 'Name|Path|Spec|## Video| Codec| Width| Height| Channels| Hash'), `${say(st[0].s)} / ${list()}`);
    await bar('Video').find('.gear').trigger('click');
    await until(() => bar('Video').find('.sopen .remove-section').exists());
    await bar('Video').find('.sopen .remove-section').trigger('click');
    st = await untilDb(`select field_sections s from tables where id = '${tFiles}'`, (x) => x[0].s.length === 0);
    check('removing the first section: its fields are unsectioned again, in the order shown', st[0].s.length === 0 && await until(() => list() === 'Name|Path|Spec|Codec|Width|Height|Channels|Hash') && await order() === 'name,path,spec,codec,width,height,channels,hash', `${list()} / ${await order()}`);
    await w.find('.ts .x').trigger('click');
    await sleep(100);

    /* ───────────────────────────────────────────────────────────────────── */
    console.log('\nF4. The record tray: a well per group');
    const tray = () => w.find('.record-panel');
    const rowNamed = (name: string) => w.findAll('.gridview tr.row').find((x: any) => x.findAll('td')[1].text() === name)!;
    const open = async (name: string) => { await rowNamed(name).find('.expand').trigger('click'); await until(() => tray().exists() && tray().find('.rp-title').text() === name); };
    const labels = () => tray().findAll('.rp-name').map((n: any) => n.text().replace(/[★⚠✓]/g, '').trim()).join();
    const secs = () => tray().findAll('.rp-sec').map((s: any) => `${s.find('.tw').text()}${s.find('.rp-sec-name').text()}`).join();
    const sec = (name: string) => tray().findAll('.rp-sec').find((s: any) => s.find('.rp-sec-name').text() === name)!;
    const pField = (label: string) => tray().findAll('.rp-field').find((f: any) => f.find('.rp-name').text().replace(/[★⚠✓]/g, '').trim() === label)!;
    const pEditor = () => tray().find('.rp-field.editing input, .rp-field.editing textarea, .rp-field.editing select');

    await open('a.mov');
    check('a table with NO sections is one well, no fold rows — as it always was', tray().findAll('.rp-well.rp-fields').length === 1 && !tray().find('.rp-sec').exists()
      && labels() === 'Name,Path,Spec,Codec,Width,Height,Channels,Hash,Created,Created by', labels());

    const tVideo = randomUUID(), tAudio = randomUUID(), tEmpty = randomUUID();
    r = await post([{ type: 'table.update', id: tFiles, fieldSections: [
      { id: tVideo, name: 'Video', fields: [fWidth, fCodec, fHeight] }, { id: tEmpty, name: 'Nothing yet', fields: [] }, { id: tAudio, name: 'Audio', folded: true, fields: [fChannels, fHash] }] }]);
    check('with sections: a fold row each (not for the empty one), and "Created" last', r.status === 200 && await until(() => secs() === '▾Video,▸Audio,▾Created', 8000), secs());
    check('the unsectioned fields come first, in a well with no header; then each OPEN section\'s, in the section\'s own order',
      labels() === 'Name,Path,Spec,Width,Codec,Height,Created,Created by' && tray().findAll('.rp-well.rp-fields').length === 3, labels());
    check('a section that starts folded shows its row and none of its fields', !pField('Channels') && sec('Audio').attributes('aria-expanded') === 'false' && sec('Audio').find('.rp-sec-count').text() === '2');
    check('the Video row counts the comparison that fails inside it (Codec ≠ the spec\'s)', sec('Video').find('.rp-sec-warn').exists() && /⚠ 1/.test(sec('Video').find('.rp-sec-warn').text()) && !sec('Audio').find('.rp-sec-warn').exists(), sec('Video').text());

    await sec('Audio').trigger('click');
    check('a click unfolds it', await until(() => !!pField('Channels') && secs() === '▾Video,▾Audio,▾Created') && labels() === 'Name,Path,Spec,Width,Codec,Height,Channels,Hash,Created,Created by', labels());
    await sec('Video').trigger('click');
    check('folding Video hides its fields — and its row STILL says ⚠ 1', await until(() => !pField('Codec') && secs() === '▸Video,▾Audio,▾Created') && /⚠ 1/.test(sec('Video').find('.rp-sec-warn').text()));
    check('folding wrote nothing to the schema', say(await stored()) === 'Video[width codec height] Nothing yet[] Audio*[channels hash]');

    await open('b.mov');
    check('the folding is remembered from record to record', secs() === '▸Video,▾Audio,▾Created' && !pField('Codec') && !!pField('Channels'), secs());
    check('…and this record, whose codec matches nothing-in-particular, shows no warning', !sec('Video').find('.rp-sec-warn').exists());
    let remembered = '';
    try { remembered = (globalThis as any).localStorage?.getItem('spatialdb.tray.folds') ?? ''; } catch { /* no storage in this runtime */ }
    if (remembered) {
      const m = JSON.parse(remembered) as Record<string, boolean>;
      check('only choices that DIFFER from the schema\'s start are kept (Video folded, Audio unfolded)', m[tVideo] === true && m[tAudio] === false && Object.keys(m).length === 2, remembered);
      await sec('Audio').trigger('click');
      await until(() => secs() === '▸Video,▸Audio,▾Created');
      const m2 = JSON.parse((globalThis as any).localStorage.getItem('spatialdb.tray.folds')) as Record<string, boolean>;
      check('…folding Audio back to how it starts forgets it', !(tAudio in m2) && m2[tVideo] === true, JSON.stringify(m2));
      await sec('Audio').trigger('click');
      await until(() => secs() === '▸Video,▾Audio,▾Created');
    } else console.log('  (no localStorage in this runtime: the per-browser half is not checked)');

    // Enter walks the fields ON SCREEN: from Spec's neighbour Path, over folded Video, to Audio.
    r = await post([{ type: 'table.update', id: tFiles, fieldSections: [
      { id: tVideo, name: 'Video', fields: [fWidth, fCodec, fHeight, fSpec] }, { id: tAudio, name: 'Audio', folded: true, fields: [fChannels, fHash] }] }]);
    await until(() => labels() === 'Name,Path,Channels,Hash,Created,Created by', 8000);
    await pField('Path').find('.rp-value').trigger('click');
    await until(() => pEditor().exists());
    await pEditor().setValue('/m/b2.mov');
    await pEditor().trigger('keydown', { key: 'Enter' });
    check('Enter commits and goes to the next field ON SCREEN — over the folded section', await until(() => !!pField('Channels') && pField('Channels').classes('editing')), tray().findAll('.rp-field.editing').map((f: any) => f.find('.rp-name').text()).join());
    await sec('Audio').trigger('click');
    check('folding the section you are editing in closes the editor with it', await until(() => !tray().find('.rp-field.editing').exists() && secs() === '▸Video,▸Audio,▾Created'));
    check('the value typed before the Enter reached the server', (await untilDb(`select data from records where id = '${recB}'`, (x) => x[0].data.path === '/m/b2.mov'))[0].data.path === '/m/b2.mov');
    await sec('Created').trigger('click');
    check('"Created" folds like any section', await until(() => secs() === '▸Video,▸Audio,▸Created' && labels() === 'Name,Path'), labels());
    await tray().find('.rp-close').trigger('click');

    /* ───────────────────────────────────────────────────────────────────── */
    console.log('\nF5. The record tray: rows, and block fields that fold');
    const fNotes = randomUUID();
    await post([{ type: 'table.update', id: tFiles, fieldSections: [] }, { type: 'field.create', id: fNotes, tableId: tFiles, name: 'Notes', key: 'notes', fieldType: 'long_text', options: {} }, pos(fNotes, 7),
      { type: 'record.update', id: recB, set: { notes: 'first line\nsecond line' }, unset: [] }]);
    await open('b.mov');
    await until(() => !!pField('Notes'));
    check('a short field is a ROW (label cell | value cell), with no fold chip', pField('Path').classes('row') && !pField('Path').find('.fold-chip').exists());
    check('a long text is a BLOCK: a fold chip on its label, and its one-line SUMMARY — the first line, as the card prints it — in the row', pField('Notes').classes('block') && pField('Notes').find('.fold-chip').exists()
      && pField('Notes').find('.rp-value.summary .text').text() === 'first line', pField('Notes').html());
    check('a block starts UNFOLDED: its editor hangs under the row', !pField('Notes').classes('folded') && pField('Notes').find('.rp-under').exists());
    check('every label cell is one width: --label-w is set on the body', /--label-w:\s*\d+px/.test(tray().find('.rp-body').attributes('style') ?? ''), tray().find('.rp-body').attributes('style'));
    await pField('Notes').find('.fold-chip').trigger('click');
    check('the chip folds it: the row stays, the editor goes', await until(() => pField('Notes').classes('folded') && !pField('Notes').find('.rp-under').exists() && pField('Notes').find('.rp-value.summary .text').text() === 'first line'));
    await pField('Path').find('.rp-value').trigger('click');
    await until(() => pEditor().exists());
    await pEditor().trigger('keydown', { key: 'Tab' });
    check('Tab moves to the next field — Spec, in this table\'s order — not into a folded block\'s editor', await until(() => pField('Spec').classes('editing')), tray().findAll('.rp-field.editing').map((f: any) => f.find('.rp-name').text()).join());
    for (let i = 0; i < 5 && pEditor().exists(); i++) await pEditor().trigger('keydown', { key: 'Tab' });   // Width, Channels, Hash, Spec… through to the end
    check('…walked to the end, Notes (folded) was never entered', !pField('Notes').classes('editing'));
    if (pEditor().exists()) await pEditor().trigger('keydown', { key: 'Escape' });
    await open('a.mov');
    check('the fold is per FIELD, not per record: on the next file it is still folded', await until(() => pField('Notes').classes('folded')));
    let rememberedF = '';
    try { rememberedF = (globalThis as any).localStorage?.getItem('spatialdb.tray.fieldFolds') ?? ''; } catch { /* no storage in this runtime */ }
    if (rememberedF) {
      const m = JSON.parse(rememberedF) as Record<string, true>;
      const k = Object.keys(m);
      check('…and remembered in this browser, keyed by the VIEW behind the tray (table:<id>) and the field', k.length === 1 && k[0] === `table:${tFiles}:${fNotes}` && m[k[0]] === true, rememberedF);
    } else console.log('  (no localStorage in this runtime: the per-browser half is not checked)');
    await pField('Notes').find('.rp-value.summary').trigger('click');
    check('a click on the summary of a FOLDED block unfolds it (the chip is not the only way back)', await until(() => !pField('Notes').classes('folded') && pField('Notes').find('.rp-under').exists()));
    await pField('Notes').find('.rp-value.summary').trigger('click');
    check('…and on an OPEN block it edits, as a click on any row\'s value does', await until(() => pField('Notes').classes('editing') && pEditor().element.tagName === 'TEXTAREA'));
    await pEditor().trigger('keydown', { key: 'Escape' });
    try { check('unfolding forgets the entry — only folds are stored', !((globalThis as any).localStorage?.getItem('spatialdb.tray.fieldFolds') ?? '').includes(fNotes)); } catch { /* no storage */ }
    await tray().find('.rp-close').trigger('click');
  } finally {
    console.log(`\n${pass} passed, ${fail} failed\n`);
    await ui.close();
  }
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); console.log('\nSUITE ABORTED — an exception ended it early; the tally above is incomplete\n'); process.exit(1); });
