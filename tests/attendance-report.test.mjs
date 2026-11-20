import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAttendanceReport } from '../lib/attendance-report.ts';

const filters = { from: '2026-11-10', to: '2026-11-12', site: '' };
const person = 'operaio';
const staff = 'dipendente';
const site = 'palazzo';
const people = [
  { id: person, name: 'Luca', kind: 'worker', archived: false },
  { id: staff, name: 'Sara', kind: 'employee', archived: true },
];
const sites = [{ id: site, name: 'Palazzo' }];
const entry = (id, rest = {}) => ({
  id, person_id: person, work_date: '2026-11-10', kind: 'work', workplace: 'site', site_id: site,
  start_time: '08:00', end_time: '10:15', updated_at: '2026-11-10T12:00:00Z', ...rest,
});

test('Somma le fasce in minuti ma conta una giornata una sola volta per persona', () => {
  const shift = entry('prima');
  const report = buildAttendanceReport({ people, entries: [
    shift, shift,
    entry('seconda', { start_time: '10:15', end_time: '10:45' }),
    entry('magazzino', { start_time: '11:45', end_time: '12:25', workplace: 'warehouse', site_id: null }),
    entry('altra persona', { person_id: staff, start_time: '11:00', end_time: '12:00', workplace: 'office', site_id: null }),
    entry('fuori periodo', { work_date: '2026-11-13' }),
    entry('fascia non valida', { end_time: null }),
  ] }, filters, sites);

  assert.deepEqual(report.summary, { workMinutes: 265, workDays: 2, fullDayAbsences: 0, timedAbsences: 0, absenceMinutes: 0, incomplete: 1 });
  assert.deepEqual(report.people.map(row => [row.name, row.archived, row.workDays, row.workMinutes]), [
    ['Luca', false, 1, 205], ['Sara', true, 1, 60],
  ]);
  assert.deepEqual(report.places.map(row => [row.label, row.workDays, row.workMinutes]), [
    ['Magazzino', 1, 40], ['Palazzo', 1, 165], ['Ufficio', 1, 60],
  ]);
});

test('Tiene separate assenze a giornata e a ore e le esclude dal filtro cantiere', () => {
  const data = { people, entries: [
    entry('lavoro'),
    entry('ferie', { person_id: staff, kind: 'vacation', workplace: null, site_id: null, start_time: null, end_time: null }),
    entry('permesso', { kind: 'leave', workplace: null, site_id: null, start_time: '10:30', end_time: '11:15' }),
    entry('ferie fuori periodo', { work_date: '2026-11-09', kind: 'vacation', workplace: null, site_id: null, start_time: null, end_time: null }),
  ] };
  const report = buildAttendanceReport(data, filters, sites);
  assert.equal(report.showAbsences, true);
  assert.equal(report.summary.fullDayAbsences, 1);
  assert.equal(report.summary.timedAbsences, 1);
  assert.equal(report.summary.absenceMinutes, 45);
  assert.deepEqual(report.absences.map(row => [row.kind, row.fullDayAbsences, row.timedAbsences, row.absenceMinutes]), [
    ['vacation', 1, 0, 0], ['leave', 0, 1, 45],
  ]);
  const filtered = buildAttendanceReport(data, { ...filters, site }, sites);
  assert.equal(filtered.showAbsences, false);
  assert.deepEqual(filtered.people.map(row => row.name), ['Luca']);
  assert.deepEqual(filtered.absences, []);
  assert.deepEqual(filtered.summary, { workMinutes: 135, workDays: 1, fullDayAbsences: 0, timedAbsences: 0, absenceMinutes: 0, incomplete: 0 });
});
