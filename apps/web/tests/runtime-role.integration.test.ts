import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool, transaction } from '../lib/server/core';
import { dbTests } from './helpers';
test(
  'runtime rejects a superuser credential before executing domain work',
  { skip: !dbTests },
  async () => {
    process.env.APP_DATABASE_URL = process.env.DATABASE_URL;
    let executed = false;
    try {
      await assert.rejects(
        () =>
          transaction(randomUUID(), async () => {
            executed = true;
          }),
        /must not bypass row-level security/,
      );
      assert.equal(executed, false);
    } finally {
      await pool().end();
    }
  },
);
