/**
 * The schema editor in Table settings (TableSettings.vue): the field list with
 * inline add (FieldForm, kept open for a run), per-field ⚙ unfolding FieldSettings
 * (rename, delete), drag-to-reorder (one batch, the ★ previewed), and the
 * singular-name fix. "Add standard Files fields" is gone.
 */
import { randomUUID } from 'node:crypto';
import { mountApp, sleep } from './uiHarness.js';

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

async function main() {
  const ui = await mountApp(Number(process.env.TEST_PORT ?? 8824));
  const { w, win, pool, until, untilDb, post, nav } = ui;
  try {
    const tFiles = randomUUID(), tWorks = randomUUID(), fName = randomUUID(), fWName = randomUUID();
    const r = await post([
      { type: 'table.create', id: tFiles, name: 'Files', singularName: 'File' }, { type: 'table.update', id: tFiles, position: 1 },
      { type: 'table.create', id: tWorks, name: 'Works', singularName: 'Work' }, { type: 'table.update', id: tWorks, position: 2 },
      { type: 'field.create', id: fName, tableId: tFiles, name: 'Name', key: 'name', fieldType: 'text' }, { type: 'field.update', id: fName, position: 0 },
      { type: 'field.create', id: fWName, tableId: tWorks, name: 'Name', key: 'name', fieldType: 'text' },
      { type: 'record.create', id: randomUUID(), tableId: tFiles, data: { name: 'a.mov' } },
    ]);
    check('fixture accepted', r.status === 200, (await r.text()).slice(0, 200));
    win.location.hash = `#/all/table/${tFiles}`; win.dispatchEvent(new (win as any).HashChangeEvent('hashchange'));
    await until(() => w.findAll('.tree .table-row').length === 2, 8000);

    console.log('\nS1. The dialog: singular name labelled, no standard-fields button, the field list is the body');
    await nav.tableSettings(tFiles);
    await until(() => w.find('.ts').exists());
    check('the singular name has its label and its input together', w.find('.ts label[for="ts-singular"]').text().startsWith('Singular name') && w.find('.ts #ts-singular').exists());
    check('"Add standard Files fields" is gone', !w.find('.ts .add-files-fields').exists() && !/standard Files/.test(w.find('.ts').text()));
    const items = () => w.findAll('.ts .fitem');
    const names = () => items().map((i: any) => i.find('.fname').text());
    check('the schema section lists the field, starred as primary', names().join() === 'Name' && items()[0]!.find('.star').classes('on'));

    console.log('\nS2. A run of adds from the inline form');
    const form = () => w.find('.ts .fadd');
    check('the add form is there, open', form().exists() && form().find('input.name').exists());
    const add = async (name: string, type = 'text') => {
      await form().find('select.type').setValue(type);
      await form().find('input.name').setValue(name);
      await form().find('input.name').trigger('keydown', { key: 'Enter' });
    };
    await add('Codec');
    await untilDb(`select count(*)::int n from fields where table_id = '${tFiles}'`, (x) => x[0].n === 2, 8000);
    check('Enter adds the field; the form stays and is cleared for the next', await until(() => names().join() === 'Name,Codec') && (form().find('input.name').element as HTMLInputElement).value === '');
    await add('Rating', 'number');
    await add('Work', 'link');   // no target picked: refused, says so
    await sleep(150);
    check('a link without a target is refused inline', /table/.test(form().find('.error').text()) && names().join() === 'Name,Codec,Rating', form().find('.error').text());
    await form().find('select.target').setValue(tWorks);
    await form().find('input.name').trigger('keydown', { key: 'Enter' });
    await untilDb(`select count(*)::int n from fields where table_id = '${tFiles}'`, (x) => x[0].n === 4, 8000);
    check('with a target, it lands — and its summary says where it points', await until(() => names().join() === 'Name,Codec,Rating,Work') && /→ Works/.test(items()[3]!.find('.fsum').text()), items()[3]?.find('.fsum').text());

    console.log('\nS3. ⚙ unfolds the field\'s settings; rename and delete from there');
    await items()[1]!.find('.gear').trigger('click');
    check('the settings form opens under the row', await until(() => items()[1]!.find('.fopen').exists()) && items()[1]!.find('.fopen input.name').exists());
    await items()[1]!.find('.fopen input.name').setValue('Video codec');
    await items()[1]!.find('.fopen input.name').trigger('change');
    await untilDb(`select name from fields where table_id = '${tFiles}' and key = 'codec'`, (x) => x[0]?.name === 'Video codec', 8000);
    check('renamed in place', await until(() => names()[1] === 'Video codec'));
    await items()[2]!.find('.gear').trigger('click');
    check('opening another closes the first', await until(() => !items()[1]!.find('.fopen').exists() && items()[2]!.find('.fopen').exists()));
    await items()[2]!.find('.fopen .delete').trigger('click');
    await untilDb(`select count(*)::int n from fields where table_id = '${tFiles}'`, (x) => x[0].n === 3, 8000);
    check('deleted from the settings form (after the usual confirm)', await until(() => names().join() === 'Name,Video codec,Work'));

    console.log('\nS4. Drag to reorder — the ★ follows, one batch');
    const PE = (win as any).PointerEvent ?? (win as any).MouseEvent;
    const winEv = (type: string, init: Record<string, unknown>) => win.dispatchEvent(new PE(type, { bubbles: true, ...init }));
    // Rows have no layout in happy-dom: give them rects so the drop index can be computed.
    const rows = () => [...(win.document.querySelectorAll('.ts .field-list .fitem') as any)] as HTMLElement[];
    const lay = () => rows().forEach((el, i) => { el.getBoundingClientRect = () => ({ top: 100 + i * 30, bottom: 130 + i * 30, height: 30, left: 0, right: 500, width: 500, x: 0, y: 100 + i * 30, toJSON() {} }) as DOMRect; });
    lay();
    await items()[1]!.find('.grip').trigger('pointerdown', { button: 0, clientY: 145 });
    winEv('pointermove', { clientY: 105 });
    check('while held, the list re-orders (Video codec above Name) and the ★ previews the new primary', await until(() => names().join() === 'Video codec,Name,Work') && items()[0]!.find('.star').classes('on') && !items()[1]!.find('.star').classes('on'), names().join());
    check('nothing written yet', (await pool.query(`select key from fields where table_id = $1 order by position`, [tFiles])).rows.map((x: any) => x.key).join() === 'name,codec,work');
    winEv('pointerup', { clientY: 105 });
    const order = await untilDb(`select key from fields where table_id = '${tFiles}' order by position`, (x) => x.map((y: any) => y.key).join() === 'codec,name,work', 8000);
    check('released: the order is written', order.map((x: any) => x.key).join() === 'codec,name,work');
    check('…and Video codec is now the primary (the grid\'s record label)', await until(() => /Video codec/.test(w.find('.ts .fitem .star.on').element.parentElement!.textContent ?? '')));
    win.dispatchEvent(new (win as any).KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    check('one Ctrl+Z puts it all back', (await untilDb(`select key from fields where table_id = '${tFiles}' order by position`, (x) => x.map((y: any) => y.key).join() === 'name,codec,work', 8000)).map((x: any) => x.key).join() === 'name,codec,work');
    check('the ↑ ↓ keys are still there', items()[1]!.find('.mv.prev').exists() && items()[1]!.find('.mv.next').exists());
    await w.find('.ts .x').trigger('click');
    await sleep(100);
  } finally {
    console.log(`\n${pass} passed, ${fail} failed\n`);
    await ui.close();
  }
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); console.log('\nSUITE ABORTED — an exception ended it early; the tally above is incomplete\n'); process.exit(1); });
