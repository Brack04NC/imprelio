import assert from 'node:assert/strict';
import test from 'node:test';
import { demoKey, getDemo, getDemoBacking, updateDemo } from '../lib/demo.ts';
import { localOperations, operationSamples, updateLocalOperation } from '../lib/operations-demo.ts';
import { demoTrashedInterventionsKey, readDemoTrash, writeDemoTrash } from '../lib/trash-demo.ts';
import { localDeadlineWorker, localWorkerDeadlines, workerDeadlineDemoSamples } from '../lib/worker-deadlines-demo.ts';

const today = '2026-11-20';
const trash = (kind, id, action = 'delete') => writeDemoTrash({ kind, id, action }, today);

function browserStorage(t) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  } });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  });
}

test('Nel cestino demo il cantiere conserva gli interventi e le modifiche a un’altra scheda non cancellano lo storico', async t => {
  browserStorage(t);
  const seed = getDemo(today);
  const client = seed.clients[0];
  const linkedSites = seed.sites.filter(site => site.client_id === client.id);
  const originalJobs = seed.jobs.filter(job => linkedSites.some(site => site.id === job.site_id));

  await assert.rejects(trash('client', client.id), /cantieri collegati/);
  for (const site of linkedSites) await trash('site', site.id);
  await trash('client', client.id);
  assert.equal(getDemo(today).clients.some(row => row.id === client.id), false);
  assert.equal(getDemo(today).jobs.some(job => originalJobs.some(original => original.id === job.id)), false);
  assert.throws(() => updateDemo(getDemoBacking(today), { ...linkedSites[0], action: 'site' }), /cantiere è nel cestino/);
  assert.throws(() => updateDemo(getDemoBacking(today), { ...originalJobs[0], action: 'job' }), /non è più disponibile/);

  const unrelated = seed.sites.find(site => !linkedSites.some(hidden => hidden.id === site.id));
  const edited = updateDemo(getDemoBacking(today), { ...unrelated, action: 'site', name: 'Nome aggiornato' });
  localStorage.setItem(demoKey, JSON.stringify(edited));
  await assert.rejects(trash('site', linkedSites[0].id, 'restore'), /Ripristina prima il cliente/);
  await trash('client', client.id, 'restore');
  for (const site of linkedSites) await trash('site', site.id, 'restore');
  assert.deepEqual(getDemo(today).jobs.filter(job => originalJobs.some(original => original.id === job.id)), originalJobs);
  assert.equal(getDemo(today).sites.find(site => site.id === unrelated.id).name, 'Nome aggiornato');
  assert.equal(readDemoTrash(today).length, 0);
});

test('Il cestino demo protegge la giacenza e mantiene lo stato archiviato delle schede', async t => {
  browserStorage(t);
  const [article, , receipt, withdrawal] = operationSamples(today);
  await assert.rejects(trash('operation', article.id), /movimenti attivi/);
  await assert.rejects(trash('operation', receipt.id), /giacenza sotto zero/);
  await trash('operation', withdrawal.id);
  await trash('operation', receipt.id);
  await trash('operation', article.id);
  assert.throws(() => updateLocalOperation(today, { action: 'restore', kind: article.kind, id: article.id }), /nel cestino/);
  await assert.rejects(trash('operation', receipt.id, 'restore'), /Ripristina prima l’articolo/);
  await trash('operation', article.id, 'restore');
  await assert.rejects(trash('operation', withdrawal.id, 'restore'), /giacenza sotto zero/);
  await trash('operation', receipt.id, 'restore');
  await trash('operation', withdrawal.id, 'restore');
  await trash('operation', article.id, 'restore');

  const worker = operationSamples(today).find(record => record.kind === 'worker');
  const [deadline] = workerDeadlineDemoSamples(today);
  updateLocalOperation(today, { action: 'archive', kind: worker.kind, id: worker.id });
  await trash('worker_deadline', deadline.id);
  await trash('operation', worker.id);
  assert.equal(localDeadlineWorker(today, worker.id), null);
  await assert.rejects(trash('worker_deadline', deadline.id, 'restore'), /Ripristina prima l’operaio/);
  await trash('operation', worker.id, 'restore');
  await trash('worker_deadline', deadline.id, 'restore');
  assert.equal(localOperations(today, 'personale').find(record => record.id === worker.id).archived, true);
  assert.equal(localWorkerDeadlines(today, worker.id).some(entry => entry.id === deadline.id), true);
});

test('Gli interventi eliminati prima dell’aggiornamento sono ripristinabili dal cestino demo', async t => {
  browserStorage(t);
  const seed = getDemoBacking(today);
  const [job, ...remaining] = seed.jobs;
  localStorage.setItem(demoKey, JSON.stringify({ ...seed, jobs: remaining }));
  localStorage.setItem(demoTrashedInterventionsKey, JSON.stringify([job]));
  const [entry] = readDemoTrash(today);
  assert.equal(entry.id, job.id);
  assert.equal(entry.deleted_at, '');
  assert.match(entry.label, /Palazzo Manzoni/);
  await trash('intervention', job.id, 'restore');
  assert.deepEqual(getDemo(today).jobs.find(row => row.id === job.id), job);
  await trash('intervention', job.id);
  assert.match(readDemoTrash(today)[0].deleted_at, /T/);
  await trash('intervention', job.id, 'restore');
  assert.deepEqual(getDemo(today).jobs.find(row => row.id === job.id), job);
});
