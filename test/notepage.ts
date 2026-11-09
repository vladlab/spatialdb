/**
 * A note as a page (NotePage.vue): one rich text field of one record, filling a
 * browser tab of its own, at `#/note/<recordId>/<fieldId>`.
 *
 * What is checked here is what happy-dom can know: what is drawn instead of the
 * shell, what the context line says, that the editor on the page saves like the
 * tray's, and that the ways in point at the right address. What it LOOKS like — the
 * column, the sticky top, a wide table — needs eyes (UI-NOTES).
 */
import { randomUUID } from 'node:crypto';
import { mountApp, sleep } from './uiHarness.js';
import { formatNote, parseNote, parseRoute } from '../src/client/router.js';

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail: unknown = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + String(detail) : ''}`); }
}
const para = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

async function main() {
  console.log('\nN0. the address (client/router.ts)');
  const A = randomUUID(), B = randomUUID();
  check('a note\'s address round-trips', JSON.stringify(parseNote(formatNote({ record: A, field: B }))) === JSON.stringify({ record: A, field: B }));
  check('a table\'s address is not a note', parseNote(`#/all/table/${A}?r=${B}`) === null && parseNote('#/') === null && parseNote('') === null);
  check('a mangled one is not a note either (one id, a short id, something after)', parseNote(`#/note/${A}`) === null && parseNote(`#/note/${A}/abc`) === null && parseNote(`#/note/${A}/${B}/x`) === null);
  check('and to the shell\'s parser a note is nowhere (Home), never a wrong place', parseRoute(formatNote({ record: A, field: B })).section === null);

  console.log('\nN1. opened ON a note\'s address: the page, not the shell');
  const tDel = randomUUID(), fName = randomUUID(), fSpec = randomUUID(), fNotes = randomUUID(), rec = randomUUID(), other = randomUUID();
  const address = formatNote({ record: rec, field: fSpec });
  const ui = await mountApp(Number(process.env.TEST_PORT ?? 8823), address, {}, async (post) => {
    const r = await post([
      { type: 'table.create', id: tDel, name: 'Deliverables' },
      { type: 'field.create', id: fName, tableId: tDel, name: 'Name', key: 'name', fieldType: 'text' },
      { type: 'field.create', id: fSpec, tableId: tDel, name: 'Spec', key: 'spec', fieldType: 'rich_text' },
      { type: 'field.create', id: fNotes, tableId: tDel, name: 'QC notes', key: 'qc_notes', fieldType: 'rich_text' },
      { type: 'record.create', id: rec, tableId: tDel, data: { name: 'Texted ProRes', spec: para('ProRes 4444 XQ, 23.976') } },
      { type: 'record.create', id: other, tableId: tDel, data: { name: 'DCP' } },
    ]);
    if (r.status !== 200) throw new Error(await r.text());
  });
  const { w, win, until, pool, post } = ui;
  const opened: string[] = [];
  (win as any).open = (url: string) => { opened.push(url); return null; };
  (globalThis as any).open = (win as any).open;
  try {
    const page = () => w.find('.note-page');
    const pm = () => (page().find('.rte .ProseMirror').element as any).editor;
    const state = () => page().find('.rte-context .rte-state').text();
    const specInDb = async () => JSON.stringify((await pool.query(`select data->'spec' v from records where id = $1`, [rec])).rows[0]?.v ?? null);

    check('the page is drawn, with the note in it', await until(() => page().find('.rte.page .ProseMirror').exists() && /ProRes 4444 XQ/.test(pm().getText()), 10000), w.html().slice(0, 200));
    check('INSTEAD of the shell: no top bar, no tree, no tray', !w.find('.app').exists() && !w.find('.topbar').exists() && !w.find('.record-panel').exists());
    const crumbs = () => page().findAll('.note-context .crumb').map((c: any) => c.text());
    check('the context line says table › record › field', JSON.stringify(crumbs()) === JSON.stringify(['spatialdb', 'Deliverables', 'Texted ProRes', 'Spec']), crumbs().join(' | '));
    check('the record is a link to that record in the app, tray open', page().find('.record-crumb').attributes('href') === `#/all/table/${tDel}?r=${rec}`, page().find('.record-crumb').attributes('href'));
    check('the browser tab is named after the note', win.document.title === 'Texted ProRes — Spec', win.document.title);
    check('the toolbar is the editor\'s own; the state word and Save sit on the context line', page().findAll('.rte-bar button').length > 8 && !page().find('.rte-bar .rte-save').exists() && state() === 'saved', state());
    check('no fixed height: the page scrolls, not a box', !/height/.test(page().find('.rte-body').attributes('style') ?? ''), page().find('.rte-body').attributes('style'));
    check('the address bar still says the note', win.location.hash === address, win.location.hash);
    check('and a note is NOT remembered as "where you were"', win.localStorage.getItem('spatialdb.lastRoute') === null, String(win.localStorage.getItem('spatialdb.lastRoute')));

    console.log('\nN2. it saves like the tray\'s editor');
    const unload = () => { const e = new (win as any).Event('beforeunload', { cancelable: true }); win.dispatchEvent(e); return e.defaultPrevented as boolean; };
    check('nothing unsaved: closing the tab asks nothing', unload() === false);
    pm().commands.setContent(para('ProRes 4444 XQ, 23.976, texted'));
    check('typing: "unsaved", and Save shows', await until(() => state() === 'unsaved') && page().find('.rte-context .rte-save').classes().includes('shown'), state());
    check('unsaved words: closing the tab raises the browser\'s own prompt', unload() === true);
    await page().find('.rte-context .rte-save').trigger('click');
    check('Save writes the field', await until(() => state() === 'saved') && /texted/.test((await ui.untilDb(`select data->'spec' v from records where id = '${rec}'`, (r) => /texted/.test(JSON.stringify(r[0]?.v))))[0] ? await specInDb() : ''), await specInDb());
    check('saved: closing the tab asks nothing again', unload() === false);
    await post([{ type: 'record.update', id: rec, set: { spec: para('a colleague rewrote the spec') }, unset: [] }]);
    check('a save from elsewhere (the tray in another tab, a colleague) simply appears', await until(() => /a colleague rewrote/.test(pm().getText()), 6000) && state() === 'saved', pm().getText());
    await post([{ type: 'record.update', id: rec, set: { name: 'Texted ProRes HDR' }, unset: [] }]);
    check('a renamed record renames the context line and the tab', await until(() => page().find('.record-crumb').text() === 'Texted ProRes HDR' && win.document.title === 'Texted ProRes HDR — Spec', 6000), win.document.title);

    console.log('\nN3. leaving by the record link: into the shell, words kept');
    pm().commands.setContent(para('written on the page, saved on the way out'));
    await until(() => state() === 'unsaved');
    win.location.hash = page().find('.record-crumb').attributes('href')!; win.dispatchEvent(new (win as any).HashChangeEvent('hashchange'));
    check('the shell is drawn, on the table, with the record in the tray',
      await until(() => w.find('.gridview').exists() && w.find('.record-panel .rp-title').text() === 'Texted ProRes HDR', 10000) && !w.find('.note-page').exists(),
      `grid=${w.find('.gridview').exists()} panel=${w.find('.record-panel').exists()} hash=${win.location.hash}`);
    check('the editor going away saved its words (as the tray\'s does)', /saved on the way out/.test(JSON.stringify((await ui.untilDb(`select data->'spec' v from records where id = '${rec}'`, (r) => /on the way out/.test(JSON.stringify(r[0]?.v))))[0]?.v)));
    check('the tab has its own name back', win.document.title !== 'Texted ProRes HDR — Spec', win.document.title);
    check('and THIS place is remembered', win.localStorage.getItem('spatialdb.lastRoute') === `#/all/table/${tDel}?r=${rec}`, String(win.localStorage.getItem('spatialdb.lastRoute')));

    console.log('\nN4. the ways in');
    const panel = () => w.find('.record-panel');
    const links = () => panel().findAll('a.open-note');
    check('the tray: "open ↗" on each rich text field, a real link to its page in a new tab',
      await until(() => links().length === 2) && links()[0].attributes('href') === formatNote({ record: rec, field: fSpec }) && links()[1].attributes('href') === formatNote({ record: rec, field: fNotes })
        && links()[0].attributes('target') === '_blank' && /open/.test(links()[0].text()),
      links().map((l: any) => l.attributes('href')).join(' '));
    const row = () => w.findAll('.gridview tr.row').find((r: any) => /DCP/.test(r.text()))!;
    await row().trigger('contextmenu', { clientX: 50, clientY: 50 });
    await until(() => w.find('.row-menu').exists());
    const items = () => w.findAll('.row-menu .open-note');
    check('the row menu: one item per rich text field', items().length === 2 && /Spec/.test(items()[0].text()) && /QC notes/.test(items()[1].text()), items().map((i: any) => i.text()).join(' | '));
    await items()[1].trigger('click');
    check('choosing one opens THAT record\'s note in a new tab, and closes the menu', opened.length === 1 && opened[0] === formatNote({ record: other, field: fNotes }) && !w.find('.row-menu').exists(), opened.join(' '));

    console.log('\nN5. addresses that lead nowhere say so');
    const go = async (hash: string) => { win.location.hash = hash; win.dispatchEvent(new (win as any).HashChangeEvent('hashchange')); await sleep(50); };
    await go(formatNote({ record: randomUUID(), field: fSpec }));
    check('a record that is not there', await until(() => /no longer exists/.test(w.find('.note-problem').text()), 6000), w.find('.note-page').exists() ? w.find('.note-page').text() : 'no page');
    await go(formatNote({ record: rec, field: fName }));
    check('a field that is not rich text', await until(() => /not a rich text field/.test(w.find('.note-problem').text())), w.find('.note-page').text());
    await go(formatNote({ record: rec, field: randomUUID() }));
    check('a field that is not there', await until(() => /does not lead to a field/.test(w.find('.note-problem').text())), w.find('.note-page').text());
    await go(formatNote({ record: rec, field: fNotes }));
    check('and an EMPTY note is just an empty page to write on', await until(() => w.find('.note-page .rte.page .ProseMirror').exists() && w.find('.field-crumb').text() === 'QC notes', 6000));

    console.log('\nN6. the desktop app: no new tabs, so no ways in');
    await go(`#/all/table/${tDel}?r=${rec}`);
    await until(() => w.find('.record-panel').exists());
    (globalThis as any).__TAURI__ = { core: { invoke: async () => null }, webview: { getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }) } };
    await row().trigger('contextmenu', { clientX: 50, clientY: 50 });
    await until(() => w.find('.row-menu').exists());
    check('the row menu offers none', w.find('.row-menu').exists() && w.findAll('.row-menu .open-note').length === 0);
    (globalThis as any).__TAURI__ = undefined;
  } finally {
    (globalThis as any).__TAURI__ = undefined;
    await ui.close();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
