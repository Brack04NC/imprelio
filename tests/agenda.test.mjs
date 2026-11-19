import assert from 'node:assert/strict';
import test from 'node:test';
import { agendaRange, agendaView, inAgenda } from '../lib/agenda.ts';
import { demoAgenda, demoSeed, updateDemo } from '../lib/demo.ts';

test('L’Agenda mostra un nuovo intervento programmato oltre sette giorni nella sua data', () => {
  const today = '2026-11-19';
  const demo = demoSeed(today);
  const action = {
    action: 'job', id: 'd00aa183-61d9-453b-8c8c-22548142f3fc', site_id: demo.sites[0].id,
    kind: 'assembly', zone: 'Facciata est', due_date: '2026-11-27', time: '09:00',
    notes: '', status: 'scheduled',
  };
  const updated = updateDemo(demo, action);
  assert.equal(inAgenda(action, agendaRange(agendaView('settimana'), today)), false);
  const day = agendaRange(agendaView('settimana', action.due_date), today);
  assert.deepEqual(demoAgenda(updated, day).items.map(job => job.id), [action.id]);
  assert.equal(demoAgenda(updated, day).items[0].site.name, demo.sites[0].name);
  assert.deepEqual(agendaView('settimana', '2026-02-30'), { period: 'settimana' });
});

test('Gli interventi completati restano consultabili per data e non compaiono tra i ritardi', () => {
  const today = '2026-11-19';
  const demo = demoSeed(today);
  const completed = demo.jobs.find(job => job.status === 'done');
  const overdue = demoAgenda(demo, agendaRange(agendaView('ritardo'), today)).items;
  assert.ok(overdue.length > 0 && overdue.every(job => job.status !== 'done' && job.due_date < today));
  assert.deepEqual(demoAgenda(demo, agendaRange(agendaView(null, completed.due_date), today))
    .items.map(job => job.id), [completed.id]);
});
