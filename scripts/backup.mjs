import { spawn } from 'node:child_process';
const output = process.argv[2];
if (!output || !process.env.DATABASE_URL)
  throw new Error(
    'Usage: backup.mjs <output.dump>; requires schema-owner DATABASE_URL and pg_dump in PATH.',
  );
const u = new URL(process.env.DATABASE_URL);
const env = {
  ...process.env,
  PGHOST: u.hostname,
  PGPORT: u.port || '5432',
  PGUSER: decodeURIComponent(u.username),
  PGPASSWORD: decodeURIComponent(u.password),
  PGDATABASE: u.pathname.slice(1),
  PGSSLMODE: u.searchParams.get('sslmode') || 'prefer',
};
delete env.DATABASE_URL;
const child = spawn('pg_dump', ['--format=custom', '--no-owner', '--file', output], {
  env,
  stdio: 'inherit',
});
child.on('error', () => {
  console.error('pg_dump could not start');
  process.exitCode = 1;
});
child.on('exit', (code) => (process.exitCode = code || 0));
