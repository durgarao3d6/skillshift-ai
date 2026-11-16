import pg from 'pg';
import {readFile} from 'node:fs/promises';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const client = new pg.Client({connectionString:process.env.DATABASE_URL});
await client.connect();
try { await client.query(await readFile(new URL('../db/001-inventory.sql',import.meta.url),'utf8')); console.log('Inventory migration applied.'); }
finally {await client.end();}
