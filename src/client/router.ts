/**
 * Where you are, as a URL.
 *
 *     #/                              home
 *     #/s/<section>/table/<tableId>   a table, inside a section
 *     #/all/canvas/<canvasId>         a canvas, under "Everything"
 *     …?r=<recordId>                  with that record's panel open
 *     …?sc=<recordId|none>            scoped to that project (or to Unassigned)
 *
 * The app had no addresses: which tab, table and canvas you were on lived in
 * component refs, so reload lost your place, the back button left the app, and
 * "look at this record" could only be said out loud. A hash route fixes all
 * three and is what makes a breadcrumb honest — each crumb is a real place.
 *
 * HASH routing rather than path routing, on purpose: it needs nothing from the
 * server (no catch-all route, no Vite config), it works unchanged when the Tauri
 * client loads the app from a file, and there is no router dependency — this file
 * is the whole thing.
 *
 * Ids, not names, are the identity in a URL: a renamed table must not break a
 * bookmark. A section's segment is `<slug>-<id>`; the slug is decoration and is
 * ignored when parsing, so an old link survives a rename too.
 */

export type ViewName = 'canvas' | 'table';
const VIEWS: readonly ViewName[] = ['canvas', 'table'];
/** Addresses from when Schema, Undo and History were tabs. They land on the table;
 *  App.vue also opens Settings (where History lives) for the last two. */
const OLD_VIEWS: Record<string, ViewName> = { schema: 'table', undo: 'table', history: 'table' };

export interface Route {
  /** null = the home page. 'all' = the built-in "Everything" section. */
  section: string | 'all' | null;
  view: ViewName;
  /** The table or canvas open in that view, if any. */
  target: string;
  /** The record whose panel is open, if any. */
  record: string;
  /** The scope ('' = All, 'none' = Unassigned, or a record id) — so a LINK can say "Duke's files". */
  scope: string;
}

export const HOME: Route = { section: null, view: 'table', target: '', record: '', scope: '' };

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

export function formatRoute(r: Route, sectionName = ''): string {
  if (r.section === null) return '#/';
  const head = r.section === 'all' ? 'all' : `s/${[slug(sectionName), r.section].filter(Boolean).join('-')}`;
  const path = ['#', head, r.view, ...(r.target ? [r.target] : [])].join('/');
  const q = [r.scope ? `sc=${r.scope}` : '', r.record ? `r=${r.record}` : ''].filter(Boolean).join('&');
  return q ? `${path}?${q}` : path;
}

export function parseRoute(hash: string): Route {
  const [path, query = ''] = hash.replace(/^#\/?/, '').split('?');
  const parts = path.split('/').filter(Boolean);
  if (!parts.length) return { ...HOME };
  let section: Route['section'];
  let rest: string[];
  if (parts[0] === 'all') { section = 'all'; rest = parts.slice(1); }
  else if (parts[0] === 's' && parts[1]) {
    const id = UUID.exec(parts[1])?.[0];
    if (!id) return { ...HOME };            // a mangled link goes home rather than somewhere wrong
    section = id; rest = parts.slice(2);
  } else return { ...HOME };
  const view = VIEWS.includes(rest[0] as ViewName) ? (rest[0] as ViewName) : OLD_VIEWS[rest[0]] ?? 'table';
  const target = UUID.test(rest[1] ?? '') ? rest[1] : '';
  const params = new URLSearchParams(query);
  const rec = params.get('r') ?? '', sc = params.get('sc') ?? '';
  return { section, view, target, record: UUID.test(rec) ? rec : '', scope: sc === 'none' || UUID.test(sc) ? sc : '' };
}

export const sameRoute = (a: Route, b: Route) =>
  a.section === b.section && a.view === b.view && a.target === b.target && a.record === b.record && a.scope === b.scope;
