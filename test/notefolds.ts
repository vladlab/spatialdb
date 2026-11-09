/**
 * Heading folds (client/richtext/folds.ts) and a table's scale
 * (client/richtext/tableScale.ts), in the note page's editor — the tray's is the
 * same component.
 *
 * happy-dom has no layout: "hidden" here means the node wears `fold-hidden`, and a
 * scale means the attribute and the custom property are on the table. That the
 * chevron sits in the margin and the table LOOKS smaller needs eyes (UI-NOTES).
 */
import { randomUUID } from 'node:crypto';
import { mountApp, sleep } from './uiHarness.js';
import { formatNote } from '../src/client/router.js';

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail: unknown = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + String(detail) : ''}`); }
}
const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const h = (level: number, text: string) => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text }] });
const cell = (type: string, text: string) => ({ type, content: [p(text)] });
const table = { type: 'table', content: [
  { type: 'tableRow', content: [cell('tableHeader', 'Item'), cell('tableHeader', 'Value')] },
  { type: 'tableRow', content: [cell('tableCell', 'Codec'), cell('tableCell', 'ProRes')] },
] };
//                                  0           1               2                  3               4               5            6              7              8      9
const DOC = { type: 'doc', content: [p('intro'), h(2, 'Picture'), p('picture body'), h(3, 'Colour'), p('colour body'), h(2, 'Empty'), h(2, 'Audio'), p('audio body'), table, p('the end')] };

async function main() {
  const tDel = randomUUID(), fName = randomUUID(), fSpec = randomUUID(), rec = randomUUID();
  const ui = await mountApp(Number(process.env.TEST_PORT ?? 8824), formatNote({ record: rec, field: fSpec }), {}, async (post) => {
    const r = await post([
      { type: 'table.create', id: tDel, name: 'Deliverables' },
      { type: 'field.create', id: fName, tableId: tDel, name: 'Name', key: 'name', fieldType: 'text' },
      { type: 'field.create', id: fSpec, tableId: tDel, name: 'Spec', key: 'spec', fieldType: 'rich_text' },
      { type: 'record.create', id: rec, tableId: tDel, data: { name: 'Texted ProRes', spec: DOC } },
    ]);
    if (r.status !== 200) throw new Error(await r.text());
  });
  const { w, win, until, pool, post } = ui;
  try {
    const page = () => w.find('.note-page');
    const pmEl = () => page().find('.rte .ProseMirror');
    const pm = () => (pmEl().element as any).editor;
    const state = () => page().find('.rte-context .rte-state').text();
    const kids = () => Array.from(pmEl().element.children) as HTMLElement[];
    /** Which top-level blocks are hidden, by index. */
    const hidden = () => kids().map((k, i) => (k.classList.contains('fold-hidden') ? i : -1)).filter((i) => i >= 0).join(',');
    const head = (text: string) => kids().find((k) => /^H\d$/.test(k.tagName) && k.textContent!.includes(text))!;
    const press = (el: HTMLElement) => { el.dispatchEvent(new (win as any).MouseEvent('mousedown', { bubbles: true, cancelable: true })); };
    const key = (k: string, shiftKey = false) => { pmEl().element.dispatchEvent(new (win as any).KeyboardEvent('keydown', { key: k, shiftKey, bubbles: true, cancelable: true })); };
    /** Put the cursor in the top-level block with this text. */
    const cursorIn = (text: string) => { let at = -1; pm().state.doc.descendants((n: any, pos: number) => { if (at < 0 && n.isTextblock && n.textContent === text) at = pos + 1; }); pm().commands.setTextSelection(at); };
    const stored = () => JSON.parse(win.localStorage.getItem('spatialdb.rte.headingFolds') ?? '{}')[`${rec}:spec`] ?? [];
    const mutations = async () => Number((await pool.query(`select count(*)::int n from mutations`)).rows[0].n);

    console.log('\nF1. a chevron on every heading with something under it');
    check('the note is open', await until(() => pmEl().exists() && kids().length === 10, 10000), w.html().slice(0, 200));
    check('Picture, Colour and Audio fold; "Empty" (nothing under it) does not',
      !!head('Picture').querySelector('.fold-chevron') && !!head('Colour').querySelector('.fold-chevron') && !!head('Audio').querySelector('.fold-chevron') && !head('Empty').querySelector('.fold-chevron'));
    check('nothing starts folded', hidden() === '');

    console.log('\nF2. folding hides down to the next heading of the same level or higher');
    const log0 = await mutations();
    press(head('Colour').querySelector('.fold-chevron') as HTMLElement);
    check('an H3 hides its own body only', await until(() => hidden() === '4') && head('Colour').classList.contains('folded'), hidden());
    press(head('Picture').querySelector('.fold-chevron') as HTMLElement);
    check('an H2 takes its H3 with it, and stops at the next H2', await until(() => hidden() === '2,3,4'), hidden());
    check('a fold is NOT an edit: still "saved", nothing written', state() === 'saved' && await mutations() === log0, state());
    check('it is remembered in this browser, by what the heading says', JSON.stringify(stored()) === JSON.stringify(['2|Picture|0', '3|Colour|0']), JSON.stringify(stored()));
    press(head('Picture').querySelector('.fold-chevron') as HTMLElement);
    check('unfolding the H2 shows its section — the H3 inside keeps its own fold', await until(() => hidden() === '4'), hidden());
    press(head('Colour').querySelector('.fold-chevron') as HTMLElement);
    await until(() => hidden() === '');

    console.log('\nF3. Tab on a heading; Shift+Tab for all');
    cursorIn('Audio'); key('Tab');
    check('Tab on a heading folds it', await until(() => hidden() === '7,8,9'), hidden());
    key('Tab');
    check('Tab again unfolds it', await until(() => hidden() === ''), hidden());
    cursorIn('intro'); key('Shift+Tab'.split('+')[1], true);
    check('Shift+Tab folds every heading', await until(() => hidden() === '2,3,4,7,8,9'), hidden());
    key('Tab', true);
    check('Shift+Tab with all folded unfolds them all', await until(() => hidden() === ''), hidden());
    cursorIn('Codec'); const before = pm().state.selection.from; key('Tab');
    check('in a table Tab is still "next cell", and folds nothing', hidden() === '' && pm().state.selection.from !== before);

    console.log('\nF4. you never type into what you cannot see');
    cursorIn('colour body');
    press(head('Picture').querySelector('.fold-chevron') as HTMLElement);
    check('folding a section the cursor is in lifts the cursor onto the heading', await until(() => hidden() === '2,3,4') && pm().state.selection.$head.parent.textContent === 'Picture', pm().state.selection.$head.parent.textContent);
    cursorIn('picture body');
    check('a cursor arriving inside a folded section opens it', await until(() => hidden() === ''), hidden());

    console.log('\nF5. folds follow the text');
    press(head('Audio').querySelector('.fold-chevron') as HTMLElement);
    await until(() => hidden() === '7,8,9');
    cursorIn('Audio'); pm().commands.insertContent(' (5.1)');
    check('renaming a folded heading keeps it folded', await until(() => state() === 'unsaved') && hidden() === '7,8,9' && /Audio|\(5\.1\)/.test(head('5.1').textContent!), hidden());
    check('…and what is remembered follows the new name', await until(() => stored().some((k: string) => /5\.1/.test(k))), JSON.stringify(stored()));
    await page().find('.rte-context .rte-save').trigger('click');
    await until(() => state() === 'saved');
    const renamed = pm().getJSON();
    await ui.untilDb(`select data->'spec' v from records where id = '${rec}'`, (r) => /5\.1/.test(JSON.stringify(r[0]?.v)));   // our save has landed
    await post([{ type: 'record.update', id: rec, set: { spec: { type: 'doc', content: [p('a new first line'), ...renamed.content] } }, unset: [] }]);
    check('a colleague\'s save replacing the note: the fold is found again by its heading', await until(() => kids().length === 11 && hidden() === '8,9,10', 6000), `${kids().length} ${hidden()}`);

    console.log('\nF6. a reload remembers');
    win.location.hash = `#/all/table/${tDel}`; win.dispatchEvent(new (win as any).HashChangeEvent('hashchange'));
    await until(() => w.find('.gridview').exists() && !w.find('.note-page').exists(), 8000);
    win.location.hash = formatNote({ record: rec, field: fSpec }); win.dispatchEvent(new (win as any).HashChangeEvent('hashchange'));
    check('opened again, Audio is still folded', await until(() => pmEl().exists() && kids().length === 11 && hidden() === '8,9,10', 8000), hidden());
    key('Tab', true); await until(() => hidden() !== '8,9,10'); key('Tab', true);
    await until(() => hidden() === '');

    console.log('\nK1. Ctrl+Enter saves — and adds nothing');
    cursorIn('intro'); pm().commands.insertContent('!');
    await until(() => state() === 'unsaved');
    pmEl().element.dispatchEvent(new (win as any).KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
    check('typed IN the text, it saves', await until(() => state() === 'saved'), state());
    check('…without the editor first taking it as "line break"', !/hardBreak/.test(JSON.stringify(pm().getJSON())), JSON.stringify(pm().getJSON()).slice(0, 160));

    console.log('\nT1. a table\'s scale');
    const tbl = () => pmEl().find('.tableWrapper');
    const ctl = () => page().find('.rte-table');
    const pct = () => ctl().find('.tbl-scale').text();
    cursorIn('intro'); await sleep(50);
    check('outside a table the control keeps its place but is not shown', ctl().exists() && !ctl().classes().includes('shown'));
    cursorIn('Codec');
    check('in a table it shows, at 100%, with nothing larger to go to', await until(() => ctl().classes().includes('shown')) && pct() === '100%' && ctl().find('.tbl-larger').attributes('disabled') !== undefined, pct());
    await ctl().find('.tbl-smaller').trigger('click');
    await ctl().find('.tbl-smaller').trigger('click');
    check('− twice: 80%, on the table itself', await until(() => pct() === '80%') && tbl().attributes('data-scale') === '0.8' && /--tbl-scale:\s*0\.8/.test(tbl().attributes('style') ?? ''), `${pct()} ${tbl().attributes('data-scale')} ${tbl().attributes('style')}`);
    check('it IS an edit: unsaved until saved', state() === 'unsaved');
    for (let i = 0; i < 5; i++) await ctl().find('.tbl-smaller').trigger('click');
    check('it stops at 60%', await until(() => pct() === '60%') && ctl().find('.tbl-smaller').attributes('disabled') !== undefined, pct());
    await ctl().find('.tbl-larger').trigger('click');
    await page().find('.rte-context .rte-save').trigger('click');
    const saved = await ui.untilDb(`select data->'spec' v from records where id = '${rec}'`, (r) => /"scale":\s*0\.7/.test(JSON.stringify(r[0]?.v)));
    check('saved with the note (70%)', /"scale":\s*0\.7/.test(JSON.stringify(saved[0]?.v)) && await until(() => state() === 'saved'), JSON.stringify(saved[0]?.v).slice(0, 120));
    const { generateHTML } = await import('@tiptap/core');
    const { richExtensions } = await import('../src/client/richtext/extensions.js');
    const html = generateHTML(saved[0].v, richExtensions((id: string) => `/api/assets/${id}`));
    check('the read-only renderer (canvas cards) draws the same scale, and no fold chevrons', /<table[^>]*data-scale="0.7"/.test(html) && !/fold-/.test(html), html.slice(0, 200));
    for (let i = 0; i < 3; i++) await ctl().find('.tbl-larger').trigger('click');
    check('back at 100% the attribute is gone', await until(() => pct() === '100%') && tbl().attributes('data-scale') === undefined, tbl().attributes('data-scale'));

    console.log('\nT2. an old note with a table is not "unsaved" for having no scale');
    page().find('.rte').trigger('keydown', { key: 'Escape' });
    await until(() => state() === 'saved');
    // As the editor wrote it BEFORE tables had a scale: its own JSON, minus that key, ending on the table.
    const old = JSON.parse(JSON.stringify(pm().getJSON(), (k, v) => (k === 'scale' ? undefined : v)));
    old.content = old.content.filter((n: any) => n.type !== 'paragraph' || n.content?.[0]?.text !== 'the end');
    while (old.content[old.content.length - 1].type !== 'table') old.content.pop();
    await post([{ type: 'record.update', id: rec, set: { spec: old }, unset: [] }]);
    await until(() => kids()[kids().length - 1].tagName !== 'P' || !kids()[kids().length - 1].textContent, 6000); await sleep(200);
    cursorIn('intro'); pm().commands.insertContent('x');
    await until(() => state() === 'unsaved');
    pm().commands.deleteRange({ from: pm().state.selection.from - 1, to: pm().state.selection.from });
    check('type a letter and delete it: "saved" again', await until(() => state() === 'saved'), state());
    press(head('Picture').querySelector('.fold-chevron') as HTMLElement);
    check('…and a fold on a note that ends on its table is still not an edit', await until(() => hidden() === '3,4,5') && state() === 'saved', `${hidden()} ${state()}`);
  } finally {
    await ui.close();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
