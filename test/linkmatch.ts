/**
 * A link field's MATCH (contract/match.ts) — what its picker narrows by.
 *
 *   M1  the rule, pure: what a pair may name, what "agrees" means
 *   M2  the server: refuses a pair in the wrong place, accepts link + backlink sides
 *   M3  the ⚙: one dropdown of the possible pairs; picking one is stored
 *   M4  the grid's picker: agreeing records first and alone, "show all" a tick away;
 *       no opinion → no narrowing; nothing agrees → everything, and it says so
 *   M5  a filter, not a constraint: a link to a record that does not agree is fine
 *   M6  the record tray's picker narrows the same way
 *   M7  two pairs: both must agree; a pair the record has nothing for is skipped
 *   M8  a pair whose field is deleted is inert — shown broken, removable, and the
 *       field's other settings still save
 *
 * The junction's own match runs the same rule: test/junction.ts §5, test/junctionui.ts J2.
 */
import { randomUUID } from 'node:crypto';
import { mountApp } from './uiHarness.js';
import { agrees, hasOpinion, leadsTo, linkMatchError, linkMatchOf, possiblePairs, usablePairs, type MatchFieldLike } from '../src/contract/match.js';

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

async function main() {
  const tWorks = randomUUID(), tFiles = randomUUID(), tDeliv = randomUUID(), tClients = randomUUID();
  const fWName = randomUUID(), fWDeliv = randomUUID();
  const fDName = randomUUID(), fDWorks = randomUUID(), fDClient = randomUUID();
  const fCName = randomUUID();
  const fName = randomUUID(), fWork = randomUUID(), fTarget = randomUUID(), fFClient = randomUUID();

  console.log('\nM1. The rule (contract/match.ts)');
  {
    const fields: MatchFieldLike[] = [
      { id: fWDeliv, table_id: tWorks, type: 'link', options: { target_table_id: tDeliv } },
      { id: fDWorks, table_id: tDeliv, type: 'backlink', options: { source_field_id: fWDeliv } },
      { id: fDClient, table_id: tDeliv, type: 'link', options: { target_table_id: tClients } },
      { id: fDName, table_id: tDeliv, type: 'text', options: {} },
      { id: fWork, table_id: tFiles, type: 'link', options: { target_table_id: tWorks } },
      { id: fFClient, table_id: tFiles, type: 'link', options: { target_table_id: tClients } },
      { id: fTarget, table_id: tFiles, type: 'link', options: { target_table_id: tDeliv } },
    ];
    const get = (id: string) => fields.find((f) => f.id === id);
    const target = (match: unknown): MatchFieldLike => ({ ...get(fTarget)!, options: { target_table_id: tDeliv, match } });
    check('a link leads to its target; a backlink to the table its links are made on; text to nothing',
      leadsTo(get(fWork), get) === tWorks && leadsTo(get(fDWorks), get) === tWorks && leadsTo(get(fDName), get) === null);
    check('a link side and a BACKLINK side may pair when they lead to the same table', linkMatchError(target([[fWork, fDWorks]]), get) === null);
    check('…not when they lead to different tables', /same table/.test(linkMatchError(target([[fWork, fDClient]]), get) ?? ''));
    check('the first field is on the link\'s own table, the second on its target', /own table/.test(linkMatchError(target([[fDClient, fDClient]]), get) ?? '')
      && /points at/.test(linkMatchError(target([[fWork, fWork]]), get) ?? ''));
    check('a plain field cannot be a side', /link or backlink/.test(linkMatchError(target([[fWork, fDName]]), get) ?? ''));
    check('the link cannot be matched on itself; the same pair twice is refused', /itself/.test(linkMatchError(target([[fTarget, fDWorks]]), get) ?? '')
      && /already there/.test(linkMatchError(target([[fWork, fDWorks], [fWork, fDWorks]]), get) ?? ''));
    check('only a link field has a match', /only a link/.test(linkMatchError({ ...get(fDName)!, options: { match: [] } }, get) ?? ''));
    const gone = randomUUID();
    check('a pair naming a field that does not exist is refused when NEW…', /does not exist/.test(linkMatchError(target([[fWork, gone]]), get) ?? ''));
    check('…and left alone when it was already stored (it broke later): the rest of the edit goes through',
      linkMatchError(target([[fWork, gone], [fFClient, fDClient]]), get, [[fWork, gone]]) === null);
    check('usablePairs drops the broken one', usablePairs(target([[fWork, gone], [fFClient, fDClient]]), get).length === 1 && linkMatchOf(target('nonsense')).length === 0);
    check('possiblePairs: every (own, target) pair of link-like fields leading to the same table',
      possiblePairs(get(fTarget)!, fields, get).map((p) => p.join('=')).sort().join() === [`${fWork}=${fDWorks}`, `${fFClient}=${fDClient}`].sort().join());

    const held = (data: Record<string, string[]>) => (r: string, f: string) => data[r + f] ?? [];
    const h = held({ ['a' + fWork]: ['ep1'], ['texted' + fDWorks]: ['ep1', 'ep2'], ['textless' + fDWorks]: ['ep2'] });
    const pairs: Array<[string, string]> = [[fWork, fDWorks], [fFClient, fDClient]];
    check('agrees = the two sides share a record (a deliverable of several Works agrees with a file of one of them)',
      agrees(pairs, 'a', 'texted', h) && !agrees(pairs, 'a', 'textless', h) && !agrees(pairs, 'a', 'trailer', h));
    check('a pair the starting record holds nothing for is skipped — "no opinion", not "nothing qualifies"',
      hasOpinion(pairs, 'a', h) && !hasOpinion(pairs, 'b', h) && agrees(pairs, 'b', 'trailer', h));
  }

  const ui = await mountApp(Number(process.env.TEST_PORT ?? 8841));
  const { w, win, pool, until, untilDb, post } = ui;
  try {
    const ep101 = randomUUID(), ep102 = randomUUID(), ep103 = randomUUID();
    const texted = randomUUID(), textless = randomUUID(), trailer = randomUUID();
    const acme = randomUUID(), bolt = randomUUID();
    const a = randomUUID(), b = randomUUID(), c = randomUUID(), d = randomUUID(), e = randomUUID();
    const pos = (id: string, position: number) => ({ type: 'field.update', id, position });
    const link = (fieldId: string, fromRecord: string, toRecord: string) => ({ type: 'link.add', id: randomUUID(), fieldId, fromRecord, toRecord });
    const setup = await post([
      { type: 'table.create', id: tFiles, name: 'Files', singularName: 'File' }, { type: 'table.create', id: tDeliv, name: 'Deliverables', singularName: 'Deliverable' },
      { type: 'table.create', id: tWorks, name: 'Works', singularName: 'Work' }, { type: 'table.create', id: tClients, name: 'Clients', singularName: 'Client' },
      { type: 'field.create', id: fWName, tableId: tWorks, name: 'Name', key: 'name', fieldType: 'text' }, pos(fWName, 0),
      // The fact lives on the WORK: "this Work is owed these deliverables". Deliverables sees it as a backlink.
      { type: 'field.create', id: fWDeliv, tableId: tWorks, name: 'Deliverables', key: 'deliverables', fieldType: 'link', options: { target_table_id: tDeliv } }, pos(fWDeliv, 1),
      { type: 'field.create', id: fCName, tableId: tClients, name: 'Name', key: 'name', fieldType: 'text' }, pos(fCName, 0),
      { type: 'field.create', id: fDName, tableId: tDeliv, name: 'Name', key: 'name', fieldType: 'text' }, pos(fDName, 0),
      { type: 'field.create', id: fDWorks, tableId: tDeliv, name: 'Works', key: 'works', fieldType: 'backlink', options: { source_field_id: fWDeliv } }, pos(fDWorks, 1),
      { type: 'field.create', id: fDClient, tableId: tDeliv, name: 'Client', key: 'client', fieldType: 'link', options: { target_table_id: tClients } }, pos(fDClient, 2),
      { type: 'field.create', id: fName, tableId: tFiles, name: 'Name', key: 'name', fieldType: 'text' }, pos(fName, 0),
      { type: 'field.create', id: fWork, tableId: tFiles, name: 'Work', key: 'work', fieldType: 'link', options: { target_table_id: tWorks } }, pos(fWork, 1),
      { type: 'field.create', id: fTarget, tableId: tFiles, name: 'Target', key: 'target', fieldType: 'link', options: { target_table_id: tDeliv, single: true } }, pos(fTarget, 2),
      { type: 'field.create', id: fFClient, tableId: tFiles, name: 'Client', key: 'client', fieldType: 'link', options: { target_table_id: tClients } }, pos(fFClient, 3),
      ...[[ep101, 'Ep 101'], [ep102, 'Ep 102'], [ep103, 'Ep 103']].map(([id, name]) => ({ type: 'record.create', id, tableId: tWorks, data: { name } })),
      ...[[texted, 'Texted Master'], [textless, 'Textless Master'], [trailer, 'Trailer']].map(([id, name]) => ({ type: 'record.create', id, tableId: tDeliv, data: { name } })),
      ...[[acme, 'Acme'], [bolt, 'Bolt']].map(([id, name]) => ({ type: 'record.create', id, tableId: tClients, data: { name } })),
      ...[[a, 'a.mov'], [b, 'b.mov'], [c, 'c.mov'], [d, 'd.mov'], [e, 'e.mov']].map(([id, name]) => ({ type: 'record.create', id, tableId: tFiles, data: { name } })),
      link(fWDeliv, ep101, texted), link(fWDeliv, ep102, texted), link(fWDeliv, ep102, textless),
      link(fDClient, texted, acme), link(fDClient, textless, bolt),
      link(fWork, a, ep101),                       // b.mov: no Work
      link(fWork, c, ep102),
      link(fWork, d, ep103),                       // Ep 103 is owed nothing yet
      link(fWork, e, ep102), link(fFClient, e, acme),
    ]);
    check('fixture accepted', setup.status === 200, (await setup.text()).slice(0, 300));

    console.log('\nM2. The server');
    const opts = (extra: Record<string, unknown>) => ({ target_table_id: tDeliv, single: true, ...extra });
    const r1 = await post([{ type: 'field.update', id: fName, options: { match: [[fWork, fDWorks]] } }]);
    check('refuses a match on a field that is not a link', r1.status === 400 && /only a link/.test(await r1.text()));
    const r2 = await post([{ type: 'field.update', id: fTarget, options: opts({ match: [[fWork, fDClient]] }) }]);
    check('refuses a pair that leads to two different tables', r2.status === 400 && /same table/.test(await r2.text()));
    const r3 = await post([{ type: 'field.update', id: fTarget, options: opts({ match: [[fDClient, fDClient]] }) }]);
    check('refuses a pair whose first field is not on the link\'s own table', r3.status === 400 && /own table/.test(await r3.text()));
    const r4 = await post([{ type: 'field.update', id: fTarget, options: opts({ match: 'the same work' }) }]);
    check('refuses a match that is not a list of pairs', r4.status === 400 && /match/.test(await r4.text()));
    check('nothing was stored by any of those', (await pool.query(`select options from fields where id = $1`, [fTarget])).rows[0].options.match === undefined);

    const go = async (tableId: string) => { win.location.hash = `#/all/table/${tableId}`; win.dispatchEvent(new (win as any).HashChangeEvent('hashchange')); await until(() => w.find('.gridview').exists() && w.findAll('.gridview tr.row').length > 0, 8000); };
    const ths = () => w.findAll('.gridview thead .th-name').map((x: any) => x.text());
    const th = (name: string) => w.findAll('.gridview thead th').find((t: any) => t.find('.th-name').exists() && t.find('.th-name').text() === name)!;
    const rowNamed = (name: string) => w.findAll('.gridview tr.row').find((r: any) => r.findAll('td')[1].text() === name)!;
    const cellOf = (name: string, col: string) => rowNamed(name).findAll('td')[ths().indexOf(col) + 1];
    const gridPop = () => w.find('.gridview .popover');
    const grid = () => w.find('.gridview .scroller');
    const picker = () => w.find('.gridview .picker');
    const listed = (p = picker()) => p.findAll('.list li .name').map((x: any) => x.text());
    const stored = async () => (await pool.query(`select options from fields where id = $1`, [fTarget])).rows[0].options;

    console.log('\nM3. The ⚙ on the link field');
    await go(tFiles);
    await until(() => ths().includes('Target'));
    await th('Target').find('.th-menu').trigger('click');
    await until(() => gridPop().find('.field-settings').exists());
    const lm = () => gridPop().find('.lm');
    const offers = () => lm().findAll('.lm-add option').map((o: any) => o.text()).filter((t: string) => t.includes('='));
    check('a link\'s ⚙ has a "match" line with ONE dropdown of the possible pairs', lm().exists() && lm().find('.lm-add').exists()
      && offers().sort().join(' | ') === 'Files.Client = Deliverables.Client | Files.Work = Deliverables.Works', offers().join(' | '));
    check('…and nothing listed yet', lm().findAll('.lm-pair').length === 0 && /narrow the picker by/.test(lm().find('.lm-add').text()));
    await lm().find('.lm-add').setValue(`${fWork}=${fDWorks}`);
    await untilDb(`select options from fields where id = '${fTarget}'`, (r) => Array.isArray(r[0].options.match));
    const s1 = await stored();
    check('picking one stores it on the field, beside its other options', JSON.stringify(s1.match) === JSON.stringify([[fWork, fDWorks]]) && s1.single === true && s1.target_table_id === tDeliv, JSON.stringify(s1));
    check('it is listed, with its ×; the dropdown offers what is left', await until(() => lm().findAll('.lm-pair').length === 1)
      && lm().find('.lm-pair .lm-text').text() === 'Files.Work = Deliverables.Works' && offers().join() === 'Files.Client = Deliverables.Client', lm().text());
    await gridPop().trigger('keydown', { key: 'Escape' });
    await th('Work').find('.th-menu').trigger('click');
    await until(() => gridPop().find('.field-settings').exists());
    check('another link offers what ITS two tables share (a Work that is owed this file\'s Target)', offers().join() === 'Files.Target = Works.Deliverables', offers().join());
    await gridPop().trigger('keydown', { key: 'Escape' });
    await th('Client').find('.th-menu').trigger('click');
    await until(() => gridPop().find('.field-settings').exists());
    check('a link whose tables share no link says there is nothing to narrow by', !lm().find('.lm-add').exists() && /nothing to narrow the picker by/.test(lm().text()), lm().text());
    await gridPop().trigger('keydown', { key: 'Escape' });

    console.log('\nM4. The grid\'s picker');
    const open = async (file: string) => {
      if (picker().exists()) { await picker().find('input').trigger('keydown', { key: 'Escape' }); await until(() => !picker().exists()); }
      await cellOf(file, 'Target').trigger('mousedown');
      await grid().trigger('keydown', { key: 'Enter' });
      await until(() => picker().exists());
    };
    await open('a.mov');
    check('a.mov (Ep 101): only the deliverable owed by its Work — through the BACKLINK side', await until(() => listed().join() === 'Texted Master'), listed().join());
    check('with a way out, named by what they agree on', picker().find('.match-toggle').exists() && /show all Deliverables, not just the same Work/.test(picker().find('.match-toggle').text()), picker().text());
    await picker().find('.match-toggle input').setValue(true);
    check('show all: every deliverable', await until(() => listed().length === 3), listed().join());
    // In a browser, clicking the tick (or its label) moves FOCUS to the checkbox, so the
    // search line blurs — which used to close the picker before the click landed.
    await picker().find('input.q').trigger('blur', { relatedTarget: picker().find('.match-toggle input').element });
    check('focus moving to the tick INSIDE the picker does not close it', picker().exists() && listed().length === 3);
    await picker().find('.match-toggle input').setValue(false);
    check('…and it toggles back', await until(() => listed().join() === 'Texted Master'), listed().join());
    await picker().find('input.q').trigger('blur', { relatedTarget: w.find('.gridview .scroller').element });
    check('focus leaving the picker still closes it', await until(() => !picker().exists()));
    await open('c.mov');
    check('c.mov (Ep 102): both of that Work\'s', await until(() => listed().sort().join() === 'Texted Master,Textless Master'), listed().join());
    await open('b.mov');
    check('b.mov has no Work: no opinion — everything, and no toggle or note about it', await until(() => listed().length === 3) && !picker().find('.match-toggle').exists() && !picker().find('.no-match').exists());
    await open('d.mov');
    // The note waits for the table's walk to finish: "nothing agrees" over a partial list would be a guess.
    check('d.mov\'s Work is owed nothing: everything is offered — and it SAYS nothing agrees', await until(() => listed().length === 3 && picker().find('.no-match').exists())
      && !picker().find('.match-toggle').exists() && /no Deliverables with the same Work — showing all/.test(picker().find('.no-match').text()), picker().text());
    await open('a.mov');
    await until(() => listed().join() === 'Texted Master');
    await picker().find('input').trigger('keydown', { key: 'Enter' });
    const made = await untilDb(`select to_record from links where field_id = '${fTarget}' and from_record = '${a}'`, (r) => r.length === 1);
    check('Enter links the one offered', made[0].to_record === texted);
    await picker().find('input').trigger('keydown', { key: 'Escape' });

    console.log('\nM5. A filter, not a constraint');
    const off = await post([link(fTarget, c, trailer)]);
    check('a link to a record that does NOT agree is accepted', off.status === 200, await off.text());
    check('…and shows like any other', await until(() => cellOf('c.mov', 'Target').find('.pill').exists() && cellOf('c.mov', 'Target').find('.pill-text').text() === 'Trailer'));

    console.log('\nM6. The record tray');
    await cellOf('e.mov', 'Name').trigger('mousedown');
    await grid().trigger('keydown', { key: ' ' });
    const panel = () => w.find('.record-panel');
    const pField = (name: string) => panel().findAll('.rp-field').find((f: any) => f.find('.rp-name').text().replace(/[★⚠✓]/g, '').trim() === name)!;
    await until(() => panel().exists() && !!pField('Target'));
    await pField('Target').find('.rp-value').trigger('click');
    await until(() => panel().find('.picker').exists());
    check('e.mov (Ep 102) in the tray: the same narrowing', await until(() => listed(panel().find('.picker')).sort().join() === 'Texted Master,Textless Master'), listed(panel().find('.picker')).join());
    check('…with the same way out', /not just the same Work/.test(panel().find('.picker .match-toggle').text()));

    console.log('\nM7. Two pairs: both must agree');
    const two = await post([{ type: 'field.update', id: fTarget, options: opts({ match: [[fWork, fDWorks], [fFClient, fDClient]] }) }]);
    check('a second pair (link = link) is accepted', two.status === 200, await two.text());
    check('e.mov (Ep 102, Acme): Textless Master is Bolt\'s — only Texted Master is left', await until(() => listed(panel().find('.picker')).join() === 'Texted Master'), listed(panel().find('.picker')).join());
    check('…and the toggle names both', /the same Work \/ Client/.test(panel().find('.picker .match-toggle').text()), panel().find('.picker .match-toggle').text());
    await panel().find('.picker input').trigger('keydown', { key: 'Escape' });
    await panel().find('.rp-close').trigger('click');
    await post([{ type: 'link.remove', fieldId: fTarget, fromRecord: c, toRecord: trailer }]);
    await until(() => !cellOf('c.mov', 'Target').find('.pill').exists());
    await open('c.mov');
    check('c.mov (Ep 102, no Client): the Client pair has no opinion and is skipped', await until(() => listed().sort().join() === 'Texted Master,Textless Master')
      && /not just the same Work$/.test(picker().find('.match-toggle').text().trim()), `${listed().join()} / ${picker().find('.match-toggle').text()}`);
    await picker().find('input').trigger('keydown', { key: 'Escape' });

    console.log('\nM8. A pair whose field is deleted');
    const del = await post([{ type: 'field.delete', id: fDWorks }]);
    check('the backlink the first pair names is deleted', del.status === 200, await del.text());
    await open('a.mov');
    // (until: the delete reaches this client over the stream; before it does, the pair is still live)
    check('a.mov: that pair is inert, the other has no opinion — nothing narrows, nothing is claimed',
      await until(() => listed().length === 2 && !picker().find('.match-toggle').exists() && !picker().find('.no-match').exists()), `${listed().join()} / ${picker().text()}`);
    await picker().find('input').trigger('keydown', { key: 'Escape' });
    await th('Target').find('.th-menu').trigger('click');
    await until(() => gridPop().find('.field-settings').exists());
    check('the ⚙ shows it as broken', await until(() => lm().findAll('.lm-pair').length === 2) && lm().findAll('.lm-pair')[0].classes('broken') && /deleted field.*broken/.test(lm().findAll('.lm-pair')[0].text())
      && !lm().findAll('.lm-pair')[1].classes('broken'), lm().text());
    await gridPop().find('.single input').setValue(false);
    const s2 = await untilDb(`select options from fields where id = '${fTarget}'`, (r) => r[0].options.single === undefined);
    check('the field\'s OTHER settings still save with the dead pair on it', s2[0].options.single === undefined && s2[0].options.match.length === 2, JSON.stringify(s2[0].options));
    await lm().findAll('.lm-pair')[0].find('.x').trigger('click');
    const s3 = await untilDb(`select options from fields where id = '${fTarget}'`, (r) => r[0].options.match?.length === 1);
    check('× removes it, leaving the good one', JSON.stringify(s3[0].options.match) === JSON.stringify([[fFClient, fDClient]]), JSON.stringify(s3[0].options));
    await until(() => lm().findAll('.lm-pair').length === 1);
    await lm().find('.lm-pair .x').trigger('click');
    const s4 = await untilDb(`select options from fields where id = '${fTarget}'`, (r) => r[0].options.match === undefined);
    check('removing the last one removes the option', s4[0].options.match === undefined && s4[0].options.target_table_id === tDeliv, JSON.stringify(s4[0].options));
  } finally {
    await ui.close();
  }
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); console.log('\nSUITE ABORTED — an exception ended it early; the tally above is incomplete'); process.exit(1); });
