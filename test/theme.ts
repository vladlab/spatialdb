/**
 * Themes (src/client/theme.css, client/prefs.ts) — the app is dark or light, per browser.
 *
 *   T1  the SHEET: the dark and light blocks name the same tokens, every token a
 *       component reads is defined somewhere, and no component carries a colour of
 *       its own — a hex or a black/white rgba() is a colour only one theme can see.
 *       (Pure: reads the source files. happy-dom has no paint, so this is the only
 *       way a theme can be checked at all.)
 *   T2  the SETTING: the Settings dialog's Theme row switches `data-theme` on <html>,
 *       the choice survives a reload (localStorage), and the dark default needs no
 *       attribute at all.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { mountApp, sleep } from './uiHarness.js';

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(vue|ts|css)$/.test(f) && !f.endsWith('.d.ts')) out.push(p);
  }
  return out;
}
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function sheet() {
  console.log('\nT1. The sheet');
  const css = stripComments(readFileSync('src/client/theme.css', 'utf8'));
  const block = (sel: RegExp) => {
    const m = sel.exec(css); if (!m) return null;
    const open = css.indexOf('{', m.index); const close = css.indexOf('}', open);
    return css.slice(open + 1, close);
  };
  const tokensOf = (body: string) => new Set([...body.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  const dark = block(/:root,\s*:root\[data-theme="dark"\]/), light = block(/:root\[data-theme="light"\]/);
  check('a dark block and a light block exist', !!dark && !!light);
  const D = tokensOf(dark ?? ''), L = tokensOf(light ?? '');
  const onlyDark = [...D].filter((t) => !L.has(t)), onlyLight = [...L].filter((t) => !D.has(t));
  check(`the two blocks define the same ${D.size} tokens`, D.size > 60 && onlyDark.length === 0 && onlyLight.length === 0,
    `dark only: ${onlyDark.join(' ')} · light only: ${onlyLight.join(' ')}`);
  check('each block says its color-scheme', /color-scheme:\s*dark/.test(dark ?? '') && /color-scheme:\s*light/.test(light ?? ''));
  check('the dark block is the default — `:root` with no attribute', /:root,\s*:root\[data-theme="dark"\]/.test(css));

  // Every token a component READS is defined: in the sheet, in a component's own
  // CSS (`--row-bg: …`), or set from script (`'--link-handle': …`).
  const files = walk('src/client');
  const defined = new Set<string>(D);
  const used = new Map<string, string>();
  for (const f of files) {
    const s = stripComments(readFileSync(f, 'utf8'));
    for (const m of s.matchAll(/(--[a-z0-9-]+)\s*:/g)) defined.add(m[1]);
    for (const m of s.matchAll(/['"](--[a-z0-9-]+)['"]\s*:/g)) defined.add(m[1]);
    // `var(--x, fallback)` carries its own default and is not a read of the sheet.
    for (const m of s.matchAll(/var\((--[a-z0-9-]+)\s*\)/g)) if (!used.has(m[1])) used.set(m[1], f);
  }
  const undefinedTokens = [...used].filter(([t]) => !defined.has(t));
  check(`every token read anywhere (${used.size}) is defined somewhere`, undefinedTokens.length === 0, undefinedTokens.map(([t, f]) => `${t} (${f})`).join(', '));

  // No colour of its own. A literal that is DATA is allowed: a colour input's default
  // value, the black/white `textOn` picks for an identity colour, and the one
  // dynamic pill tint built from a relationship's own hex.
  const ALLOWED: Record<string, RegExp[]> = {
    'src/client/colorText.ts': [/'#1a1a1a' : '#f2f2f2'/],
    'src/client/components/TableSettings.vue': [/\|\| '#4a4a4a'/],
    'src/client/components/SectionSettings.vue': [/\|\| '#4a4a4a'/],
    'src/client/components/FieldSettings.vue': [/\?\? '#8a8a8a'/],
    'src/client/components/RecordPill.vue': [/rgba\(\$\{rgb\}/],
  };
  const strays: string[] = [];
  for (const f of files) {
    if (f.endsWith('theme.css')) continue;
    const s = stripComments(readFileSync(f, 'utf8'));
    const lines = s.split('\n');
    lines.forEach((line, i) => {
      const hex = /#[0-9a-fA-F]{3,8}\b/.test(line) && !/url\(|%23/.test(line);
      const rgba = /rgba?\(\s*(255\s*,\s*255\s*,\s*255|0\s*,\s*0\s*,\s*0|\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3})\s*[,)]/.test(line);
      if (!hex && !rgba) return;
      if ((ALLOWED[f] ?? []).some((re) => re.test(line))) return;
      strays.push(`${f}:${i + 1}: ${line.trim().slice(0, 80)}`);
    });
  }
  check('no component carries a hex or an rgb() colour of its own (theme.css has them all)', strays.length === 0, '\n' + strays.join('\n'));

  // The tint classes derive their strengths from the theme's triplet + alpha.
  check('the six tint classes read the theme\'s triplet and alphas', ['green', 'amber', 'red', 'blue', 'violet', 'grey'].every((t) => new RegExp(`\\.tint-${t}\\s*\\{[^}]*--tint-rgb: var\\(--tint-${t}-rgb\\)`).test(css))
    && /--tint-wash: rgba\(var\(--tint-rgb\), var\(--tint-a-wash\)\)/.test(css));

  // index.html sets the attribute before the first paint, from the pref's key.
  const html = readFileSync('index.html', 'utf8');
  const prefs = readFileSync('src/client/prefs.ts', 'utf8');
  const key = /THEME_KEY = '([^']+)'/.exec(prefs)?.[1] ?? '';
  check('index.html applies the saved theme before the first paint, from the key prefs.ts owns', key.length > 0 && html.includes(`localStorage.getItem('${key}')`) && html.includes("setAttribute('data-theme'"), key);
}

async function setting() {
  console.log('\nT2. The setting');
  const ui = await mountApp(Number(process.env.TEST_PORT ?? 8863));
  const { w, win, until } = ui;
  try {
    const html = () => win.document.documentElement;
    check('a fresh browser is dark, with the attribute set', html().getAttribute('data-theme') === 'dark');
    check('the app mounted', await until(() => w.find('.tree .tree-foot .settings-btn').exists(), 8000));
    await w.find('.tree .tree-foot .settings-btn').trigger('click');
    check('Settings has a Theme row with dark and light', await until(() => w.find('.settings .pref.theme').exists())
      && w.findAll('.settings .pref.theme input[type="radio"]').map((r: any) => r.element.value).join() === 'dark,light');
    const light = w.findAll('.settings .pref.theme input[type="radio"]').find((r: any) => r.element.value === 'light');
    await light.setValue(true);
    await sleep(20);
    check('choosing light sets data-theme="light" on <html>', html().getAttribute('data-theme') === 'light', html().getAttribute('data-theme') ?? 'none');
    check('…and remembers it for this browser', win.localStorage.getItem('spatialdb.prefs.theme') === 'light');
    const dark = w.findAll('.settings .pref.theme input[type="radio"]').find((r: any) => r.element.value === 'dark');
    await dark.setValue(true);
    await sleep(20);
    check('back to dark', html().getAttribute('data-theme') === 'dark' && win.localStorage.getItem('spatialdb.prefs.theme') === 'dark');
    // The built stylesheet carries both blocks (the lib build extracts CSS).
    const css = readdirSync('.uitest').filter((f) => f.endsWith('.css')).map((f) => readFileSync(`.uitest/${f}`, 'utf8')).join('\n');
    check('the built stylesheet carries both theme blocks', /\[data-theme="light"\]/.test(css) && /\[data-theme="dark"\]/.test(css));
  } finally {
    await ui.close();
  }
}

sheet();
setting().then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error(e); console.log(`\nSUITE ABORTED — an exception ended it early; the tally above is incomplete`); process.exit(1); });
