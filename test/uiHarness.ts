/**
 * Mounting the real App in a simulated DOM — shared by the UI suites.
 *
 * `test/ui.ts` grew this inline and is long enough to sit near a five-minute
 * budget, so newer UI suites (sections, and whatever follows) start from here
 * instead of making that file longer. ui.ts still has its own copy of this
 * bootstrap; folding it onto this helper is a safe, mechanical change worth doing
 * the next time that file is open for another reason.
 *
 * What it is and is not is described at the top of test/ui.ts: happy-dom has no
 * layout and no paint. It can tell you what rendered and what a click did; it
 * cannot tell you where anything is.
 */

import pg from 'pg';
import { Window } from 'happy-dom';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootServer, type ServerHandle } from './harness.js';

export interface Ui {
  w: any; win: Window; pool: pg.Pool; API: string; server: ServerHandle; nav: Nav;
  until: (predicate: () => boolean, ms?: number) => Promise<boolean>;
  untilDb: (sql: string, ok: (rows: any[]) => boolean, ms?: number) => Promise<any[]>;
  post: (mutations: unknown[]) => Promise<Response>;
  setPrompt: (answer: string) => void;
  close: () => Promise<void>;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * INTENT-level navigation for the UI suites: "open this table", "switch scope",
 * "make a canvas called X". The suites used to reach for the shell's selectors
 * directly (`select.table-picker`, `.tabs button`…), and when the header became a
 * tree with tabs, ~60 lines across three files broke at once. They go through
 * here now, so the next change to the shell is a change to THIS function.
 *
 * DIALOGS: the app's own (client/dialogs.ts) replaced prompt()/confirm(). The
 * autopilot below answers them the way the old global stubs did — text dialogs
 * with `dialogs.text`, confirms with yes — but by driving the real dialog's DOM,
 * so the dialog itself is exercised by every test that opens one.
 */
export function navigator(w: any, until: (p: () => boolean, ms?: number) => Promise<boolean>) {
  const dialogs = { text: '', checks: {} as Record<string, boolean>, choice: '', seen: [] as string[], cancelNext: false };
  let busy = false;
  const pilot = setInterval(async () => {
    if (busy) return;
    const d = w.find('.dlg');
    if (!d.exists()) return;
    busy = true;
    try {
      dialogs.seen.push(d.find('h2').text());
      if (dialogs.cancelNext) { dialogs.cancelNext = false; await d.find('.dlg-cancel').trigger('click'); return; }
      if (d.find('.dlg-input').exists()) await d.find('.dlg-input').setValue(dialogs.text);
      if (dialogs.choice && d.find('.dlg-select').exists()) await d.find('.dlg-select').setValue(dialogs.choice);
      for (const box of d.findAll('.dlg-check')) {
        const key = Object.keys(dialogs.checks).find((k) => box.text().toLowerCase().includes(k));
        if (key) await box.find('input').setValue(dialogs.checks[key]);
      }
      await d.find('.dlg-ok').trigger('click');
    } finally { dialogs.checks = {}; dialogs.choice = ''; busy = false; }
  }, 20);

  const row = (sel: string) => w.find(`.tree ${sel}`);
  let lastTable = '', lastCanvas = '';
  return {
    dialogs,
    stop: () => clearInterval(pilot),
    /**
     * There is no tab bar any more — the tree IS the navigation. The suites still
     * say "go back to the table" / "go to the canvas" in dozens of places, so this
     * does what a person now does: click the table (or canvas) they had open, in
     * the tree. 'history' opens Settings, where History lives.
     */
    tab: async (name: 'canvas' | 'table' | 'history') => {
      if (w.find('.settings').exists()) await w.find('.settings .x').trigger('click');
      if (name === 'history') { await w.find('.tree .settings-btn').trigger('click'); return; }
      // Remember where we were… (`.attributes()` throws on a wrapper that matched nothing)
      if (row('.table-row.on').exists()) lastTable = row('.table-row.on').attributes('data-table') ?? lastTable;
      if (row('.canvas-row.on').exists()) lastCanvas = row('.canvas-row.on').attributes('data-canvas') ?? lastCanvas;
      const want = name === 'table' ? `[data-table="${lastTable}"]` : `[data-canvas="${lastCanvas}"]`;
      const fallback = name === 'table' ? '.table-row' : '.canvas-row';
      const target = row(want).exists() ? row(want) : row(fallback);             // …or the first one, as the app does
      if (target.exists()) await target.trigger('click');
    },
    section: async (key: string) => { await until(() => row(`[data-section="${key}"]`).exists()); await row(`[data-section="${key}"]`).trigger('click'); },
    scope: async (value: string) => { await until(() => row(`[data-scope="${value}"]`).exists()); await row(`[data-scope="${value}"]`).trigger('click'); },
    openTable: async (id: string) => { await until(() => row(`[data-table="${id}"]`).exists()); await row(`[data-table="${id}"]`).trigger('click'); },
    openCanvas: async (id: string) => { await until(() => row(`[data-canvas="${id}"]`).exists()); await row(`[data-canvas="${id}"]`).trigger('click'); },
    dockTable: async (id: string) => { await until(() => row(`[data-table="${id}"] .dock-it`).exists()); await row(`[data-table="${id}"] .dock-it`).trigger('click'); },
    tableSettings: async (id: string) => { await row(`[data-table="${id}"] .act:last-child`).trigger('click'); },
    currentTable: () => (row('.table-row.on').exists() ? row('.table-row.on').attributes('data-table') : ''),
    currentCanvas: () => (row('.canvas-row.on').exists() ? row('.canvas-row.on').attributes('data-canvas') : ''),
    currentScope: () => (row('.scope-row.on').exists() ? row('.scope-row.on').attributes('data-scope') : undefined),
    currentSection: () => (row('.section.on').exists() ? row('.section.on').attributes('data-section') : undefined),
    tableNames: () => w.findAll('.tree .table-row .name').map((x: any) => x.text()),
    canvasNames: () => w.findAll('.tree .canvas-row .name').map((x: any) => x.text()),
    scopeNames: () => w.findAll('.tree .scope-row').map((x: any) => x.text().replace(/[▸▾]/g, '').trim()),
    newTable: async (name: string, boards = false) => { dialogs.text = name; dialogs.checks = { boards }; await row('.new-table-btn').trigger('click'); },
    newCanvas: async (name: string) => { dialogs.text = name; await row('.new-canvas-btn').trigger('click'); },
  };
}
export type Nav = ReturnType<typeof navigator>;

export async function mountApp(port: number, startHash = '', env: Record<string, string> = {}): Promise<Ui> {
  const API = `http://localhost:${port}`;
  const assets = mkdtempSync(join(tmpdir(), 'spatialdb-uih-assets-'));
  process.env.SPATIALDB_ASSETS_DIR = assets;

  const win = new Window({ url: `${API}/${startHash}` });
  for (const key of Object.getOwnPropertyNames(win)) {
    if (key in globalThis) continue;
    try { Object.defineProperty(globalThis, key, { value: (win as any)[key], configurable: true, writable: true }); }
    catch { /* non-configurable on this Node */ }
  }
  Object.assign(globalThis, { window: win, document: win.document });
  const nodeFetch = globalThis.fetch;
  // A one-cookie jar. Node's fetch keeps no cookies, and the app's identity IS a
  // cookie: without this the app would sign in and be signed out on its next request.
  let jar = '';
  globalThis.fetch = (async (u: any, o: any = {}) => {
    const res = await nodeFetch(typeof u === 'string' && u.startsWith('/') ? API + u : u,
      { ...o, headers: { ...(o.headers ?? {}), ...(jar ? { Cookie: jar } : {}) } });
    const set = res.headers.get('set-cookie');
    if (set) { const [pair] = set.split(';'); jar = pair.endsWith('=') ? '' : pair; }
    if (process.env.UI_TRACE) console.log(`   [fetch] ${o.method ?? 'GET'} ${String(u).replace(API, '').slice(0, 50)} -> ${res.status}${set ? ' (set-cookie)' : ''} jar=${jar.slice(-6)}`);
    return res;
  }) as typeof fetch;

  const pool = new pg.Pool({ connectionString: process.env.DB_URL });
  await pool.query(`truncate tables, canvases, mutations, sections cascade`);
  if (!(await pool.query(`select 1 from users limit 1`)).rowCount) {
    await pool.query(`insert into users (email, name, role) values ('ui@local','UI','admin')`);
  }
  const server = await bootServer(port, env);

  const { build } = await import('vite');
  await build({
    logLevel: 'error',
    build: { lib: { entry: 'src/client/App.vue', formats: ['es'], fileName: 'app' }, outDir: '.uitest', emptyOutDir: true, minify: false,
      rollupOptions: { external: ['vue'] } },
  });
  const { mount } = await import('@vue/test-utils');
  const App = (await import('../.uitest/app.js' as string)).default;

  const until = async (predicate: () => boolean, ms = 4000) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) { try { if (predicate()) return true; } catch { /* not rendered yet */ } await sleep(25); }
    return false;
  };
  const untilDb = async (sql: string, ok: (rows: any[]) => boolean, ms = 5000) => {
    const deadline = Date.now() + ms;
    let rows: any[] = [];
    while (Date.now() < deadline) { rows = (await pool.query(sql)).rows; if (ok(rows)) break; await sleep(50); }
    return rows;
  };
  const { randomUUID } = await import('node:crypto');
  const post = (mutations: unknown[]) => nodeFetch(`${API}/api/mutate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: randomUUID(), mutations: mutations.map((mutation) => ({ id: randomUUID(), mutation })) }) });

  const w = mount(App, { attachTo: win.document.body as unknown as Element });
  const nav = navigator(w, until);
  return {
    w, win, pool, API, server, until, untilDb, post, nav,
    setPrompt: (a) => { nav.dialogs.text = a; },
    close: async () => { nav.stop(); w.unmount(); await server.stop(); await pool.end(); rmSync(assets, { recursive: true, force: true }); },
  };
}
