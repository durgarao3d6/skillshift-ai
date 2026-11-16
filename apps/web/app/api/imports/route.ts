import { handle, withActor, body } from '../../../lib/server/core';
import { importInventory } from '../../../lib/server/domain';
export const runtime = 'nodejs';
export async function POST(req: Request) {
  return handle(async () =>
    withActor(req, async (db, a) =>
      Response.json(await importInventory(db, a, await body(req, 12 * 1024 * 1024))),
    ),
  );
}
