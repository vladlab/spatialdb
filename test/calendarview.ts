/**
 * A calendar, OPEN, in the app (VIEWS-BRIEF.md Part B, round 3): "+ calendar" in the
 * tree, CalendarView (bar, layout buttons, legend, problems, the interim per-source
 * count), its address, the editor in the tray, and the owner's rule for a layout
 * switch while the definition has a problem (Oct 25 2026, option a: this screen only,
 * said so). The calendar itself is test/calendar.ts (pure); the kind and the server's
 * check are test/structured.ts T9b.
 *
 * The fixture is the brief's worked example: Computers, Projects, and Bookings — a
 * PLAIN table (two single links, status, start, end; the owner's call, Oct 25 2026),
 * so the same pair can be booked twice and a booking can have no computer yet.
 * Round 4 added the month and week layouts (C3–C5).
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
    const b1 = randomUUID(), b2 = randomUUID(), b3 = randomUUID(), b4 = randomUUID(), b5 = randomUUID();
    const pos = (id: string, position: number) => ({ type: 'field.update', id, position });
    const booking = (id: string, comp: string | null, proj: string, status: string, start: string, end: string) => [
      { type: 'record.create', id, tableId: tBook, data: { status, start, end } },
      ...(comp ? [{ type: 'link.add', id: randomUUID(), fieldId: jComp, fromRecord: id, toRecord: comp }] : []),
      { type: 'link.add', id: randomUUID(), fieldId: jProj, fromRecord: id, toRecord: proj },
    ];
    // Bookings is a PLAIN table with two single links (owner, Oct 25 2026): a booking
    // is a thing in its own right — the same computer on the same project in several
    // bouts, a booking with no computer yet. A junction (one row per pair, both ends
    // required) can hold neither.
    const setup = await post([
      { type: 'table.create', id: tComp, name: 'Computers', singularName: 'Computer' },
      { type: 'table.create', id: tProj, name: 'Projects', singularName: 'Project' },
      { type: 'field.create', id: fCName, tableId: tComp, name: 'Name', key: 'name', fieldType: 'text' }, pos(fCName, 0),
      { type: 'field.create', id: fPName, tableId: tProj, name: 'Name', key: 'name', fieldType: 'text' }, pos(fPName, 0),
      { type: 'table.create', id: tBook, name: 'Bookings', singularName: 'Booking' },
      { type: 'field.create', id: jStatus, tableId: tBook, name: 'Status', key: 'status', fieldType: 'select', options: { choices: ['Planned', 'Confirmed', 'Done'] } }, pos(jStatus, 0),
      { type: 'field.create', id: jComp, tableId: tBook, name: 'Computer', key: 'computer', fieldType: 'link', options: { target_table_id: tComp, single: true } }, pos(jComp, 1),
      { type: 'field.create', id: jProj, tableId: tBook, name: 'Project', key: 'project', fieldType: 'link', options: { target_table_id: tProj, single: true } }, pos(jProj, 2),
      { type: 'field.create', id: jStart, tableId: tBook, name: 'Start', key: 'start', fieldType: 'date' }, pos(jStart, 3),
      { type: 'field.create', id: jEnd, tableId: tBook, name: 'End', key: 'end', fieldType: 'date' }, pos(jEnd, 4),
      { type: 'record.create', id: c1, tableId: tComp, data: { name: 'Color 01' } }, { type: 'record.create', id: c2, tableId: tComp, data: { name: 'Color 02' } },
      { type: 'record.create', id: duke, tableId: tProj, data: { name: 'Duke' } }, { type: 'record.create', id: novak, tableId: tProj, data: { name: 'Novak' } },
      ...booking(b1, c1, duke, 'Confirmed', '2026-10-05', '2026-10-09'),     // Mon–Fri
      ...booking(b2, c1, duke, 'Planned', '2026-10-19', '2026-10-23'),       // the same pair, a second bout
      ...booking(b3, c2, novak, 'Confirmed', '2026-10-14', '2026-10-16'),
      ...booking(b4, c2, duke, 'Done', '2026-10-12', '2026-10-21'),          // overlaps b3; crosses a week
      ...booking(b5, null, novak, 'Planned', '2026-10-30', '2026-11-03'),    // no computer; crosses the month
    ]);
    check('fixture accepted (Computers, Projects, a plain Bookings table)', setup.status === 200, (await setup.text()).slice(0, 300));

    const bar = () => w.find('.calendarview .cv-bar');
    const view = () => w.find('.calendarview');
    const editor = () => w.find('.record-panel .ce');
    const defOf = async (id: string) => (await untilDb(`select data->'calendar' d from records where id = '${id}'`, (r) => r.length === 1))[0].d;
    const chips = (rec: string) => w.findAll(`.calendarview .chip[data-record="${rec}"]`);
    const chipIn = (week: string, rec: string) => w.find(`.calendarview .cg-week[data-week="${week}"] .chip[data-record="${rec}"]`);
    const styleOf = (el: any) => (el.element as HTMLElement).getAttribute('style') ?? '';

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
    check('the source picker offers Bookings and greys out tables with no date', await until(() => editor().findAll('.ce-add-source option').some((o: any) => o.text() === 'Bookings'))
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
    check('…and its legend chip carries the tint', await until(() => bar().find('.cv-src').classes().includes('tint-green')));

    console.log('\nC3. Month: rows of seven days, events packed into tracks');
    // The period on screen starts at TODAY (per browser, client/calendarPrefs.ts). Walk to
    // the fixture's month with ‹ › so the suite does not depend on the day it runs.
    const now = new Date(), stepsToOct = (2026 * 12 + 9) - (now.getFullYear() * 12 + now.getMonth());
    await until(() => bar().find('.cv-next').exists());
    for (let i = 0; i < Math.abs(stepsToOct); i++) await bar().find(stepsToOct > 0 ? '.cv-next' : '.cv-prev').trigger('click');
    check('October 2026 — five Monday-first rows', await until(() => /October 2026/.test(bar().find('.cv-period').text()) && w.findAll('.calendarview .cg-week').length === 5)
      && w.find('.calendarview .cg-week').attributes('data-week') === '2026-09-28', bar().text());
    const count = () => bar().find('.cv-count').text();
    check('the bar counts the events in view: all five', count() === '5 events', count());
    check('a Mon–Fri booking is ONE chip across five columns, labelled by its label fields', chips(b1).length === 1 && /grid-column: 1 \/ 6/.test(styleOf(chipIn('2026-10-05', b1))) && chipIn('2026-10-05', b1).text().includes('Confirmed · Duke'), styleOf(chipIn('2026-10-05', b1)));
    check('the chip wears its source\'s tint', chipIn('2026-10-05', b1).classes().includes('tint-green'));
    check('a booking crossing a week is a chip in each row — open on the side it continues', chips(b4).length === 2
      && chipIn('2026-10-12', b4).classes('open-r') && !chipIn('2026-10-12', b4).classes('open-l') && chipIn('2026-10-19', b4).classes('open-l'));
    check('two bookings overlapping in a week sit on different tracks', styleOf(chipIn('2026-10-12', b3)).match(/grid-row: (\d+)/)?.[1] !== styleOf(chipIn('2026-10-12', b4)).match(/grid-row: (\d+)/)?.[1]);
    check('the same computer on the same project twice: two bookings, both drawn', chips(b1).length === 1 && chips(b2).length === 1);
    check('days of other months are dimmed', w.find('.calendarview .cg-day[data-day="2026-09-28"]').classes('out') && !w.find('.calendarview .cg-day[data-day="2026-10-01"]').classes('out'));
    check('…and one that runs past the month is open at the end of the grid', chips(b5).length === 1 && chipIn('2026-10-26', b5).classes('open-r'));
    await chipIn('2026-10-05', b1).trigger('click');
    check('a click selects the chip', await until(() => chipIn('2026-10-05', b1).classes('sel')));
    await w.find('.calendarview .cv-body').trigger('click');
    check('…a click on empty days clears it', await until(() => !chipIn('2026-10-05', b1).classes('sel')));
    await chipIn('2026-10-12', b3).trigger('dblclick');
    check('a double-click opens the booking in the tray, and its chip wears the ring', await until(() => w.find('.record-panel .rp-table').text() === 'Bookings' && chipIn('2026-10-12', b3).classes('opened')));

    console.log('\nC4. Moving through time — per browser');
    await bar().find('.cv-next').trigger('click');
    await until(() => /November 2026/.test(bar().find('.cv-period').text()));
    check('› goes to November: the booking from October continues in, open at its start', await until(() => /November 2026/.test(bar().find('.cv-period').text()))
      && chipIn('2026-11-02', b5).classes('open-l') && count() === '1 event', count());
    check('…and "today" is offered whenever today is not on screen', bar().find('.cv-today').exists());
    await bar().find('.cv-prev').trigger('click');
    check('‹ comes back to October', await until(() => /October 2026/.test(bar().find('.cv-period').text())));
    check('where you are looking is kept in this browser, not in the calendar', JSON.parse(win.localStorage.getItem('spatialdb.calendar.anchor') ?? '{}')[cal] === '2026-10-01' && !JSON.stringify(await defOf(cal)).includes('2026-10'),
      win.localStorage.getItem('spatialdb.calendar.anchor') ?? 'nothing stored');

    console.log('\nC5. Week: one row, roomier chips');
    await bar().find('[data-layout="week"]').trigger('click');
    check('switching to Week writes it into the definition', (await untilDb(`select data->'calendar'->>'layout' l from records where id = '${cal}'`, (r) => r[0].l === 'week'))[0].l === 'week');
    // Month navigation lands on the 1st, so the week shown is the one holding Oct 1.
    check('the week holding the anchor (Oct 1 — months land on the 1st), Monday first, dates in the header', await until(() => /Sep 28 – Oct 4, 2026/.test(bar().find('.cv-period').text()))
      && w.findAll('.calendarview .cg-week').length === 1
      && w.findAll('.calendarview .cg-dow').map((d: any) => `${d.find('.cg-dow-name').text()} ${d.find('.cg-dow-date').text()}`).join() === 'Mon 28,Tue 29,Wed 30,Thu 1 Oct,Fri 2,Sat 3,Sun 4',
      w.findAll('.calendarview .cg-dow').map((d: any) => d.text()).join());
    await bar().find('.cv-next').trigger('click');
    await bar().find('.cv-next').trigger('click');
    check('› › moves two weeks: Oct 12 – 18', await until(() => /Oct 12 – 18, 2026/.test(bar().find('.cv-period').text())), bar().find('.cv-period').text());
    check('only what overlaps the week is drawn: two bookings', count() === '2 events' && chips(b3).length === 1 && chips(b4).length === 1 && chips(b1).length === 0, count());
    check('week chips are tall and carry their dates', chipIn('2026-10-12', b3).classes('tall') && /Oct 14 – 16/.test(chipIn('2026-10-12', b3).text()));
    await bar().find('.cv-next').trigger('click');
    check('› moves a week', await until(() => /Oct 19 – 25, 2026/.test(bar().find('.cv-period').text())));
    await bar().find('.cv-prev').trigger('click');

    console.log('\nC5b. Agenda: the days that have something, four weeks at a time');
    await bar().find('.cv-next').trigger('click');                          // week of Oct 19
    await until(() => /Oct 19 – 25, 2026/.test(bar().find('.cv-period').text()));
    await bar().find('[data-layout="agenda"]').trigger('click');
    check('switching to Agenda writes it into the definition', (await untilDb(`select data->'calendar'->>'layout' l from records where id = '${cal}'`, (r) => r[0].l === 'agenda'))[0].l === 'agenda');
    check('four weeks from the Monday of the week you were in', await until(() => /Oct 19 – Nov 15, 2026/.test(bar().find('.cv-period').text())), bar().find('.cv-period').text());
    const agDays = () => w.findAll('.calendarview .ag-day').filter((d: any) => d.findAll('.ag-item').length).map((d: any) => d.attributes('data-day'));
    const agItem = (rec: string) => w.find(`.calendarview .ag-item[data-record="${rec}"]`);
    check('only days with something on them, in order (today keeps a heading too, wherever it falls)', await until(() => agDays().join() === '2026-10-19,2026-10-30'), agDays().join());
    check('…headed the way people write them', w.find('.calendarview .ag-day[data-day="2026-10-19"] .ag-date').text().startsWith('Mon 19 Oct'));
    check('the count is what the four weeks hold: three bookings', count() === '3 events', count());
    check('a booking that began before the period is listed once, on its first day, marked "continues", ahead of the day\'s own',
      w.findAll('.calendarview .ag-item').filter((i: any) => i.attributes('data-record') === b4).length === 1
      && w.findAll('.calendarview .ag-day[data-day="2026-10-19"] .ag-item')[0].attributes('data-record') === b4 && agItem(b4).classes('continued') && /continues/.test(agItem(b4).text()));
    check('a multi-day booking carries its span and length', /Oct 30 – Nov 3 · 5 days/.test(agItem(b5).text()), agItem(b5).text());
    check('each line says which table it came from, in the source\'s tint', /Bookings/.test(agItem(b5).text()) && agItem(b5).classes().includes('tint-green'));
    await bar().find('.cv-prev').trigger('click');
    check('‹ goes back four weeks', await until(() => /Sep 21 – Oct 18, 2026/.test(bar().find('.cv-period').text()) && agDays().join() === '2026-10-05,2026-10-12,2026-10-14'), `${bar().find('.cv-period').text()} ${agDays().join()}`);
    await agItem(b1).trigger('dblclick');
    check('a double-click opens the booking, and its line wears the ring', await until(() => w.find('.record-panel .rp-table').text() === 'Bookings' && agItem(b1).classes('opened')));
    for (let i = 0; i < 3; i++) await bar().find('.cv-next').trigger('click');
    check('an empty stretch says so', await until(() => /Nothing between Dec 14 – Jan 10/.test(view().find('.ag').text())), view().find('.ag').text());

    console.log('\nC6. Rows: the resource axis');
    await bar().find('.cv-def').trigger('click');     // the tray holds a booking since C3's double-click
    check('"settings…" brings the calendar\'s own record back into the tray', await until(() => editor().exists() && src().exists()));
    await editor().find('.ce-rows-on').setValue(true);
    check('ticking Rows guesses the table the source links to — Computers (Bookings links to Computers and Projects; never the source itself)', await until(() => editor().find('.ce-rows-table').exists())
      && (editor().find('.ce-rows-table').element as HTMLSelectElement).value === tComp
      && !editor().findAll('.ce-rows-table option').some((o: any) => /Calendars/.test(o.text())));
    check('…and the source\'s lane is guessed: its Computer link (a plain link — no "through")', (src().find('.ce-lane').element as HTMLSelectElement).value === jComp && !/through/.test(src().find('.ce-lane').text()));
    await editor().find('.save-calendar').trigger('click');
    const d2 = await untilDb(`select data->'calendar' d from records where id = '${cal}'`, (r) => !!r[0]?.d?.rows);
    check('save keeps the layout the top bar chose (agenda) and adds the rows and lane', d2[0].d.layout === 'agenda' && d2[0].d.rows.tableId === tComp && d2[0].d.sources[0].lane === jComp, JSON.stringify(d2[0].d));
    check('Resource is enabled now', await until(() => bar().find('[data-layout="resource"]').attributes('disabled') === undefined));
    await bar().find('[data-layout="resource"]').trigger('click');
    await untilDb(`select data->'calendar'->>'layout' l from records where id = '${cal}'`, (r) => r[0].l === 'resource');
    check('the rows are counted: two computers + Unassigned (the interim, until round 7)', await until(() => /2 lanes \+ Unassigned/.test(view().find('.cv-sources').text())), view().find('.cv-sources').text());

    console.log('\nC7. The legend: switch a source off, in this browser only');
    check('resource (for now) counts every event', count() === '5 events', count());
    await bar().find('.cv-src').trigger('click');
    check('the source is hidden here: struck through, 0 events', await until(() => bar().find('.cv-src').classes('off') && /0 events/.test(bar().text()) && /hidden here/.test(view().text())));
    check('…and the definition is untouched', (await defOf(cal)).sources.length === 1);
    await bar().find('.cv-src').trigger('click');
    await until(() => /5 events/.test(bar().text()));

    console.log('\nC8. A layout switch while the definition has a problem (option a)');
    await post([{ type: 'field.delete', id: jEnd }]);
    check('a deleted end field: the calendar still draws, and says what is wrong', await until(() => /end field no longer exists/.test(view().text()) && /5 events/.test(bar().text())), view().text().slice(0, 300));
    await bar().find('[data-layout="month"]').trigger('click');
    check('switching layout then works on this screen…', await until(() => bar().find('[data-layout="month"]').classes('on')));
    check('…says it is not saved, and why', /not saved/.test(view().find('.cv-local').text()) && /end field no longer exists/.test(view().find('.cv-local').text()), view().find('.cv-local').exists() ? view().find('.cv-local').text() : 'no note');
    check('…and the stored layout is still Resource — nothing was refused, nothing was sent', (await defOf(cal)).layout === 'resource' && !w.find('.errors').exists());
    // The period on screen is shared by the layouts: the agenda left it in December.
    for (let i = 0; i < 6 && !/October 2026/.test(bar().find('.cv-period').text()); i++) await bar().find('.cv-prev').trigger('click');
    check('…while the month draws every booking as one day, on its start', await until(() => chips(b1).length === 1 && /grid-column: 1 \/ 2/.test(styleOf(chipIn('2026-10-05', b1)))), styleOf(chipIn('2026-10-05', b1)));

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
