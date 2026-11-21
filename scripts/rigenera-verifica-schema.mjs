import { readFile, writeFile } from 'node:fs/promises';
import { openReferenceSchema, referenceMigrations } from './schema-di-riferimento.mjs';

const file = new URL('../supabase/verifica-schema.sql', import.meta.url);
const region = /(-- INIZIO FIRME GENERATE\n)[\s\S]*?(\n-- FINE FIRME GENERATE)/;
const report = '-- INIZIO RAPPORTO';
const template = await readFile(file, 'utf8');
const sqlLiteral = value => "'" + value.replaceAll("'", "''") + "'";
const signatures = rows => rows.map(row => '  (' + [row.tipo, row.oggetto, row.firma].map(sqlLiteral).join(', ') + ')').join(',\n');
const withSignatures = rows => template.replace(region, (_, start, end) => start + signatures(rows) + end);

const db = await openReferenceSchema();
try {
  const { rows: tables } = await db.query(`
    select 'tabella' as tipo, n.nspname || '.' || c.relname as oggetto, '' as firma
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p') and n.nspname in ('public', 'imprelio_private')
    order by 2
  `);
  const input = withSignatures(tables);
  const { rows } = await db.query(input.slice(0, input.indexOf(report)) + 'select * from attuale order by tipo, oggetto;');
  const migration = (await referenceMigrations()).at(-1).split('_', 1)[0];
  const output = withSignatures(rows).replace(/'[0-9]+' as migrazione_attesa/, `'${migration}' as migrazione_attesa`);
  const { rows: [validation] } = await db.query(output);
  if (validation.esito !== 'OK') throw new Error('Firma di riferimento non verificabile. ' + JSON.stringify(validation.differenze));
  if (output !== template) await writeFile(file, output);
  console.log(`Firme verificate: ${rows.length}`);
} finally { await db.close(); }
