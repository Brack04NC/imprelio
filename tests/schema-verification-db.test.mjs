import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { openReferenceSchema, referenceMigrations } from '../scripts/schema-di-riferimento.mjs';

test('La verifica Supabase legge le firme effettive anche senza una cronologia CLI', async t => {
  const db = await openReferenceSchema();
  t.after(() => db.close());
  const sql = await readFile(new URL('../supabase/verifica-schema.sql', import.meta.url), 'utf8');
  const check = async () => (await db.query(sql)).rows[0];
  await db.exec('begin read only');
  const clean = await check();
  assert.equal(clean.esito, 'OK');
  assert.equal(clean.migrazione_attesa, (await referenceMigrations()).at(-1).split('_', 1)[0]);
  assert.deepEqual(clean.differenze, []);
  assert.ok(clean.controlli > 200);
  await db.exec('rollback');

  await db.exec(`
    alter table imprelio_private.trashed_records disable row level security;
    alter table public.document_imports disable row level security;
    alter table public.document_imports drop constraint document_imports_organization_id_site_id_fkey;
    alter policy document_original_read_guard on storage.objects using (true);
    grant execute on function public.imprelio_finish_document(uuid, uuid, jsonb) to anon;
    drop function public.imprelio_attach_estimate_document(uuid, uuid, jsonb);
    update storage.buckets set public = true where id = 'document-originals';
    create table public.oggetto_di_altro_applicativo (id int);
    create policy unrelated_storage on storage.objects for all to authenticated using (true) with check (true);
  `);
  await db.exec('begin read only');
  const changed = await check();
  assert.equal(changed.esito, 'SCHEMA_DA_VERIFICARE');
  assert.deepEqual(changed.differenze, [
    { tipo: 'bucket', oggetto: 'document-originals', stato: 'differente' },
    { tipo: 'funzione', oggetto: 'public.imprelio_attach_estimate_document(uuid, uuid, jsonb)', stato: 'mancante' },
    { tipo: 'funzione', oggetto: 'public.imprelio_finish_document(uuid, uuid, jsonb)', stato: 'differente' },
    { tipo: 'policy', oggetto: 'storage.objects.document_original_read_guard', stato: 'differente' },
    { tipo: 'tabella', oggetto: 'imprelio_private.trashed_records', stato: 'differente' },
    { tipo: 'tabella', oggetto: 'public.document_imports', stato: 'differente' },
    { tipo: 'vincolo', oggetto: 'public.document_imports.document_imports_organization_id_site_id_fkey', stato: 'mancante' },
  ]);
  await db.exec('rollback');
});
