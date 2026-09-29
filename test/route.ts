/**
 * Cold starts: the app opened ON an address — which is what every reload is, and
 * what "back" into the app is. The address bar was right all along; the app was
 * writing "#/" over it during hydration, a tick before reading it (App.vue, the
 * `applying` note). Nothing here ever mounted on a deep link, so nothing noticed.
 * Also: a bare address (no hash) opens where you last were.
 */
import { randomUUID } from 'node:crypto';
import { mountApp } from './uiHarness.js';
import { startHash } from '../src/client/router.js';

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

async function main() {
  console.log('\nR0. startHash (client/router.ts)');
  const T = randomUUID();
  check('an address in the bar wins', startHash(`#/all/table/${T}`, '#/all/canvas/x') === `#/all/table/${T}`);
  check('"#/" in the bar is Home, on purpose — not the remembered place', startHash('#/', `#/all/table/${T}`) === '#/');
  check('no hash: the remembered place', startHash('', `#/all/table/${T}`) === `#/all/table/${T}`);
  check('no hash and nothing remembered (or Home remembered): Home', startHash('', '') === '#/' && startHash('', '#/') === '#/');
  check('a remembered address that does not parse to a place is not followed', startHash('', '#/garbage') === '#/');

  console.log('\nR1. A reload lands where you were');
  const tFiles = randomUUID(), fName = randomUUID(), rec = randomUUID();
  const ui = await mountApp(Number(process.env.TEST_PORT ?? 8819), `#/all/table/${tFiles}?r=${rec}`, {}, async (post) => {
    const r = await post([
      { type: 'table.create', id: tFiles, name: 'Files' },
      { type: 'field.create', id: fName, tableId: tFiles, name: 'Name', key: 'name', fieldType: 'text' },
      { type: 'record.create', id: rec, tableId: tFiles, data: { name: 'zebra.mov' } },
    ]);
    if (r.status !== 200) throw new Error(await r.text());
  });
  const { w, win, until } = ui;
  try {
    check('opened on a table\'s address, the app shows THAT table — not Home',
      await until(() => w.find('.gridview').exists() && w.findAll('.gridview tr.row').length === 1, 8000) && !w.find('section.home').exists(),
      `home=${w.find('section.home').exists()} grid=${w.find('.gridview').exists()} rows=${w.findAll('.gridview tr.row').length} hash=${win.location.hash}`);
    check('…with the record from the address open in the panel',
      await until(() => w.find('.record-panel .rp-title').text() === 'zebra.mov'), w.find('.record-panel').exists() ? w.find('.record-panel').text().slice(0, 60) : 'no panel');
    check('the address bar still says so (nothing overwrote it with "#/")', win.location.hash === `#/all/table/${tFiles}?r=${rec}`, win.location.hash);
    check('and it is remembered as the last place', win.localStorage.getItem('spatialdb.lastRoute') === `#/all/table/${tFiles}?r=${rec}`, String(win.localStorage.getItem('spatialdb.lastRoute')));

    win.location.hash = '#/'; win.dispatchEvent(new (win as any).HashChangeEvent('hashchange'));
    check('going Home is remembered too (a bare address later opens Home, as you left it)',
      await until(() => w.find('section.home').exists()) && win.localStorage.getItem('spatialdb.lastRoute') === '#/', String(win.localStorage.getItem('spatialdb.lastRoute')));
  } finally {
    await ui.close();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
