/**
 * Link pills: always drawn, in the relationship's colour when it has one, a pair's
 * status as its own segment — and a busy field shown as a COUNT ("2 Files").
 * The rule for the count is in src/contract/pills.ts; the pill is RecordPill.vue.
 *
 * happy-dom has no layout, so nothing here can say where a pill's actions float —
 * only that they exist without room being kept for them, and what they do.
 */
import { randomUUID } from 'node:crypto';
import { mountApp } from './uiHarness.js';
import { boardsTableMutations } from './harness.js';
import { countNoun, countOptionError, showsCount } from '../src/contract/pills.js';
import { cardHeight } from '../src/client/canvas/cardLayout.js';

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

async function main() {
  console.log('\nP1. The count rule (contract/pills.ts)');
  check('only `count: true` on a link or a backlink is a count',
    showsCount({ type: 'link', options: { count: true } }) && showsCount({ type: 'backlink', options: { count: true } })
    && !showsCount({ type: 'link', options: {} }) && !showsCount({ type: 'link', options: { count: 'yes' } }) && !showsCount({ type: 'text', options: { count: true } }));
  check('validated on write: a boolean, and only where it means something',
    countOptionError('link', { count: true }) === null && countOptionError('backlink', { count: false }) === null && countOptionError('text', {}) === null
    && /true or false/.test(countOptionError('link', { count: 'yes' }) ?? '') && /link or a backlink/.test(countOptionError('text', { count: true }) ?? ''));
  check('the noun is the table\'s name as typed — its singular name for exactly one',
    countNoun(3, { name: 'Edits', singular_name: 'Edit' }) === 'Edits' && countNoun(1, { name: 'Edits', singular_name: 'Edit' }) === 'Edit'
    && countNoun(1, { name: 'Edits', singular_name: '' }) === 'Edits' && countNoun(2, undefined) === 'records' && countNoun(1, undefined) === 'record');

  const ui = await mountApp(Number(process.env.TEST_PORT ?? 8833));
  const { w, win, until, untilDb, post, nav } = ui;
  try {
    const tWorks = randomUUID(), tFiles = randomUUID(), tBoards = randomUUID();
    const fWName = randomUUID(), fWFiles = randomUUID(), fFName = randomUUID(), fWork = randomUUID(), fAlt = randomUUID();
    const ep101 = randomUUID(), ep102 = randomUUID(), a = randomUUID(), b = randomUUID(), c = randomUUID(), board = randomUUID();
    const pos = (id: string, position: number) => ({ type: 'field.update', id, position });
    const setup = await post([
      { type: 'table.create', id: tWorks, name: 'Works', singularName: 'Work' }, { type: 'table.create', id: tFiles, name: 'Files', singularName: 'File' }, ...boardsTableMutations(tBoards),
      { type: 'field.create', id: fWName, tableId: tWorks, name: 'Name', key: 'name', fieldType: 'text' }, pos(fWName, 0),
      { type: 'field.create', id: fFName, tableId: tFiles, name: 'Name', key: 'name', fieldType: 'text' }, pos(fFName, 0),
      { type: 'field.create', id: fWork, tableId: tFiles, name: 'Work', key: 'work', fieldType: 'link', options: { target_table_id: tWorks, arrow: { color: '#ff8800' } } }, pos(fWork, 1),
      { type: 'field.create', id: fAlt, tableId: tFiles, name: 'Alt work', key: 'alt_work', fieldType: 'link', options: { target_table_id: tWorks } }, pos(fAlt, 2),
      { type: 'field.create', id: fWFiles, tableId: tWorks, name: 'Files', key: 'files', fieldType: 'backlink', options: { source_field_id: fWork } }, pos(fWFiles, 1),
      { type: 'record.create', id: ep101, tableId: tWorks, data: { name: 'Ep 101' } }, { type: 'record.create', id: ep102, tableId: tWorks, data: { name: 'Ep 102' } },
      { type: 'record.create', id: a, tableId: tFiles, data: { name: 'a.mov' } }, { type: 'record.create', id: b, tableId: tFiles, data: { name: 'b.mov' } },
      { type: 'record.create', id: c, tableId: tFiles, data: { name: 'c.mov' } },
      { type: 'link.add', id: randomUUID(), fieldId: fWork, fromRecord: a, toRecord: ep101 },
      { type: 'link.add', id: randomUUID(), fieldId: fWork, fromRecord: b, toRecord: ep101 },
      { type: 'link.add', id: randomUUID(), fieldId: fAlt, fromRecord: c, toRecord: ep101 },
      { type: 'record.create', id: board, tableId: tBoards, data: { name: 'Overview' } },
      { type: 'placement.add', id: randomUUID(), canvasId: board, recordId: ep101, x: 60, y: 60, w: null, h: null, z: 1 },
    ]);
    check('fixture accepted', setup.status === 200, (await setup.text()).slice(0, 200));

    const go = async (tableId: string) => { win.location.hash = `#/all/table/${tableId}`; win.dispatchEvent(new (win as any).HashChangeEvent('hashchange')); await until(() => w.find('.gridview').exists() && w.findAll('.gridview tr.row').length > 0, 8000); };
    const ths = () => w.findAll('.gridview thead .th-name').map((x: any) => x.text());
    const th = (name: string) => w.findAll('.gridview thead th').find((t: any) => t.find('.th-name').exists() && t.find('.th-name').text() === name)!;
    const rowNamed = (name: string) => w.findAll('.gridview tr.row').find((r: any) => r.findAll('td')[1].text() === name)!;
    const cellOf = (name: string, col: string) => rowNamed(name).findAll('td')[ths().indexOf(col) + 1];
    const gridPop = () => w.find('.gridview .popover');
    const pField = (label: string) => w.findAll('.record-panel .rp-field').find((f: any) => f.find('.rp-name').text().replace(/[★⚠✓]/g, '').trim() === label)!;
    const styleOf = (x: any) => String(x.attributes('style') ?? '');

    console.log('\nP2. The server');
    const onText = await post([{ type: 'field.update', id: fFName, options: { count: true } }]);
    check('refuses `count` on a field that links to nothing', onText.status === 400 && /link or a backlink/.test(await onText.text()));
    const notBool = await post([{ type: 'field.update', id: fAlt, options: { target_table_id: tWorks, count: 'yes' } }]);
    check('refuses a count that is not true or false', notBool.status === 400 && /true or false/.test(await notBool.text()));

    console.log('\nP3. A pill is always a pill, in the relationship\'s colour');
    await go(tFiles);
    const workPill = () => cellOf('a.mov', 'Work').find('.pill');
    check('a link is a pill at rest, with its actions in a floating group — no room kept for them beside the name',
      await until(() => workPill().exists()) && !workPill().find('.pill-open').exists() && workPill().find('.pill-actions .pill-x').exists()
      && workPill().element.children.length === 2 && workPill().find('.pill-text').text() === 'Ep 101');
    check('a field WITH an arrow colour tints its pills with it', /--pill-bg:\s*rgba\(255, 136, 0, 0\.22\)/.test(styleOf(workPill())), styleOf(workPill()));
    const altPill = () => cellOf('c.mov', 'Alt work').find('.pill');
    check('a field with none leaves them neutral (no inline tint)', await until(() => altPill().exists()) && !/--pill-bg/.test(styleOf(altPill())), styleOf(altPill()));
    await go(tWorks);
    const backPills = () => cellOf('Ep 101', 'Files').findAll('.pill');
    check('the BACKLINK on the other table wears the same colour, in outline (.back)',
      await until(() => backPills().length === 2) && backPills().every((p: any) => p.classes('back') && /--pill-line:\s*rgba\(255, 136, 0/.test(styleOf(p))), backPills().map(styleOf).join(' | '));
    check('…and nothing pops up beside it: no ⤢ (a double-click opens), no × (the link is edited on the file)', !backPills()[0].find('.pill-actions').exists() && backPills()[0].element.children.length === 1);

    console.log('\nP4. A busy field shown as a count');
    await th('Files').find('.th-menu').trigger('click');
    await until(() => gridPop().find('.field-settings').exists());
    check('a backlink\'s ⚙ offers "count"', gridPop().find('.count-tick').exists() && /3 Files/.test(gridPop().find('.count-tick').attributes('title') ?? ''));
    await gridPop().find('.count-tick input').setValue(true);
    const saved = await untilDb(`select options from fields where id = '${fWFiles}'`, (r) => r[0].options.count === true);
    check('ticking it is stored on the field, beside what it mirrors', saved[0].options.count === true && saved[0].options.source_field_id === fWork);
    const countPill = (name: string) => cellOf(name, 'Files').findAll('.pill');
    check('the cell is ONE pill: "2 Files"', await until(() => countPill('Ep 101').length === 1 && countPill('Ep 101')[0].classes('count'))
      && countPill('Ep 101')[0].find('.pill-text').text() === '2 Files' && countPill('Ep 101')[0].find('.pill-n').text() === '2', cellOf('Ep 101', 'Files').text());
    check('…in the relationship\'s colour, and its tooltip names them', /rgba\(255, 136, 0/.test(styleOf(countPill('Ep 101')[0])) && /a\.mov\nb\.mov/.test(countPill('Ep 101')[0].attributes('title') ?? ''));
    check('a record with none shows nothing — not "0 Files"', countPill('Ep 102').length === 0 && cellOf('Ep 102', 'Files').text() === '');
    await post([{ type: 'link.remove', fieldId: fWork, fromRecord: b, toRecord: ep101 }]);
    check('exactly one reads with the table\'s singular name: "1 File"', await until(() => countPill('Ep 101').length === 1 && countPill('Ep 101')[0].find('.pill-text').text() === '1 File'), cellOf('Ep 101', 'Files').text());
    await post([{ type: 'link.add', id: randomUUID(), fieldId: fWork, fromRecord: b, toRecord: ep101 }]);
    await until(() => countPill('Ep 101')[0]?.find('.pill-text').text() === '2 Files');
    await countPill('Ep 101')[0].trigger('dblclick');
    check('a double-click on it opens THIS record — the tray is where they are listed', await until(() => w.find('.record-panel').exists() && w.find('.record-panel .rp-title').text() === 'Ep 101'));
    check('…every one, as pills: the count is for the one-line surfaces only',
      await until(() => !!pField('Files') && pField('Files').findAll('.pill.back').length === 2) && !pField('Files').find('.pill.count').exists());
    await w.find('.record-panel .rp-close').trigger('click');

    console.log('\nP5. On a canvas card');
    await nav.openCanvas(board);
    const card = () => w.findAll('.canvas-world .card').find((x: any) => x.find('.card-label').text() === 'Ep 101')!;
    const filesRow = () => card().findAll('.card-field').find((r: any) => r.find('.card-key').text() === 'Files')!;
    check('the row is ONE line — a count pill, not a list', await until(() => !!card() && !!filesRow() && filesRow().find('.pill.count').exists())
      && filesRow().find('.pill-text').text() === '2 Files' && !filesRow().classes('tall'), filesRow()?.text());

    console.log('\nP6. Unticked, the pills are back');
    await post([{ type: 'field.update', id: fWFiles, options: { source_field_id: fWork } }]);
    check('the card row lists them again', await until(() => filesRow().findAll('.pill.back').length === 2 && !filesRow().find('.pill.count').exists()));
    const first = filesRow().findAll('.pill.back')[0];
    const named = first.find('.pill-text').text();
    await first.trigger('dblclick');
    check('a double-click on a card\'s pill opens the record it NAMES — not the card\'s own, which a double-click elsewhere on the card opens',
      named !== 'Ep 101' && await until(() => w.find('.record-panel .rp-title').exists() && w.find('.record-panel .rp-title').text() === named), w.find('.record-panel').exists() ? w.find('.record-panel .rp-title').text() : 'no tray');
    await w.find('.record-panel .rp-close').trigger('click');
    // A card is drawn at the height of its LINES — a row listing two records is two
    // lines — which is the height the canvas computes for its arrows. It used to be
    // drawn at one line per row, and the rows below a list were cut off.
    const lines = card().findAll('.card-field').reduce((n: number, r: any) => n + Math.max(1, r.findAll('.card-line').length), 0);
    check('…and the card is as tall as its lines, not its rows', lines > card().findAll('.card-field').length
      && (card().attributes('style') ?? '').includes(`height: ${cardHeight(lines, false)}px`), `${lines} lines; ${card().attributes('style')}`);
  } finally {
    console.log(`\n${pass} passed, ${fail} failed\n`);
    await ui.close();
  }
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); console.log('\nSUITE ABORTED — an exception ended it early; the tally above is incomplete\n'); process.exit(1); });
