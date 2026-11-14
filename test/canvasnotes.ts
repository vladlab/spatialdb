/**
 * CANVAS NOTES (CANVAS-BRIEF.md D): a rich_text field with `canvasNote`, typed right on
 * the card.
 *
 *   N1  the server: lists and checkboxes yes; headings, images, code no; 64 KB at most
 *   N2  toggleTask, pure
 *   N3  on the card: shown even empty ("Type a note…"); a checkbox click is one
 *       mutation and one Ctrl+Z, with no editing
 *   N4  typing: the first click on a card selects it, the next types; it saves as you
 *       type; Esc ends it; ONE Ctrl+Z puts back the note as it was before the session;
 *       canvas keys are silent while typing; a colleague's save is not pasted under you
 *   N5  the tray: the same note, saving as you type there too
 */
import { randomUUID } from 'node:crypto';
import { mountApp, sleep } from './uiHarness.js';
import { toggleTask } from '../src/contract/richtext.js';

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}
const doc = (...content: unknown[]) => ({ type: 'doc', content });
const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const task = (text: string, checked = false) => ({ type: 'taskItem', attrs: { checked }, content: [p(text)] });

async function main() {
  const ui = await mountApp(Number(process.env.TEST_PORT ?? 8866));
  const { w, win, until, untilDb, post, nav, pool } = ui;
  try {
    const tDel = randomUUID(), tBoards = randomUUID(), sec = randomUUID();
    const fName = randomUUID(), fNotes = randomUUID(), fBName = randomUUID();
    const board = randomUUID(), dA = randomUUID(), dB = randomUUID();
    const pos = (id: string, position: number) => ({ type: 'field.update', id, position });
    const place = (recordId: string, x: number, y: number) => ({ type: 'placement.add', id: randomUUID(), canvasId: board, recordId, x, y, w: null, h: null, z: 1 });
    const setup = await post([
      { type: 'table.create', id: tDel, name: 'Deliverables' },
      { type: 'table.create', id: tBoards, name: 'Boards', kind: 'canvas' },
      { type: 'field.create', id: fBName, tableId: tBoards, name: 'Name', key: 'name', fieldType: 'text' }, pos(fBName, 0),
      { type: 'field.create', id: fName, tableId: tDel, name: 'Name', key: 'name', fieldType: 'text' }, pos(fName, 0),
      { type: 'field.create', id: fNotes, tableId: tDel, name: 'Notes', key: 'notes', fieldType: 'rich_text', options: { canvasNote: true } }, pos(fNotes, 1),
      { type: 'record.create', id: dA, tableId: tDel, data: { name: 'Texted ProRes', notes: doc({ type: 'taskList', content: [task('Confirm start TC'), task('M&E needed?')] }) } },
      { type: 'record.create', id: dB, tableId: tDel, data: { name: 'DCP screener' } },
      { type: 'record.create', id: board, tableId: tBoards, data: { name: 'Board' } },
      place(dA, 60, 60), place(dB, 500, 60),
      { type: 'section.create', id: sec, name: 'Post', icon: '🎬' },
      { type: 'section.update', id: sec, tableIds: [tDel, tBoards] },
    ]);
    check('fixture accepted', setup.status === 200, (await setup.text()).slice(0, 300));

    console.log('\nN1. The server');
    const write = (value: unknown) => post([{ type: 'record.update', id: dB, set: { notes: value }, unset: [] }]);
    check('lists, checkboxes, bold: accepted', (await write(doc(p('a'), { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'b', marks: [{ type: 'bold' }] }] }] }] }))).status === 200);
    check('a heading: refused, saying why', await (async () => { const r = await write(doc({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'x' }] })); return r.status !== 200 && /canvas note — it cannot hold a heading/.test(await r.text()); })());
    check('a code mark: refused', (await write(doc({ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'code' }] }] }))).status !== 200);
    check('over 64 KB: refused', (await write(doc(p('x'.repeat(70 * 1024))))).status !== 200);
    check('an ordinary rich text field still takes a heading', (await post([{ type: 'field.create', id: randomUUID(), tableId: tDel, name: 'Brief', key: 'brief', fieldType: 'rich_text' },
      { type: 'record.update', id: dB, set: { brief: doc({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'x' }] }) }, unset: [] }])).status === 200);
    await post([{ type: 'record.update', id: dB, set: {}, unset: ['notes'] }]);

    console.log('\nN2. toggleTask');
    const d0 = doc({ type: 'taskList', content: [task('a'), task('b', true)] });
    const d1 = toggleTask(d0, 1) as any;
    check('the second checkbox, unticked; the first untouched; a NEW document', d1 !== d0 && d1.content[0].content[1].attrs.checked === false && d1.content[0].content[0].attrs.checked === false);
    check('no such checkbox → the same document', toggleTask(d0, 5) === d0);

    console.log('\nN3. On the card');
    await nav.section(sec);
    await nav.openCanvas(board);
    const cardOf = (id: string) => w.findAll('.canvas-world .card').find((c: any) => c.attributes('data-record') === id);
    await until(() => !!cardOf(dA) && !!cardOf(dB), 8000);
    const note = (id: string) => cardOf(id)!.find('.cn');
    check('an EMPTY canvas note is still on the card — it is where you type', await until(() => note(dB).exists() && note(dB).find('.cn-empty').exists() && note(dB).find('.cn-empty').text() === 'Type a note…', 4000), note(dB).exists() ? note(dB).html().slice(0, 400) : cardOf(dB)!.html().slice(0, 600));
    check('a note with checkboxes draws them', note(dA).findAll('.cn-read input[type="checkbox"]').length === 2);
    await note(dA).findAll('.cn-read input[type="checkbox"]').at(1)!.trigger('click');
    const ticked = await untilDb(`select data->'notes' as n from records where id = '${dA}'`, (r) => r[0].n?.content?.[0]?.content?.[1]?.attrs?.checked === true);
    check('one click ticks it — saved, no editing, and the card was not even selected', ticked[0].n.content[0].content[1].attrs.checked === true && !cardOf(dA)!.classes('selected') && !note(dA).classes('editing'));
    win.dispatchEvent(new (win as any).KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    check('one Ctrl+Z unticks it', (await untilDb(`select data->'notes' as n from records where id = '${dA}'`, (r) => r[0].n?.content?.[0]?.content?.[1]?.attrs?.checked === false)).length === 1);

    console.log('\nN4. Typing');
    const PE = (win as any).PointerEvent ?? (win as any).MouseEvent;
    const press = async (el: any) => { await el.trigger('pointerdown', { button: 0, clientX: 520, clientY: 120 }); win.dispatchEvent(new PE('pointerup', { bubbles: true, clientX: 520, clientY: 120 })); await el.trigger('click', { clientX: 520, clientY: 120 }); };
    await press(note(dB).find('.cn-body'));
    check('the FIRST click on a card selects it — it does not start typing', await until(() => cardOf(dB)!.classes('selected')) && !note(dB).classes('editing'));
    await press(note(dB).find('.cn-body'));
    check('the next click types in the note: an editor, in place', await until(() => note(dB).classes('editing') && note(dB).find('.ProseMirror').exists(), 4000));
    const editorOf = () => (note(dB).find('.ProseMirror').element as any).editor;
    check('(the editor is reachable for the test)', !!editorOf());
    editorOf().commands.insertContent('Need a 10s black head');
    check('it says "saving…" at once', await until(() => note(dB).find('.cn-state').text() === 'saving…', 1500), note(dB).find('.cn-state').text());
    const first = await untilDb(`select data->'notes' as n from records where id = '${dB}'`, (r) => JSON.stringify(r[0].n ?? '').includes('10s black head'), 5000);
    check('…and saves on its own, about a second after typing stops', JSON.stringify(first[0].n).includes('10s black head'));
    editorOf().commands.insertContent(' and textless at tail');
    await untilDb(`select data->'notes' as n from records where id = '${dB}'`, (r) => JSON.stringify(r[0].n ?? '').includes('textless at tail'), 5000);
    check('…again — "saved" once it has', await until(() => note(dB).find('.cn-state').text() === 'saved', 4000), note(dB).find('.cn-state').text());
    await note(dB).find('.ProseMirror').trigger('keydown', { key: 'Delete' });
    await note(dB).find('.ProseMirror').trigger('keydown', { key: 'z' });
    await sleep(200);
    check('canvas keys are silent while typing: Delete does not unplace, Z does not fit', !!cardOf(dB) && (await pool.query(`select count(*)::int n from placements where canvas_id = $1`, [board])).rows[0].n === 2);
    await note(dB).find('.ProseMirror').trigger('keydown', { key: 'Escape' });
    check('Esc ends it: the note reads again', await until(() => !note(dB).classes('editing') && /textless at tail/.test(note(dB).find('.cn-read').text()), 3000));
    win.dispatchEvent(new (win as any).KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    check('ONE Ctrl+Z puts back the note as it was before the session — empty — not just the last save',
      (await untilDb(`select data->'notes' as n from records where id = '${dB}'`, (r) => r[0].n === null, 5000)).length === 1 && await until(() => note(dB).find('.cn-empty').exists()));

    await press(note(dB).find('.cn-body'));
    await until(() => note(dB).classes('editing'), 4000);
    editorOf().commands.insertContent('mine');
    await post([{ type: 'record.update', id: dB, set: { notes: doc(p('theirs')) }, unset: [] }]);
    check('a colleague\'s save while you type: said, not pasted under the caret', await until(() => note(dB).find('.cn-state').text() === 'changed elsewhere', 4000)
      && /mine/.test(note(dB).find('.ProseMirror').text()) && !/theirs/.test(note(dB).find('.ProseMirror').text()));
    await note(dB).find('.ProseMirror').trigger('keydown', { key: 'Escape' });
    check('…and on leaving, the last save wins: yours', (await untilDb(`select data->'notes' as n from records where id = '${dB}'`, (r) => JSON.stringify(r[0].n ?? '').includes('mine'), 5000)).length === 1);

    console.log('\nN5. The tray');
    await cardOf(dA)!.trigger('dblclick');
    const trayNote = () => w.find('.record-panel .cn.tray');
    check('the tray draws the same note, as an editor', await until(() => trayNote().exists() && trayNote().find('.ProseMirror').exists(), 8000));
    const trayEditor = (trayNote().find('.ProseMirror').element as any).editor;
    trayEditor.commands.focus('end'); trayEditor.commands.insertContent(' — asked');
    check('…and it saves as you type there too', (await untilDb(`select data->'notes' as n from records where id = '${dA}'`, (r) => JSON.stringify(r[0].n ?? '').includes('asked'), 5000)).length === 1);
    check('…and the card shows it', await until(() => /asked/.test(note(dA).text()), 4000));
  } finally {
    console.log(`\n${pass} passed, ${fail} failed\n`);
    await ui.close();
  }
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); console.log('\nSUITE ABORTED — an exception ended it early; the tally above is incomplete\n'); process.exit(1); });
