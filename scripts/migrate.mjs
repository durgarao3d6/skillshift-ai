import pg from 'pg';
import { readFile, readdir } from 'node:fs/promises';
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is required (schema-owner credential).');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query("SELECT pg_advisory_lock(hashtext('skillshift-migrations'))");
  await client.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())',
  );
  const applied = new Set(
    (await client.query('SELECT version FROM schema_migrations')).rows.map((x) => x.version),
  );
  for (const file of (await readdir(new URL('../db/', import.meta.url)))
    .filter((x) => /^\d+.*\.sql$/.test(x))
    .sort()) {
    const version = file.replace(/\.sql$/, '');
    if (applied.has(version)) continue;
    await client.query(await readFile(new URL('../db/' + file, import.meta.url), 'utf8'));
    console.log('Applied', version);
  }
} finally {
  await client.query("SELECT pg_advisory_unlock(hashtext('skillshift-migrations'))");
  await client.end();
}
