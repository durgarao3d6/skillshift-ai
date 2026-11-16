import { handle, withActor } from '../../../lib/server/core';
import { inventory } from '../../../lib/server/domain';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  return handle(async () =>
    withActor(req, async (db, a) =>
      Response.json(await inventory(db, a, new URL(req.url).searchParams)),
    ),
  );
}
