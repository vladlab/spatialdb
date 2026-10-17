/**
 * Cell copy/paste, the INVENTORY (Oct 17): every field type in FIELD_TYPES and
 * every structured shape copies, and pastes into a like field — walked by the
 * contract's own lists, so a new type cannot ship un-copyable (video layout did,
 * for sixteen days). Then the grid's RANGE: one copied value into many cells,
 * one Ctrl+Z; Delete over a range; what a range of mixed types reports.
 *
 * test/duplicate.ts keeps the original Sept 30 cases (the refusals, outside text).
 */
import { randomUUID } from 'node:crypto';
import { mountApp, sleep } from './uiHarness.js';
import { FIELD_TYPES } from '../src/contract/mutations.js';
import { FIELD_FORM_SHAPES } from '../src/contract/shapes.js';

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

async function main() {
  const ui = await mountApp(Number(process.env.TEST_PORT ?? 8842));
  const { w, win, pool, until, untilDb, post, API } = ui;
  // Imported AFTER the window exists: cellClipboard pulls in vue, and @vue/runtime-dom
  // captures `document` at import time — null here before mountApp has made one.
  const { clipOf, pasteCell, pasteCells, describePaste, uncopyable } = await import('../src/client/cellClipboard.js');
  try {
    // One asset, so an attachment value is real (the server checks assets exist).
    const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), u32(13), Buffer.from('IHDR'), u32(16), u32(16), Buffer.from([8, 6, 0, 0, 0]), Buffer.from('clipboard')]);
    const up = await fetch(`${API}/api/assets?name=shot.png`, { method: 'POST', body: png as unknown as BodyInit, headers: { 'Content-Type': 'application/octet-stream' } });
    const asset = (await up.json()).id as string;
    check('an asset to attach', (up.status === 201 || up.status === 200) && typeof asset === 'string', String(up.status));

    const tWorks = randomUUID(), tA = randomUUID(), tJ = randomUUID();
    const ep1 = randomUUID(), ep2 = randomUUID(), a = randomUUID(), b = randomUUID(), c = randomUUID(), d = randomUUID();
    const pos = (id: string, position: number) => ({ type: 'field.update', id, position });
    // Every field type, on one table "Items" — the inventory walks FIELD_TYPES itself,
    // so a type added to the contract without a line here FAILS the walk below.
    const F: Record<string, string> = {};
    const fieldFor = (type: string, key: string, options: Record<string, unknown> = {}) => { F[key] = randomUUID(); return { type: 'field.create', id: F[key], tableId: tA, name: key, key, fieldType: type, options }; };
    const fWName = randomUUID(), fWItems = randomUUID();
    const setup = await post([
      { type: 'table.create', id: tWorks, name: 'Works', singularName: 'Work' },
      { type: 'table.create', id: tA, name: 'Items', singularName: 'Item' },
      { type: 'field.create', id: fWName, tableId: tWorks, name: 'Name', key: 'name', fieldType: 'text' }, pos(fWName, 0),
      fieldFor('text', 'name'), fieldFor('long_text', 'notes'), fieldFor('number', 'n'), fieldFor('select', 'status', { choices: ['todo', 'done'] }),
      fieldFor('multi_select', 'tags', { choices: ['hdr', 'sdr'] }), fieldFor('date', 'due'), fieldFor('checkbox', 'ok'),
      fieldFor('link', 'work', { target_table_id: tWorks }), fieldFor('file_path', 'path'), fieldFor('dimensions', 'size'),
      fieldFor('rich_text', 'doc'), fieldFor('attachment', 'files'),
      ...FIELD_FORM_SHAPES.map((shape) => fieldFor('structured', `s_${shape}`, { shape })),
      { type: 'record.create', id: ep1, tableId: tWorks, data: { name: 'Ep 101' } }, { type: 'record.create', id: ep2, tableId: tWorks, data: { name: 'Ep 102' } },
    ]);
    check('fixture accepted', setup.status === 200, (await setup.text()).slice(0, 300));
    // Lookup and backlink need the link to exist first; a backlink on Works mirrors Items.work.
    const more = await post([
      fieldFor('lookup', 'work_name', { via_field_id: F.work, target_field_id: fWName }),
      { type: 'field.create', id: fWItems, tableId: tWorks, name: 'Items', key: 'items', fieldType: 'backlink', options: { source_field_id: F.work } },
    ]);
    check('lookup + backlink accepted', more.status === 200, (await more.text()).slice(0, 300));

    const values: Record<string, unknown> = {
      name: 'a.mov', notes: 'two\nlines', n: 23.976, status: 'done', tags: ['hdr', 'sdr'], due: '2026-10-17', ok: true, path: '/mnt/x/a.mov', size: '1920×1080',
      doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }] }, files: [asset],
      s_manifest: { kind: 'file', size: 1234 },
      s_audio_layout: { tracks: [{ name: 'Stereo', channels: ['L', 'R'] }] },
      s_video_layout: { rate: 23.976, drop: false, items: [{ label: 'black', start: '00:59:57:00', duration: '00:00:03:00' }, { label: 'picture', duration: 'open' }] },
      s_json: { any: 'thing', n: 1 },
    };
    const recs = await post([
      { type: 'record.create', id: a, tableId: tA, data: values },
      { type: 'record.create', id: b, tableId: tA, data: { name: 'b.mov' } },
      { type: 'record.create', id: c, tableId: tA, data: { name: 'c.mov' } },
      { type: 'record.create', id: d, tableId: tA, data: { name: 'd.mov', status: 'todo' } },
      { type: 'link.add', id: randomUUID(), fieldId: F.work, fromRecord: a, toRecord: ep1 },
      { type: 'link.add', id: randomUUID(), fieldId: F.work, fromRecord: a, toRecord: ep2 },
    ]);
    check('records accepted (every value valid)', recs.status === 200, (await recs.text()).slice(0, 400));

    win.location.hash = `#/all/table/${tA}`; win.dispatchEvent(new (win as any).HashChangeEvent('hashchange'));
    await until(() => w.findAll('.gridview tr.row').length === 4, 8000);
    const st = (w.vm as any).store ?? (w.vm as any).$.setupState?.store;
    if (!st) throw new Error('no store on the app vm: ' + Object.keys((w.vm as any).$?.setupState ?? {}).slice(0, 20).join());
    const field = (key: string) => st.state.fields.get(F[key]);
    const label = (id: string) => st.state.records.get(id)?.data?.name ?? id;

    console.log('\nC1. The inventory: every type in FIELD_TYPES copies; every pastable one round-trips into a like field');
    const SYSTEM = new Set(['created_at', 'created_by']);
    const COPY_ONLY = new Set(['lookup']);
    for (const type of FIELD_TYPES) {
      if (SYSTEM.has(type)) continue;   // below: they copy from the system columns
      const keys = type === 'structured' ? FIELD_FORM_SHAPES.map((s) => `s_${s}`) : type === 'backlink' ? ['__backlink'] : Object.keys(values).concat('work_name', 'work').filter((k) => field(k)?.type === type);
      check(`${type}: a field exists in the fixture`, keys.length > 0 && keys.every((k) => k === '__backlink' || !!field(k)), keys.join());
      for (const k of keys) {
        if (k === '__backlink') {
          const bf = st.state.fields.get(fWItems);
          const clip = clipOf(st, ep1, bf, label);
          check('backlink: copies the records that point here, as their names (a.mov, and b — renamed a.mov by the text paste above)', !!clip && (clip.value as string[]).includes(a) && /a\.mov/.test(clip.text) && clip.targetTable === tA, JSON.stringify(clip));
          const err = pasteCell(st, ep2, bf, clip!);
          check('…and pastes into another record\'s backlink: a.mov now points at Ep 102 too (written through the link face)', err === null);
          await untilDb(`select count(*)::int n from links where field_id='${F.work}' and from_record='${a}' and to_record='${ep2}'`, (x) => x[0].n === 1, 4000);
          // The faces are one group, told apart by the FAR table: Items.work names Works, Works.items names Items.
          const lclip = clipOf(st, a, field('work'), label)!;
          check('a link and a backlink are one group — a paste across them is refused only by the far table (Works ≠ Items here)', lclip.targetTable === tWorks && /different table/.test(pasteCell(st, ep1, bf, lclip) ?? ''));
          continue;
        }
        const f = field(k);
        const clip = clipOf(st, a, f, label, k === 'work_name' ? 'Ep 101, Ep 102' : undefined);
        check(`${type}${type === 'structured' ? ` (${k.slice(2)})` : ''}: copies — with text for the outside world`, !!clip && typeof clip.text === 'string' && (clip.text.length > 0), JSON.stringify(clip));
        if (COPY_ONLY.has(type)) {
          const err = pasteCell(st, b, f, clip!);
          check(`${type}: nothing pastes INTO it, and the refusal says why`, typeof err === 'string' && /looked up/.test(err), String(err));
          continue;
        }
        const err = pasteCell(st, b, f, clip!);
        check(`${type}${type === 'structured' ? ` (${k.slice(2)})` : ''}: pastes into the like field of another record`, err === null, String(err));
      }
    }
    // Everything landed on b: the server accepted each (the save queue would have dropped a refused one with a notice).
    const bRow = await untilDb(`select data from records where id='${b}'`, (x) => x[0]?.data?.s_video_layout !== undefined && x[0]?.data?.files !== undefined && x[0]?.data?.doc !== undefined, 8000);
    const bd = bRow[0].data;
    const canon = (v: unknown): unknown => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])])) : v);
    const same = (k: string) => JSON.stringify(canon(bd[k])) === JSON.stringify(canon(values[k]));
    check('…and the server has them all, byte for byte (video layout, audio layout, manifest, json, rich text, attachment, the plain ones)',
      ['notes', 'n', 'status', 'tags', 'due', 'ok', 'path', 'size', 'doc', 'files', 's_manifest', 's_audio_layout', 's_video_layout', 's_json'].every(same), JSON.stringify(bd));
    const bl = await untilDb(`select to_record from links where from_record='${b}' and field_id='${F.work}'`, (x) => x.length === 2, 4000);
    check('…links included', bl.length === 2);
    check('no notice complained along the way', !/cannot be copied|Not pasted/.test(w.find('.desk-notices').exists() ? w.find('.desk-notices').text() : ''), w.find('.desk-notices').exists() ? w.find('.desk-notices').text() : '');

    console.log('\nC1b. The system columns copy as text; nothing pastes into them');
    const sysFields = [...st.state.fields.values()].filter((f: any) => f.table_id === tA && SYSTEM.has(f.type));
    const created = { ...st.state.fields.values().next().value, id: 'sys-created', key: '_created_at', type: 'created_at', name: 'Created', table_id: tA, options: {} };
    const by = { ...created, id: 'sys-by', key: '_created_by', type: 'created_by', name: 'Created by' };
    const rec = st.state.records.get(a);
    check('the record carries its system values', typeof rec.data._created_at === 'string' && typeof rec.data._created_by === 'string', JSON.stringify(Object.keys(rec.data)));
    const cc = clipOf(st, a, created, (id) => (id === rec.data._created_by ? 'Dev' : id));
    const cb = clipOf(st, a, by, (id) => (id === rec.data._created_by ? 'Dev' : id));
    check('created_at copies as the formatted date; created_by as the person\'s name', !!cc && /\d/.test(cc.text) && cb?.text === 'Dev', `${cc?.text} / ${cb?.text}`);
    check('…and neither takes a paste (set by the system)', /system/.test(pasteCell(st, b, created, cc!) ?? '') && /system/.test(pasteCell(st, b, by, cb!) ?? ''));
    void sysFields;

    console.log('\nC2. A RANGE in the grid: one value into many cells, one Ctrl+Z');
    await post([{ type: 'record.update', id: b, set: { name: 'b.mov', status: 'todo' }, unset: [] }, { type: 'record.update', id: c, set: {}, unset: ['status'] }]);   // names back; b was renamed by the text paste
    await until(() => w.findAll('.gridview tr.row').some((x: any) => x.text().includes('b.mov')), 8000);
    const rowOf = (name: string) => w.findAll('.gridview tr.row').find((x: any) => x.find('td.num').exists() && x.text().includes(name));
    const ths = () => w.findAll('.gridview th').map((t: any) => t.text().replace(/[⚙▾▴]/g, '').trim());
    const colOf = (lbl: string) => ths().findIndex((t: string) => t === lbl || t.startsWith(lbl));
    const cell = (name: string, lbl: string) => { const r = rowOf(name); if (!r) throw new Error(`no row ${name}: ${w.findAll('.gridview tr.row').map((x: any) => x.text().slice(0, 30)).join(' | ')}`); const i = colOf(lbl); if (i < 0) throw new Error(`no column ${lbl}: ${ths().join(',')}`); return r.findAll('td')[i]!; };
    const grid = () => w.find('.gridview .scroller');
    const key = (k: string, opts: Record<string, unknown> = {}) => grid().trigger('keydown', { key: k, ...opts });
    let sysClip = '';
    const clipboardData = { setData: (_t: string, v: string) => { sysClip = v; }, getData: () => sysClip };
    const copyKey = () => grid().trigger('copy', { clipboardData });
    const pasteKey = () => grid().trigger('paste', { clipboardData });

    await cell('a.mov', 'status').trigger('mousedown', { button: 0 });
    await copyKey();
    check('copied "done"', sysClip === 'done', sysClip);
    await cell('b.mov', 'status').trigger('mousedown', { button: 0 });
    await key('ArrowDown', { shiftKey: true });
    await key('ArrowDown', { shiftKey: true });
    check('Shift+↓ twice: three cells in the range, the anchor still the selected cell', w.findAll('.gridview td.rng').length === 3 && cell('b.mov', 'status').classes('sel') && cell('d.mov', 'status').classes('rng'), String(w.findAll('.gridview td.rng').length));
    await pasteKey();
    await untilDb(`select count(*)::int n from records where table_id='${tA}' and data->>'status'='done'`, (x) => x[0].n === 4, 8000);
    check('one paste filled all three (b, c, d — d was "todo")', true);
    check('the notice counts them', /Pasted into 3 cells/.test(w.find('.desk-notices').text()), w.find('.desk-notices').text());
    await key('z', { ctrlKey: true });
    await untilDb(`select count(*)::int n from records where table_id='${tA}' and data->>'status'='done'`, (x) => x[0].n === 1, 8000);
    await until(() => !w.find('.gridview td.rng').exists() || true);
    const dStatus = (await pool.query(`select data->>'status' s from records where id=$1`, [d])).rows[0].s;
    check('ONE Ctrl+Z undoes all three — d is "todo" again', dStatus === 'todo', String(dStatus));

    console.log('\nC2b. A mixed range: the cells that take the value take it, the rest are counted');
    await cell('a.mov', 'notes').trigger('mousedown', { button: 0 });   // off the cell first: a second press on the selected cell would EDIT it
    await cell('b.mov', 'status').trigger('mousedown', { button: 0 });
    await key('ArrowDown', { shiftKey: true });
    await key('ArrowRight', { shiftKey: true });   // status + tags, rows b and c: a select into a multi-select is refused
    check('a 2×2 range', w.findAll('.gridview td.rng').length === 4, String(w.findAll('.gridview td.rng').length));
    await pasteKey();
    await untilDb(`select count(*)::int n from records where id in ('${b}','${c}') and data->>'status'='done'`, (x) => x[0].n === 2, 8000);
    check('the two selects took it; the notice says 2 pasted, 2 skipped and why', /Pasted into 2 cells · 2 cells skipped: a select value cannot be pasted into a multi select field/.test(w.find('.desk-notices').text()), w.find('.desk-notices').text());
    await key('Escape');
    check('Escape drops the range first (the cell stays selected)', w.findAll('.gridview td.rng').length === 0 && cell('b.mov', 'status').classes('sel'));

    console.log('\nC2c. Shift+click sets the far corner; Delete clears the range');
    await cell('a.mov', 'notes').trigger('mousedown', { button: 0 });
    await cell('b.mov', 'status').trigger('mousedown', { button: 0 });
    await cell('d.mov', 'status').trigger('mousedown', { button: 0, shiftKey: true });
    check('Shift+click: b..d', w.findAll('.gridview td.rng').length === 3 && !w.find('.gridview td.editing').exists());
    await key('Delete');
    await untilDb(`select count(*)::int n from records where table_id='${tA}' and data->>'status' is not null`, (x) => x[0].n === 1, 8000);
    check('Delete cleared all three statuses (a.mov keeps its own)', true);
    await key('z', { ctrlKey: true });
    await untilDb(`select count(*)::int n from records where table_id='${tA}' and data->>'status' is not null`, (x) => x[0].n === 4, 8000);
    check('…one Ctrl+Z brings them back', true);

    console.log('\nC3. describePaste / uncopyable, as text');
    check('describePaste phrasing', describePaste({ pasted: 6, refused: new Map() }) === 'Pasted into 6 cells' && describePaste({ pasted: 1, refused: new Map() }) === 'Pasted into 1 cell'
      && describePaste({ pasted: 0, refused: new Map([['x', 2]]) }) === 'Not pasted: x' && describePaste({ pasted: 2, refused: new Map([['x', 1], ['y', 2]]) }) === 'Pasted into 2 cells · 3 cells skipped: 1 × x; 2 × y');
    check('uncopyable: every real type copies (null), only a junction column does not', [...st.state.fields.values()].filter((f: any) => f.table_id === tA || f.table_id === tWorks).every((f: any) => uncopyable(st, f) === null));
    void pasteCells; void tJ; void sleep;
  } finally {
    console.log(`\n${pass} passed, ${fail} failed\n`);
    await ui.close();
  }
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); console.log('\nSUITE ABORTED — an exception ended it early; the tally above is incomplete\n'); process.exit(1); });
