import assert from 'node:assert/strict';
import test from 'node:test';
import { attendanceMinutes, attendanceMonth, attendanceMonthRange, attendanceOverlaps, validateAttendanceAction } from '../lib/attendance.ts';

const entry = {
  action: 'save', id: '19315b08-da39-4e6d-9dd7-ba802e59fe82',
  person_id: 'a79a9eb0-ce91-425f-a59e-33ea7eb6120d', work_date: '2026-11-20',
  kind: 'work', start_time: '08:15', end_time: '12:00', workplace: 'warehouse',
};

test('Le presenze richiedono orari della stessa giornata e un luogo coerente', () => {
  assert.equal(attendanceMinutes(validateAttendanceAction(entry)), 225);
  assert.throws(() => validateAttendanceAction({ ...entry, end_time: '08:00' }), /successiva/);
  assert.throws(() => validateAttendanceAction({ ...entry, end_time: null }), /inizio e l’ora di fine/);
  assert.throws(() => validateAttendanceAction({ ...entry, workplace: 'site' }), /cantiere/);
  assert.throws(() => validateAttendanceAction({ ...entry, kind: 'sick' }), /luogo di lavoro/);
});

test('Le fasce consecutive sono ammesse e un’assenza intera occupa tutta la giornata', () => {
  const work = validateAttendanceAction(entry);
  const absence = validateAttendanceAction({
    ...entry, id: '4c303c84-e71f-4d01-aa9e-7b1bea59cd99', kind: 'leave', workplace: null,
    start_time: '12:00', end_time: '13:00',
  });
  const stored = { ...absence, updated_at: '2026-11-20T10:00:00Z' };
  assert.equal(attendanceOverlaps(work, stored), false);
  assert.equal(attendanceOverlaps(work, { ...stored, start_time: '11:59' }), true);
  assert.equal(attendanceOverlaps(work, { ...stored, start_time: null, end_time: null }), true);
  assert.equal(attendanceOverlaps(work, { ...stored, work_date: '2026-11-21' }), false);
});

test('Il calendario convalida il mese e calcola la data finale inclusa', () => {
  assert.equal(attendanceMonth('2026-13', '2026-11-20'), '2026-11');
  assert.deepEqual(attendanceMonthRange('2024-02'), { from: '2024-02-01', to: '2024-02-29' });
  assert.deepEqual(attendanceMonthRange('9999-12'), { from: '9999-12-01', to: '9999-12-31' });
});
