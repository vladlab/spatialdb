/**
 * The `dimensions` field type (contract/dimensions.ts): a frame size as one value.
 * Parsing (what a person types), the stored spelling (what validateValue accepts),
 * and the editor in the grid — typed any way, stored one way, refused with a reason.
 */
import { randomUUID } from 'node:crypto';
import { mountApp } from './uiHarness.js';
import { canonicalDimensions, dimensionsError, parseDimensions } from '../src/contract/dimensions.js';
import { validateValue } from '../src/contract/values.js';
import { rulesFor } from '../src/contract/compare.js';
import { fieldAccepts, ANALYZERS } from '../src/contract/tools.js';
import { applyView } from '../src/contract/views.js';

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

function pure() {
  console.log('\nX1. Parsing — lenient in, one spelling out');
  const ok = (t: string) => canonicalDimensions(t);
  check('every common spelling reads as 1920×1080', ['1920x1080', '1920X1080', '1920×1080', '1920 x 1080', '1920*1080', '1920, 1080', '1920 1080', ' 1920 by 1080 ', '1920:1080'].every((t) => ok(t) === '1920×1080'),
    ['1920x1080', '1920 1080', '1920 by 1080'].map(ok).join());
  check('not a size: one number, three numbers, words, zero, a decimal', ['1920', '1920x1080x3', 'UHD', '0x1080', '1920.5x1080', '', 'x'].every((t) => ok(t) === null));
  check('parseDimensions gives the numbers', JSON.stringify(parseDimensions('3840 × 2160')) === '{"w":3840,"h":2160}');
  console.log('\nX2. The stored value is the canonical text only');
  check('validateValue accepts "1920×1080" and refuses every other spelling, with a reason naming the form',
    validateValue({ key: 'size', type: 'dimensions', options: {} } as never, '1920×1080') === null
    && /width × height, like 1920×1080/.test(validateValue({ key: 'size', type: 'dimensions', options: {} } as never, '1920x1080') ?? '')
    && dimensionsError('size', 1920) !== null && dimensionsError('size', '0×10') !== null);
  console.log('\nX3. Where it plugs in');
  const f = (type: string) => ({ id: type, key: type, name: type, type, table_id: 't', options: {} });
  check('compare: dimensions to dimensions is `equals`, and nothing else pairs with it', rulesFor(f('dimensions'), f('dimensions')).join() === 'equals' && rulesFor(f('dimensions'), f('text')).length === 0 && rulesFor(f('number'), f('dimensions')).length === 0);
  const out = ANALYZERS.find((a) => a.id === 'ffprobe')!.outputs.find((o) => o.key === 'dimensions')!;
  check('ffprobe has a `dimensions` output, accepted by a dimensions field only (width and height stay as the two numbers)', out?.type === 'dimensions' && fieldAccepts(out, { id: 'd', type: 'dimensions' }) && !fieldAccepts(out, { id: 't', type: 'text' }) && !fieldAccepts(out, { id: 'n', type: 'number' }));
  const recs = [{ id: 'a', data: { size: '3840×2160' } }, { id: 'b', data: { size: '1280×720' } }, { id: 'c', data: { size: '1920×1080' } }] as never[];
  const vf = { id: 's', key: 'size', type: 'dimensions', options: {} } as never;
  const sorted = applyView(recs, [vf], { sort: [{ fieldId: 's', dir: 'asc' }], filters: [], hidden: [] } as never, () => [] as string[]).map((r: { id: string }) => r.id).join();
  check('sorts naturally: 1280×720 < 1920×1080 < 3840×2160', sorted === 'b,c,a', sorted);
}

async function app() {
  const ui = await mountApp(Number(process.env.TEST_PORT ?? 8843));
  const { w, win, until, untilDb, post } = ui;
  try {
    const t = randomUUID(), fName = randomUUID(), fSize = randomUUID(), a = randomUUID(), b = randomUUID();
    const pos = (id: string, position: number) => ({ type: 'field.update', id, position });
    const r = await post([
      { type: 'table.create', id: t, name: 'Masters', singularName: 'Master' },
      { type: 'field.create', id: fName, tableId: t, name: 'Name', key: 'name', fieldType: 'text' }, pos(fName, 0),
      { type: 'field.create', id: fSize, tableId: t, name: 'Size', key: 'size', fieldType: 'dimensions' }, pos(fSize, 1),
      { type: 'record.create', id: a, tableId: t, data: { name: 'UHD master', size: '3840×2160' } },
      { type: 'record.create', id: b, tableId: t, data: { name: 'HD master' } },
    ]);
    check('a dimensions field is created and a canonical value stored', r.status === 200, (await r.text()).slice(0, 200));
    const bad = await post([{ type: 'record.update', id: b, set: { size: '1920x1080' }, unset: [] }]);
    check('the server refuses a non-canonical spelling (the editor is where it is parsed)', bad.status === 400 && /width × height/.test(await bad.text()));

    win.location.hash = `#/all/table/${t}`; win.dispatchEvent(new (win as any).HashChangeEvent('hashchange'));
    await until(() => w.findAll('.gridview tr.row').length === 2, 8000);
    const rowOf = (name: string) => w.findAll('.gridview tr.row').find((x: any) => x.text().includes(name))!;
    const sizeCell = (name: string) => rowOf(name).findAll('td')[2];
    const grid = () => w.find('.gridview .scroller');
    const editor = () => w.find('.gridview td.editing input');
    console.log('\nX4. In the grid');
    check('shown as stored', sizeCell('UHD master').text() === '3840×2160', sizeCell('UHD master').text());
    await sizeCell('HD master').trigger('mousedown', { button: 0 });
    await grid().trigger('keydown', { key: '1' });
    check('typing starts an edit with a placeholder saying what goes here', editor().exists() && editor().attributes('placeholder') === 'width × height' && (editor().element as HTMLInputElement).value === '1');
    await editor().setValue('1920 x 1080');
    await editor().trigger('keydown', { key: 'Enter' });
    await untilDb(`select data->>'size' s from records where id='${b}'`, (x) => x[0]?.s === '1920×1080', 8000);
    check('"1920 x 1080" is stored as 1920×1080', true);
    await until(() => sizeCell('HD master').text() === '1920×1080');
    await sizeCell('HD master').trigger('mousedown', { button: 0 });
    await grid().trigger('keydown', { key: 'Enter' });
    await editor().setValue('UHD');
    await editor().trigger('keydown', { key: 'Enter' });
    check('"UHD" is refused at the cell — red ring, editor stays, value untouched', editor().exists() && editor().classes('invalid') && /width × height/.test(editor().attributes('title') ?? ''), editor().attributes('title'));
    await editor().trigger('keydown', { key: 'Escape' });
    check('…Escape leaves it as it was', sizeCell('HD master').text() === '1920×1080');
  } finally {
    await ui.close();
  }
}

async function main() {
  pure();
  await app();
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); console.log(`\n${pass} passed, ${fail} failed`); console.log('\nSUITE ABORTED — an exception ended it early; the tally above is incomplete\n'); process.exit(1); });
