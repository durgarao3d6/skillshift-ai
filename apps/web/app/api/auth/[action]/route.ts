import { handle, HttpError } from '../../../../lib/server/core';
import { login, callback, logout } from '../../../../lib/server/auth';
export const runtime = 'nodejs';
export async function GET(req: Request, { params }: { params: Promise<{ action: string }> }) {
  return handle(async () => {
    const { action } = await params;
    if (action === 'login') return login(req);
    if (action === 'callback') return callback(req);
    throw new HttpError(404, 'Authentication route not found.');
  });
}
export async function POST(req: Request, { params }: { params: Promise<{ action: string }> }) {
  return handle(async () => {
    if ((await params).action === 'logout') return logout(req);
    throw new HttpError(404, 'Authentication route not found.');
  });
}
