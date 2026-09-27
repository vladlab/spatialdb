/**
 * The comparison engine in the app (COMPARE-BRIEF.md): ticking "compare" on a link,
 * the pairs editor, ⚠ badges in the tray and on canvas cards, side by side, and seed
 * from. The engine itself and the server's validation are in test/grid.ts.
 */
import { randomUUID } from 'node:crypto';
import { mountApp, sleep } from './uiHarness.js';
import { boardsTableMutations } from './harness.js';

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

async function main() {
  const ui = await mountApp(Number(process.env.TEST_PORT ?? 8815));
  const { w, win, pool, until, untilDb, post, nav } = ui;
  const dialogs = nav.dialogs;
  try {
    const tSpecs = randomUUID(), tFiles = randomUUID(), tBoards = randomUUID();
    const fSName = randomUUID(), fSCodec = randomUUID(), fSMax = randomUUID(), fSLayout = randomUUID();
    const fName = randomUUID(), fCodec = randomUUID(), fSize = randomUUID(), fLayout = randomUUID(), fSpec = randomUUID();
    const spec = randomUUID(), file = randomUUID(), board = randomUUID();
    const pos = (id: string, position: number) => ({ type: 'field.update', id, position });
    const five1 = { tracks: [{ name: 'Full mix', channels: ['L', 'R', 'C', 'LFE', 'Ls', 'Rs'] }] };
    const setup = await post([
      { type: 'table.create', id: tSpecs, name: 'Specs' }, { type: 'table.create', id: tFiles, name: 'Files' }, ...boardsTableMutations(tBoards),
      { type: 'field.create', id: fSName, tableId: tSpecs, name: 'Name', key: 'name', fieldType: 'text' }, pos(fSName, 0),
      { type: 'field.create', id: fSCodec, tableId: tSpecs, name: 'Codec', key: 'codec', fieldType: 'text' }, pos(fSCodec, 1),
      { type: 'field.create', id: fSMax, tableId: tSpecs, name: 'Max size', key: 'max_size', fieldType: 'number' }, pos(fSMax, 2),
      { type: 'field.create', id: fSLayout, tableId: tSpecs, name: 'Audio layout', key: 'audio_layout', fieldType: 'structured', options: { shape: 'audio_layout' } }, pos(fSLayout, 3),
      { type: 'field.create', id: fName, tableId: tFiles, name: 'Name', key: 'name', fieldType: 'text' }, pos(fName, 0),
      { type: 'field.create', id: fCodec, tableId: tFiles, name: 'Codec', key: 'codec', fieldType: 'text' }, pos(fCodec, 1),
      { type: 'field.create', id: fSize, tableId: tFiles, name: 'Size', key: 'size', fieldType: 'number' }, pos(fSize, 2),
      { type: 'field.create', id: fLayout, tableId: tFiles, name: 'Audio layout', key: 'audio_layout', fieldType: 'structured', options: { shape: 'audio_layout' } }, pos(fLayout, 3),
      { type: 'field.create', id: fSpec, tableId: tFiles, name: 'Spec', key: 'spec', fieldType: 'link', options: { target_table_id: tSpecs } }, pos(fSpec, 4),
      { type: 'record.create', id: spec, tableId: tSpecs, data: { name: 'Network master', codec: 'ProRes 4444', max_size: 100, audio_layout: five1 } },
      { type: 'record.create', id: file, tableId: tFiles, data: { name: 'ep101.mov', codec: 'prores 4444', size: 120 } },
      { type: 'record.create', id: board, tableId: tBoards, data: { name: 'QC board' } },
      { type: 'placement.add', id: randomUUID(), canvasId: board, recordId: file, x: 60, y: 60, w: null, h: null, z: 1 },
      { type: 'link.add', id: randomUUID(), fieldId: fSpec, fromRecord: file, toRecord: spec },
    ]);
    check('fixture accepted', setup.status === 200, (await setup.text()).slice(0, 200));
    const go = async (tableId: string) => { win.location.hash = `#/all/table/${tableId}`; win.dispatchEvent(new (win as any).HashChangeEvent('hashchange')); await until(() => w.find('.gridview').exists() && w.findAll('.gridview tr.row').length > 0, 8000); };
    const th = (name: string) => w.findAll('.gridview thead th').find((t: any) => t.find('.th-name').exists() && t.find('.th-name').text() === name)!;
    const gridPop = () => w.find('.gridview .popover');
    const pField = (label: string) => w.findAll('.record-panel .rp-field').find((f: any) => f.find('.rp-name').text().replace(/[★⚠✓]/g, '').trim() === label)!;
    const openRecord = async (name: string) => { await w.findAll('.gridview tr.row').find((r: any) => r.findAll('td')[1].text() === name)!.find('.expand').trigger('click'); await until(() => w.find('.record-panel .rp-title').text() === name); };

    console.log('\nC1. Ticking "compare" on a link');
    await go(tFiles);
    await th('Spec').find('.th-menu').trigger('click');
    await until(() => gridPop().find('.field-settings').exists());
    check('a link field\'s ⚙ offers "compare", beside "membership" and "single"', gridPop().find('.compare-tick').exists() && gridPop().find('.single').exists());
    await gridPop().find('.compare-tick input').setValue(true);
    const c1 = await untilDb(`select options from fields where id = '${fSpec}'`, (r) => r[0].options.compare !== undefined);
    const pairsOf = (o: any) => (o.compare?.pairs ?? []).map((p: any) => `${p.from}>${p.to}:${p.rule}`);
    check('ticking it pre-fills every SAME-NAME pair with a legal rule (Codec = Codec, Audio layout ~ Audio layout) — not Name, the primary field',
      pairsOf(c1[0].options).sort().join() === [`${fCodec}>${fSCodec}:equals`, `${fLayout}>${fSLayout}:layout`].sort().join(), pairsOf(c1[0].options).join('|'));
    check('the pairs editor appears, one row per pair', await until(() => gridPop().findAll('.cp-pair').length === 2));

    // Add Size ≤ Max size by hand: the rule name-matching could never give.
    await gridPop().find('.cp-add').trigger('click');
    await untilDb(`select options from fields where id = '${fSpec}'`, (r) => r[0].options.compare.pairs.length === 3);
    const third = () => gridPop().findAll('.cp-pair')[2];
    await third().find('.cp-from').setValue(fSize);
    await third().find('.cp-to').setValue(fSMax);
    await untilDb(`select options from fields where id = '${fSpec}'`, (r) => r[0].options.compare.pairs[2]?.to === fSMax);
    check('a pair Size ↔ Max size offers the number rules', third().findAll('.cp-rule option').map((o: any) => o.text()).join() === 'equals,within ± of,at least,at most');
    await third().find('.cp-rule').setValue('atMost');
    await untilDb(`select options from fields where id = '${fSpec}'`, (r) => r[0].options.compare.pairs[2]?.rule === 'atMost');
    await gridPop().findAll('.cp-pair')[0].find('.cp-ci input').setValue(true);
    const c2 = await untilDb(`select options from fields where id = '${fSpec}'`, (r) => r[0].options.compare.pairs[0]?.params?.caseInsensitive === true);
    check('"at most" and case-insensitive are saved on the field — every edit a field.update', c2[0].options.compare.pairs.length === 3 && c2[0].options.target_table_id === tSpecs);
    await gridPop().trigger('keydown', { key: 'Escape' });

    console.log('\nC2. Badges: derived, live');
    await openRecord('ep101.mov');
    const strip = () => w.find('.record-panel .rp-compare');
    check('the tray shows the comparison: ✗, and the count of differences', await until(() => strip().exists() && /✗/.test(strip().text())) && /2 differences/.test(strip().text()), strip().text());
    check('⚠ beside Size (120 > 100) and Audio layout (missing); a green ✓ beside Codec (case-insensitive match) — so you can see the engine IS working',
      pField('Size').find('.cmp-badge').text() === '⚠' && pField('Audio layout').find('.cmp-badge').text() === '⚠' && pField('Codec').find('.cmp-badge').classes('ok') && pField('Codec').find('.cmp-badge').text() === '✓');
    check('the badge says why, and through which link', /Spec → Network master: 120 is above the maximum 100/.test(pField('Size').find('.cmp-badge').attributes('title') ?? ''), pField('Size').find('.cmp-badge').attributes('title'));
    await post([{ type: 'record.update', id: file, set: { size: 90 }, unset: [] }]);
    check('fix the size elsewhere and its ⚠ becomes ✓ — nothing was stored, it is computed', await until(() => pField('Size').find('.cmp-badge').classes('ok') && strip().text().match(/: (\d+) difference/)?.[1] === '1'), strip().text());

    console.log('\nC3. Side by side');
    await strip().find('.sbs-btn').trigger('click');
    const sbs = () => w.find('.record-panel .sbs');
    check('opens the two records side by side, paired rows aligned, found left and expected right', await until(() => sbs().exists() && sbs().findAll('.sbs-row').length === 3)
      && /ep101\.mov/.test(sbs().findAll('.sbs-col')[0].text()) && /Network master/.test(sbs().findAll('.sbs-col')[1].text()));
    const rowStatus = (name: string) => sbs().findAll('.sbs-row').find((r: any) => r.findAll('.sbs-name')[0].text() === name)!.classes().find((c: string) => ['match', 'differ', 'missing', 'unspecified'].includes(c));
    check('each row carries its verdict', rowStatus('Codec') === 'match' && rowStatus('Size') === 'match' && rowStatus('Audio layout') === 'missing', `${rowStatus('Codec')} ${rowStatus('Size')} ${rowStatus('Audio layout')}`);
    await sbs().find('.sbs-close').trigger('click');
    check('closes', !sbs().exists());

    console.log('\nC4. Seed from');
    const before = Number((await pool.query(`select count(*)::int n from mutations`)).rows[0].n);
    await strip().find('.seed-btn').trigger('click');
    const seeded = await untilDb(`select data from records where id = '${file}'`, (r) => r[0].data.audio_layout !== undefined);
    check('seeding copies the paired values into EMPTY fields: the layout arrives; codec and size are left as they were', JSON.stringify(seeded[0].data.audio_layout) === JSON.stringify(five1) && seeded[0].data.codec === 'prores 4444' && seeded[0].data.size === 90, JSON.stringify(seeded[0].data));
    check('…as one mutation', Number((await pool.query(`select count(*)::int n from mutations`)).rows[0].n) === before + 1);
    check('and now everything matches: ✓ in the strip, and every badge is a green ✓', await until(() => /✓/.test(strip().text()) && w.findAll('.record-panel .cmp-badge').every((b: any) => b.classes('ok'))) && w.findAll('.record-panel .cmp-badge').length === 3, strip().text());
    win.dispatchEvent(new (win as any).KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    check('one Ctrl+Z', (await untilDb(`select data from records where id = '${file}'`, (r) => r[0].data.audio_layout === undefined)).length === 1);
    dialogs.cancelNext = true;
    await post([{ type: 'record.update', id: file, set: { audio_layout: { tracks: [{ name: 'x', channels: ['M'] }] } }, unset: [] }]);
    await until(() => /1 track \/ 1 ch/.test(pField('Audio layout').text()));      // the new value has ARRIVED (it was merely missing before)
    await strip().find('.seed-btn').trigger('click');
    await sleep(400);
    check('with nothing empty, seeding ASKS before overwriting (cancelled here: nothing changed)', dialogs.seen.some((t: string) => /Seed from/.test(t)) && (await pool.query(`select data->'audio_layout'->'tracks'->0->>'name' n from records where id = $1`, [file])).rows[0].n === 'x');
    await w.find('.record-panel .rp-close').trigger('click');

    console.log('\nC5. On the canvas');
    await nav.openCanvas(board);
    const card = () => w.findAll('.canvas-world .card').find((c: any) => c.find('.card-label').text() === 'ep101.mov')!;
    const warnRows = () => card().findAll('.card-field').filter((r: any) => r.find('.card-warn').exists() && !r.find('.card-warn').classes('ok')).map((r: any) => r.find('.card-key').text());
    const okRows = () => card().findAll('.card-field').filter((r: any) => r.find('.card-warn.ok').exists()).map((r: any) => r.find('.card-key').text());
    check('the card shows ⚠ on the row that differs (Audio layout) and ✓ on the ones that match — the same cue as the tray', await until(() => !!card() && warnRows().length === 1, 8000)
      && warnRows()[0].includes('Audio layout') && okRows().length === 2, card()?.text());
    await post([{ type: 'record.update', id: file, set: { audio_layout: five1 }, unset: [] }]);
    check('…and it turns ✓ when the value matches — live on the canvas too', await until(() => warnRows().length === 0 && okRows().length === 3));

    console.log('\nC6. In the grid and on a board: the same cue');
    await go(tFiles);
    const cellIcon = (col: string) => { const ths = w.findAll('.gridview thead .th-name').map((x: any) => x.text()); return w.findAll('.gridview tr.row')[0].findAll('td')[ths.indexOf(col) + 1].find('.cell-verdict'); };
    check('grid cells carry the verdict to the right of the value', await until(() => cellIcon('Codec').exists()) && cellIcon('Codec').classes('ok') && cellIcon('Size').classes('ok') && !cellIcon('Name').exists());
    await post([{ type: 'record.update', id: file, set: { size: 500 }, unset: [] }]);
    check('…live: Size over the maximum turns ⚠ in the cell', await until(() => cellIcon('Size').exists() && !cellIcon('Size').classes('ok')));
  } finally {
    console.log(`\n${pass} passed, ${fail} failed\n`);
    await ui.close();
  }
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); console.log('\nSUITE ABORTED — an exception ended it early; the tally above is incomplete\n'); process.exit(1); });
