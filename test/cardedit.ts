/**
 * PLAIN VALUES TYPED IN ON A CANVAS CARD (CardValueEdit.vue; the owner, Nov 18 2026):
 * text, number, date and size rows, and the card's title.
 *
 *   E1  what is editable: text / number / date / size rows and a text title; long text,
 *       selects and the examined copy are not
 *   E2  the first click on a card selects it; the next click on a value types in it —
 *       the click itself goes to the CARD, as a browser sends it (the card captures the
 *       pointer), so only the release on the window can start it
 *   E3  Enter saves, one record.update, one Ctrl+Z; Esc writes nothing; a value the
 *       field refuses stays open; clearing a value unsets it
 *   E4  canvas keys are silent while typing; a press that travels drags and does not type
 *   E5  the title: typed in a wrapping box, Enter saves
 */
import { randomUUID } from 'node:crypto';
import { mountApp, sleep } from './uiHarness.js';

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

async function main() {
  const ui = await mountApp(Number(process.env.TEST_PORT ?? 8867));
  const { w, win, until, untilDb, post, nav, pool } = ui;
  try {
    const tDel = randomUUID(), tBoards = randomUUID(), sec = randomUUID(), board = randomUUID(), dA = randomUUID(), dB = randomUUID();
    const f = { name: randomUUID(), codec: randomUUID(), reels: randomUUID(), due: randomUUID(), size: randomUUID(), spec: randomUUID(), status: randomUUID(), bname: randomUUID() };
    const pos = (id: string, position: number) => ({ type: 'field.update', id, position });
    const field = (id: string, name: string, key: string, fieldType: string, position: number, options?: unknown) =>
      [{ type: 'field.create', id, tableId: tDel, name, key, fieldType, ...(options ? { options } : {}) }, pos(id, position)];
    const place = (recordId: string, x: number, y: number) => ({ type: 'placement.add', id: randomUUID(), canvasId: board, recordId, x, y, w: null, h: null, z: 1 });
    const setup = await post([
      { type: 'table.create', id: tDel, name: 'Deliverables' },
      { type: 'table.create', id: tBoards, name: 'Boards', kind: 'canvas' },
      { type: 'field.create', id: f.bname, tableId: tBoards, name: 'Name', key: 'name', fieldType: 'text' }, pos(f.bname, 0),
      ...field(f.name, 'Name', 'name', 'text', 0), ...field(f.codec, 'Codec', 'codec', 'text', 1), ...field(f.reels, 'Reels', 'reels', 'number', 2),
      ...field(f.due, 'Due', 'due', 'date', 3), ...field(f.size, 'Size', 'size', 'dimensions', 4),
      // A card shows its first five fields: the long text takes the place of none — it is a sixth, asked for below.
      ...field(f.spec, 'Spec', 'spec', 'long_text', 5), ...field(f.status, 'Status', 'status', 'select', 6, { choices: ['Pending', 'Sent'] }),
      { type: 'record.create', id: dA, tableId: tDel, data: { name: 'Texted ProRes', codec: 'ProRes 4444', reels: 5, due: '2026-12-01', size: '3840×2160', spec: 'line one\nline two', status: 'Pending' } },
      { type: 'record.create', id: dB, tableId: tDel, data: { name: 'DCP screener', codec: 'JPEG 2000' } },
      { type: 'record.create', id: board, tableId: tBoards, data: { name: 'Board' } },
      { type: 'canvas.update', id: board, config: { ownLook: true, cardFields: { [tDel]: [f.codec, f.reels, f.due, f.size, f.spec, f.status] } } },
      place(dA, 60, 60), place(dB, 500, 60),
      { type: 'section.create', id: sec, name: 'Post', icon: '🎬' },
      { type: 'section.update', id: sec, tableIds: [tDel, tBoards] },
    ]);
    check('fixture accepted', setup.status === 200, (await setup.text()).slice(0, 300));

    await nav.section(sec);
    await nav.openCanvas(board);
    const cardOf = (id: string) => w.findAll('.canvas-world .card').find((c: any) => c.attributes('data-record') === id);
    await until(() => !!cardOf(dA) && !!cardOf(dB), 8000);
    const row = (id: string, name: string) => cardOf(id)!.findAll('.card-field').find((r: any) => r.find('.card-key').text() === name)!;
    const val = (id: string, name: string) => row(id, name).find('.card-val');
    const db = async (id: string) => (await pool.query(`select data from records where id = $1`, [id])).rows[0].data;

    console.log('\nE1. What is editable');
    await until(() => !!row(dA, 'Status'), 4000);
    check('text, number, date and size rows are', ['Codec', 'Reels', 'Due', 'Size'].every((n) => val(dA, n).classes('cve')));
    check('long text and a select are not', !val(dA, 'Spec').classes('cve') && !val(dA, 'Status').classes('cve'));
    check('the title is', cardOf(dA)!.find('.card-label').classes('cve'));

    console.log('\nE2. Starting');
    const PE = (win as any).PointerEvent ?? (win as any).MouseEvent;
    // As a browser does it: the card captures the pointer at the press, so the click goes to the card.
    const press = async (id: string, el: any, to = { x: 520, y: 120 }) => {
      await el.trigger('pointerdown', { button: 0, clientX: 520, clientY: 120 });
      win.dispatchEvent(new PE('pointerup', { bubbles: true, button: 0, clientX: to.x, clientY: to.y }));
      await cardOf(id)!.trigger('click', { clientX: to.x, clientY: to.y });
    };
    const input = (id: string, name: string) => val(id, name).find('input');
    const type = async (el: any, text: string, key?: string) => { await el.setValue(text); if (key) await el.trigger('keydown', { key }); };
    await press(dA, val(dA, 'Codec'));
    check('the FIRST click on a card selects it — it does not type', await until(() => cardOf(dA)!.classes('selected')) && !val(dA, 'Codec').classes('live'));
    await press(dA, val(dA, 'Codec'));
    check('the next click on a value types in it: an input, in the row', await until(() => val(dA, 'Codec').classes('live') && input(dA, 'Codec').exists(), 3000));
    check('…holding the stored value', (input(dA, 'Codec').element as HTMLInputElement).value === 'ProRes 4444');

    console.log('\nE3. Saving');
    await type(input(dA, 'Codec'), 'ProRes 4444 XQ', 'Enter');
    check('Enter saves', (await untilDb(`select data->>'codec' as c from records where id = '${dA}'`, (r) => r[0].c === 'ProRes 4444 XQ', 4000)).length === 1);
    check('…and the row reads again, with the new value', await until(() => !val(dA, 'Codec').classes('live') && val(dA, 'Codec').text() === 'ProRes 4444 XQ', 3000));
    win.dispatchEvent(new (win as any).KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    check('one Ctrl+Z puts the old value back', (await untilDb(`select data->>'codec' as c from records where id = '${dA}'`, (r) => r[0].c === 'ProRes 4444', 4000)).length === 1);

    await press(dA, val(dA, 'Codec')); await until(() => input(dA, 'Codec').exists(), 3000);
    await type(input(dA, 'Codec'), 'never mind', 'Escape');
    await sleep(300);
    check('Esc writes nothing', !val(dA, 'Codec').classes('live') && (await db(dA)).codec === 'ProRes 4444');

    await press(dA, val(dA, 'Reels')); await until(() => input(dA, 'Reels').exists(), 3000);
    await type(input(dA, 'Reels'), 'six', 'Enter');
    await sleep(200);
    check('a number that is not one: refused, the editor stays open, nothing written', val(dA, 'Reels').classes('live') && input(dA, 'Reels').classes('invalid') && (await db(dA)).reels === 5);
    await type(input(dA, 'Reels'), '6', 'Enter');
    check('a number saves as a number', (await untilDb(`select data->'reels' as n from records where id = '${dA}'`, (r) => r[0].n === 6, 4000)).length === 1);

    await press(dA, val(dA, 'Size')); await until(() => input(dA, 'Size').exists(), 3000);
    await type(input(dA, 'Size'), '1920x1080', 'Enter');
    check('a size typed loosely is stored the one way', (await untilDb(`select data->>'size' as s from records where id = '${dA}'`, (r) => r[0].s === '1920×1080', 4000)).length === 1);

    await press(dA, val(dA, 'Due')); await until(() => input(dA, 'Due').exists(), 3000);
    await type(input(dA, 'Due'), '2026-12-15', 'Enter');
    check('a date saves', (await untilDb(`select data->>'due' as d from records where id = '${dA}'`, (r) => r[0].d === '2026-12-15', 4000)).length === 1);

    await press(dA, val(dA, 'Codec')); await until(() => input(dA, 'Codec').exists(), 3000);
    await type(input(dA, 'Codec'), '', 'Enter');
    check('clearing a value unsets it', (await untilDb(`select data ? 'codec' as has from records where id = '${dA}'`, (r) => r[0].has === false, 4000)).length === 1);

    console.log('\nE4. Keys and drags');
    await press(dA, val(dA, 'Reels')); await until(() => input(dA, 'Reels').exists(), 3000);
    await input(dA, 'Reels').trigger('keydown', { key: 'Delete' });
    await input(dA, 'Reels').trigger('keydown', { key: 'z' });
    await input(dA, 'Reels').trigger('keydown', { key: ' ', code: 'Space' });
    await sleep(200);
    check('canvas keys are silent while typing: Delete does not unplace', !!cardOf(dA) && (await pool.query(`select count(*)::int n from placements where canvas_id = $1`, [board])).rows[0].n === 2);
    await input(dA, 'Reels').trigger('keydown', { key: 'Escape' });
    await until(() => !val(dA, 'Reels').classes('live'), 2000);
    await press(dA, val(dA, 'Reels'), { x: 580, y: 150 });
    await sleep(200);
    check('a press that travels does not type', !val(dA, 'Reels').classes('live'));

    console.log('\nE5. The title');
    const label = () => cardOf(dA)!.find('.card-label');
    await press(dA, label());
    check('a click on the title of the selected card types in it, in a wrapping box', await until(() => label().classes('live') && label().find('textarea.block').exists(), 3000));
    await type(label().find('textarea'), 'Texted ProRes\nUHD', 'Enter');
    check('Enter saves — a line break in a title becomes a space', (await untilDb(`select data->>'name' as n from records where id = '${dA}'`, (r) => r[0].n === 'Texted ProRes UHD', 4000)).length === 1);
    check('…and the title reads again', await until(() => !label().classes('live') && /Texted ProRes UHD/.test(label().text().replace(/\s+/g, ' ')), 3000), label().text());

    await press(dB, val(dB, 'Codec'));
    check('another card: its first click only selects it', await until(() => cardOf(dB)!.classes('selected')) && !val(dB, 'Codec').classes('live'));
  } finally {
    console.log(`\n${pass} passed, ${fail} failed\n`);
    await ui.close();
  }
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); console.log('\nSUITE ABORTED — an exception ended it early; the tally above is incomplete\n'); process.exit(1); });
