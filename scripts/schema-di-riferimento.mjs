import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';

const migrations = new URL('../supabase/migrations/', import.meta.url);

export async function referenceMigrations() {
  return (await readdir(migrations)).filter(name => /^[0-9]+_.+\.sql$/.test(name)).sort();
}

export async function openReferenceSchema() {
  const db = new PGlite({ extensions: { btree_gist } });
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema auth;
      create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      grant usage on schema auth to anon, authenticated;
      create schema storage;
      create table storage.buckets (
        id text primary key, name text not null, public boolean, file_size_limit bigint, allowed_mime_types text[]
      );
      create table storage.objects (
        bucket_id text not null references storage.buckets, name text not null, metadata jsonb, primary key (bucket_id, name)
      );
      alter table storage.objects enable row level security;
      grant usage on schema storage to anon, authenticated;
    `);
    const names = await referenceMigrations();
    for (const name of names) await db.exec(await readFile(new URL(name, migrations), 'utf8'));
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}
