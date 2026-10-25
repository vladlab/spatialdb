/**
 * A calendar, OPEN, in the app (VIEWS-BRIEF.md Part B, round 3): "+ calendar" in the
 * tree, CalendarView (bar, layout buttons, legend, problems, the interim per-source
 * count), its address, the editor in the tray, and the owner's rule for a layout
 * switch while the definition has a problem (Oct 25 2026, option a: this screen only,
 * said so). The calendar itself is test/calendar.ts (pure); the kind and the server's
 * check are test/structured.ts T9b.
 *
 * The fixture is the brief's worked example: Computers, Projects, and Bookings — a
 * junction, Computer × Project, with its own status, start and end.
 */
import { randomUUID } from 'node:crypto';
import { mountApp } from './uiHarness.js';

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

async function main() {
  const ui = await mountApp(Number(process.env.TEST_PORT ?? 8852));
  const { w, win, until, untilDb, post, nav } = ui;
  const dialogs = nav.dialogs;
  try {
    const tComp = randomUUID(), tProj = randomUUID(), tBook = randomUUID();
    const fCName = randomUUID(), fPName = randomUUID();
    const jStatus = randomUUID(), jComp = randomUUID(), jProj = randomUUID(), jStart = randomUUID(), jEnd = randomUUID();
    const c1 = randomUUID(), c2 = randomUUID(), duke = randomUUID(), novak = randomUUID();
    const pos = (id: string, position: number) => ({ type: 'field.update', id, position });
    const booking = (comp: string | null, proj: string, status: string, start: string, end: string) => {
      const id = randomUUID();
      return [
        { type: 'record.create', id, tableId: tBook, data: { status, start, end } },
        ...(comp ? [{ type: 'link.add', id: randomUUID(), fieldId: jComp, fromRecord: id, toRecord: comp }] : []),
        { type: 'link.add', id: randomUUID(), fieldId: jProj, fromRecord: id, toRecord: proj },
      ];
    };
    const setup = await post([
      { type: 'table.create', id: tComp, name: 'Computers', singularName: 'Computer' },
      { type: 'table.create', id: tProj, name: 'Projects', singularName: 'Project' },
      { type: 'field.create', id: fCName, tableId: tComp, name: 'Name', key: 'name', fieldType: 'text' }, pos(fCName, 0),
      { type: 'field.create', id: fPName, tableId: tProj, name: 'Name', key: 'name', fieldType: 'text' }, pos(fPName, 0),
      { type: 'table.create', id: tBook, name: 'Bookings', singularName: 'Booking', kind: 'junction' },
      { type: 'field.create', id: jStatus, tableId: tBook, name: 'Status', key: 'status', fieldType: 'select', options: { choices: ['Planned', 'Confirmed', 'Done'] } }, pos(jStatus, 0),
      { type: 'field.create', id: jComp, tableId: tBook, name: 'Computer', key: 'computer', fieldType: 'link', options: { target_table_id: tComp, single: true } }, pos(jComp, 1),
      { type: 'field.create', id: jProj, tableId: tBook, name: 'Project', key: 'project', fieldType: 'link', options: { target_table_id: tProj, single: true } }, pos(jProj, 2),
      { type: 'field.create', id: jStart, tableId: tBook, name: 'Start', key: 'start', fieldType: 'date' }, pos(jStart, 3),
      { type: 'field.create', id: jEnd, tableId: tBook, name: 'End', key: 'end', fieldType: 'date' }, pos(jEnd, 4),
      { type: 'table.update', id: tBook, junction: { a: jComp, b: jProj, status: jStatus } },
      { type: 'record.create', id: c1, tableId: tComp, data: { name: 'Color 01' } }, { type: 'record.create', id: c2, tableId: tComp, data: { name: 'Color 02' } },
      { type: 'record.create', id: duke, tableId: tProj, data: { name: 'Duke' } }, { type: 'record.create', id: novak, tableId: tProj, data: { name: 'Novak' } },
      ...booking(c1, duke, 'Confirmed', '2026-10-05', '2026-10-09'),
      // NOT c1 × Duke again: a junction holds ONE row per pair (sql/016) — a second
      // bout of the same computer on the same project is refused by the server.
      ...booking(c2, duke, 'Planned', '2026-10-19', '2026-10-23'),
      ...booking(c2, novak, 'Confirmed', '2026-10-14', '2026-10-16'),
      // No booking without a computer: a junction row must link exactly one record at
      // EACH end (sql/016), so a junction source never fills the Unassigned lane.
    ]);
    check('fixture accepted (Computers, Projects, the Bookings junction)', setup.status === 200, (await setup.text()).slice(0, 300));

    const bar = () => w.find('.calendarview .cv-bar');
    const view = () => w.find('.calendarview');
    const editor = () => w.find('.record-panel .ce');
    const defOf = async (id: string) => (await untilDb(`select data->'calendar' d from records where id = '${id}'`, (r) => r.length === 1))[0].d;

    console.log('\nC1. "+ calendar" — the table of calendars is made on first use');
    win.location.hash = `#/all/table/${tComp}`; win.dispatchEvent(new (win as any).HashChangeEvent('hashchange'));
    await until(() => w.find('.tree .new-calendar-btn').exists(), 8000);
    check('the tree has a Calendars subheader, empty', /Calendars/.test(w.find('.tree').text()) && w.findAll('.tree .calendar-row').length === 0);
    dialogs.text = 'Machine room';
    await w.find('.tree .new-calendar-btn').trigger('click');
    const made = await untilDb(`select r.id, t.kind, t.name from records r join tables t on t.id = r.table_id where t.kind = 'calendar' and r.data->>'name' = 'Machine room'`, (r) => r.length === 1);
    const cal = made[0].id;
    check('a "Calendars" table of kind calendar was made, with the new calendar in it', made[0].name === 'Calendars');
    check('the calendar opens, with its record in the tray, at its own address', await until(() => view().exists() && editor().exists()) && win.location.hash.includes(`/calendar/${cal}`), win.location.hash);
    check('the tree lists it under Calendars, selected', await until(() => w.findAll('.tree .calendar-row').length === 1 && w.find('.tree .calendar-row').classes('on')));
    check('with no definition yet, the view says what to do', /No sources yet/.test(view().text()), view().text().slice(0, 200));
    check('Resource is disabled — there are no rows', bar().find('[data-layout="resource"]').attributes('disabled') !== undefined);

    console.log('\nC2. The editor: a source, saved once');
    check('the source picker offers Bookings (a junction — a booking IS a pair) and greys out tables with no date', await until(() => editor().findAll('.ce-add-source option').some((o: any) => o.text() === 'Bookings'))
      && editor().findAll('.ce-add-source option').find((o: any) => /Computers/.test(o.text()))!.attributes('disabled') !== undefined);
    await editor().find('.ce-add-source').setValue(tBook);
    const src = () => editor().find('.ce-source');
    check('a new source is guessed: Start / End, labelled by the primary field, the first tint', await until(() => src().exists())
      && (src().find('.ce-start').element as HTMLSelectElement).value === jStart && (src().find('.ce-end').element as HTMLSelectElement).value === jEnd
      && (src().find('.ce-labelf').element as HTMLSelectElement).value === jStatus && src().find('.ce-swatch.on').classes().includes('tint-green'));
    check('nothing is saved until "save"', (await defOf(cal)) === null);
    await src().find('.add-label').trigger('click');
    await src().findAll('.ce-labelf')[1].setValue(jProj);
    await editor().find('.save-calendar').trigger('click');
    const d1 = await untilDb(`select data->'calendar' d from records where id = '${cal}'`, (r) => r[0]?.d?.sources?.length === 1);
    check('save writes the definition: one source, two label fields, layout month', d1[0].d.sources[0].tableId === tBook && d1[0].d.sources[0].label.join() === `${jStatus},${jProj}` && d1[0].d.layout === 'month', JSON.stringify(d1[0].d));
    check('the view now counts what the source contributes', await until(() => /3 events/.test(bar().text()) && /Bookings/.test(view().find('.cv-sources').text())), bar().text());
    check('…and its legend chip carries the tint', bar().find('.cv-src').classes().includes('tint-green'));

    console.log('\nC3. The top bar owns the layout');
    await bar().find('[data-layout="week"]').trigger('click');
    check('switching to Week writes it into the definition', (await untilDb(`select data->'calendar'->>'layout' l from records where id = '${cal}'`, (r) => r[0].l === 'week'))[0].l === 'week');
    check('…and the button shows it', await until(() => bar().find('[data-layout="week"]').classes('on')));

    console.log('\nC4. Rows: the resource axis');
    await editor().find('.ce-rows-on').setValue(true);
    check('ticking Rows picks a table of things — Computers, not the junction or the calendars table', await until(() => editor().find('.ce-rows-table').exists())
      && (editor().find('.ce-rows-table').element as HTMLSelectElement).value === tComp
      && !editor().findAll('.ce-rows-table option').some((o: any) => /Bookings|Calendars/.test(o.text())));
    check('…and the source\'s lane is guessed: its Computer endpoint, "through Bookings"', /Computer \(through Bookings\)/.test(src().find('.ce-lane').text()) && (src().find('.ce-lane').element as HTMLSelectElement).value === jComp);
    await editor().find('.save-calendar').trigger('click');
    const d2 = await untilDb(`select data->'calendar' d from records where id = '${cal}'`, (r) => !!r[0]?.d?.rows);
    check('save keeps the layout the top bar chose (week) and adds the rows and lane', d2[0].d.layout === 'week' && d2[0].d.rows.tableId === tComp && d2[0].d.sources[0].lane === jComp, JSON.stringify(d2[0].d));
    check('Resource is enabled now', await until(() => bar().find('[data-layout="resource"]').attributes('disabled') === undefined));
    await bar().find('[data-layout="resource"]').trigger('click');
    await untilDb(`select data->'calendar'->>'layout' l from records where id = '${cal}'`, (r) => r[0].l === 'resource');
    check('the rows are counted: two computers + Unassigned', await until(() => /2 lanes \+ Unassigned/.test(view().find('.cv-sources').text())), view().find('.cv-sources').text());

    console.log('\nC5. The legend: switch a source off, in this browser only');
    await bar().find('.cv-src').trigger('click');
    check('the source is hidden here: struck through, 0 events', await until(() => bar().find('.cv-src').classes('off') && /0 events/.test(bar().text()) && /hidden here/.test(view().text())));
    check('…and the definition is untouched', (await defOf(cal)).sources.length === 1);
    await bar().find('.cv-src').trigger('click');
    await until(() => /3 events/.test(bar().text()));

    console.log('\nC6. A layout switch while the definition has a problem (option a)');
    await post([{ type: 'field.delete', id: jEnd }]);
    check('a deleted end field: the calendar still draws, and says what is wrong', await until(() => /end field no longer exists/.test(view().text()) && /3 events/.test(bar().text())), view().text().slice(0, 300));
    await bar().find('[data-layout="month"]').trigger('click');
    check('switching layout then works on this screen…', await until(() => bar().find('[data-layout="month"]').classes('on')));
    check('…says it is not saved, and why', /not saved/.test(view().find('.cv-local').text()) && /end field no longer exists/.test(view().find('.cv-local').text()), view().find('.cv-local').exists() ? view().find('.cv-local').text() : 'no note');
    check('…and the stored layout is still Resource — nothing was refused, nothing was sent', (await defOf(cal)).layout === 'resource' && !w.find('.errors').exists());

    console.log('\nC7. Addresses and the other ways in');
    win.location.hash = `#/all/table/${tComp}`; win.dispatchEvent(new (win as any).HashChangeEvent('hashchange'));
    await until(() => !view().exists() && w.find('.gridview').exists(), 8000);
    win.location.hash = `#/all/calendar/${cal}`; win.dispatchEvent(new (win as any).HashChangeEvent('hashchange'));
    check('a calendar address opens the calendar', await until(() => view().exists() && /Machine room/.test(bar().text()), 8000));
    const tCal = (await untilDb(`select id from tables where kind = 'calendar'`, (r) => r.length === 1))[0].id;
    win.location.hash = `#/all/table/${tCal}`; win.dispatchEvent(new (win as any).HashChangeEvent('hashchange'));
    await until(() => w.find('.gridview .open-calendar').exists(), 8000);
    await w.find('.gridview .open-calendar').trigger('click');
    check('a row of the Calendars table has "▥ open", which goes to it', await until(() => view().exists()));
  } finally {
    console.log(`\n${pass} passed, ${fail} failed\n`);
    await ui.close();
  }
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); console.log('\nSUITE ABORTED — an exception ended it early; the tally above is incomplete\n'); process.exit(1); });
