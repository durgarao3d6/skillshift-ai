import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pool, transaction, onRollback } from '../lib/server/core';
import { putPrivate, getPrivate, deletePrivate } from '../lib/server/storage';
import { fixture, dbTests } from './helpers';
test(
  'rolled-back evidence writes are compensated and private paths reject traversal',
  { skip: !dbTests },
  async () => {
    const f = await fixture();
    const root = await mkdtemp(path.join(tmpdir(), 'skillshift-storage-'));
    process.env.PRIVATE_STORAGE_PATH = root;
    const key = `tenants/${f.tenantId}/evidence/${randomUUID()}`;
    try {
      await assert.rejects(
        () =>
          transaction(f.tenantId, async (db) => {
            await putPrivate(key, Buffer.from('Synthetic evidence'));
            onRollback(db, () => deletePrivate(key));
            throw new Error('Synthetic transaction failure');
          }),
        /Synthetic transaction failure/,
      );
      await assert.rejects(() => getPrivate(key));
      await assert.rejects(
        () => putPrivate(`tenants/${f.tenantId}/../escape`, Buffer.from('invalid')),
        /Invalid private object key/,
      );
    } finally {
      await f.admin.end();
      await pool().end();
      await rm(root, { recursive: true, force: true });
    }
  },
);
