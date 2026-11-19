import assert from 'node:assert/strict';
import test from 'node:test';
import { calendarDays, calendarLabel, calendarRange, calendarSelection, shiftCalendar } from '../lib/calendar.ts';
import { demoAgenda, demoSeed, updateDemo } from '../lib/demo.ts';

test('Il calendario mensile mostra settimane complete e passa correttamente a gennaio', () => {
  const december = { view: 'mese', date: '2026-12-31' };
  const days = calendarDays(december);
  assert.equal(days[0], '2026-11-30');
  assert.equal(days.at(-1), '2027-01-03');
  assert.equal(days.length, 35);
  assert.equal(shiftCalendar(december, 1), '2027-01-01');
  assert.equal(shiftCalendar(december, -1), '2026-11-01');
  assert.ok(calendarDays({ view: 'mese', date: '2028-02-15' }).includes('2028-02-29'));
});

test('Settimana e giorno si ancorano alla data selezionata e rispettano il cambio di ora', () => {
  const week = { view: 'settimana', date: '2026-10-25' };
  const days = calendarDays(week);
  assert.equal(days[0], '2026-10-19');
  assert.equal(days.at(-1), '2026-10-25');
  assert.equal(days.length, 7);
  assert.equal(shiftCalendar(week, 1), '2026-11-01');
  assert.match(calendarLabel({ view: 'settimana', date: '2026-12-31' }), /dicembre 2026.*gennaio 2027/);
  assert.deepEqual(calendarSelection('giorno', '2026-02-30', '2026-11-19'), { view: 'giorno', date: '2026-11-19' });
  assert.equal(calendarSelection('lista', '2026-12-02', '2026-11-19'), null);
  assert.equal(shiftCalendar({ view: 'giorno', date: '9999-12-31' }, 1), null);
});

test('Una giornata del calendario mostra insieme interventi con orario e completati', () => {
  const today = '2026-11-19';
  const source = demoSeed(today);
  const job = { action: 'job', id: '105e6b9c-0e41-4560-ad8f-e4801420cb18',
    site_id: source.sites[0].id, kind: 'assembly', zone: '', due_date: '2026-12-20', time: '11:00', notes: '', status: 'done' };
  const store = updateDemo(source, job);
  const matches = demoAgenda(store, calendarRange({ view: 'giorno', date: job.due_date })).items;
  assert.deepEqual(matches.map(item => [item.id, item.time, item.status]), [[job.id, '11:00', 'done']]);
});
