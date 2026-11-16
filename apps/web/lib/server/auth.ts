import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify, EncryptJWT, jwtDecrypt, createRemoteJWKSet } from 'jose';
import { z } from 'zod';
import {
  pool,
  transaction,
  sessionSecret,
  cookies,
  HttpError,
  assertOrigin,
  withActor,
  audit,
} from './core';
const base64 = (n: number) => randomBytes(n).toString('base64url');
const secure = () => (process.env.NODE_ENV === 'production' ? '; Secure' : '');
const cookie = (name: string, value: string, age: number) =>
  `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure()}`;
function config() {
  const issuer = process.env.OIDC_ISSUER,
    clientId = process.env.OIDC_CLIENT_ID,
    appUrl = process.env.APP_URL;
  if (!issuer || !clientId || !appUrl)
    throw new HttpError(503, 'Configure OIDC_ISSUER, OIDC_CLIENT_ID and APP_URL.');
  if (
    process.env.NODE_ENV === 'production' &&
    (!issuer.startsWith('https://') || !appUrl.startsWith('https://'))
  )
    throw new HttpError(503, 'Production authentication requires HTTPS.');
  return { issuer, clientId, redirect: new URL('/api/auth/callback', appUrl).href };
}
async function discovery() {
  const c = config();
  const r = await fetch(c.issuer.replace(/\/$/, '') + '/.well-known/openid-configuration', {
    signal: AbortSignal.timeout(10000),
    cache: 'no-store',
  });
  if (!r.ok) throw new HttpError(503, 'Identity provider discovery unavailable.');
  const d = await r.json();
  if (d.issuer !== c.issuer || !d.authorization_endpoint || !d.token_endpoint || !d.jwks_uri)
    throw new HttpError(503, 'Invalid identity provider configuration.');
  if (
    process.env.NODE_ENV === 'production' &&
    [d.authorization_endpoint, d.token_endpoint, d.jwks_uri].some(
      (u) => !String(u).startsWith('https://'),
    )
  )
    throw new HttpError(503, 'Identity provider endpoints must use HTTPS.');
  return { ...c, ...d };
}
export async function login(req: Request) {
  const tenant = z.uuid().parse(new URL(req.url).searchParams.get('tenant'));
  const c = await discovery();
  const state = base64(32),
    nonce = base64(32),
    verifier = base64(48);
  const flow = await new EncryptJWT({ tenant, state, nonce, verifier })
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuer('skillshift-flow')
    .setAudience('oidc-callback')
    .setIssuedAt()
    .setExpirationTime('10m')
    .encrypt(createHash('sha256').update(sessionSecret()).digest());
  const url = new URL(c.authorization_endpoint);
  Object.entries({
    client_id: c.clientId,
    redirect_uri: c.redirect,
    response_type: 'code',
    scope: 'openid profile',
    state,
    nonce,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
  }).forEach(([k, v]) => url.searchParams.set(k, v));
  return new Response(null, {
    status: 302,
    headers: { Location: url.href, 'Set-Cookie': cookie('skillshift-flow', flow, 600) },
  });
}
export async function callback(req: Request) {
  const c = await discovery();
  const url = new URL(req.url);
  let flow;
  try {
    flow = (
      await jwtDecrypt(
        cookies(req)['skillshift-flow'] || '',
        createHash('sha256').update(sessionSecret()).digest(),
        { issuer: 'skillshift-flow', audience: 'oidc-callback' },
      )
    ).payload;
  } catch {
    throw new HttpError(401, 'Login flow expired. Start again.');
  }
  if (url.searchParams.get('state') !== flow.state || !url.searchParams.get('code'))
    throw new HttpError(401, 'Invalid login response.');
  const tokenBody = new URLSearchParams({
    grant_type: 'authorization_code',
    code: url.searchParams.get('code')!,
    redirect_uri: c.redirect,
    client_id: c.clientId,
    code_verifier: String(flow.verifier),
  });
  if (process.env.OIDC_CLIENT_SECRET)
    tokenBody.set('client_secret', process.env.OIDC_CLIENT_SECRET);
  const response = await fetch(c.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenBody,
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new HttpError(401, 'Identity provider rejected the login.');
  const tokens = await response.json();
  let claims;
  try {
    claims = (
      await jwtVerify(tokens.id_token, createRemoteJWKSet(new URL(c.jwks_uri)), {
        issuer: c.issuer,
        audience: c.clientId,
        algorithms: ['RS256', 'ES256', 'PS256'],
        requiredClaims: ['exp', 'iat', 'sub', 'nonce'],
      })
    ).payload;
  } catch {
    throw new HttpError(401, 'Invalid identity token.');
  }
  if (
    claims.nonce !== flow.nonce ||
    typeof claims.sub !== 'string' ||
    (Array.isArray(claims.aud) && claims.aud.length > 1 && claims.azp !== c.clientId)
  )
    throw new HttpError(401, 'Identity token validation failed.');
  const tenant = z.uuid().parse(flow.tenant);
  const sessionId = randomUUID();
  const user = await transaction(tenant, async (db) => {
    const user = (
      await db.query('SELECT id FROM app_users WHERE issuer=$1 AND subject=$2', [
        c.issuer,
        claims.sub,
      ])
    ).rows[0];
    if (!user)
      throw new HttpError(
        403,
        'Ask an administrator to provision your identity before signing in.',
      );
    if (
      !(await db.query('SELECT 1 FROM memberships WHERE user_id=$1 AND active=true', [user.id]))
        .rowCount
    )
      throw new HttpError(403, 'No membership in the selected tenant.');
    await db.query(
      "INSERT INTO sessions(id,tenant_id,user_id,expires_at) VALUES($1,$2,$3,now()+interval '8 hours')",
      [sessionId, tenant, user.id],
    );
    await audit(db, null, tenant, 'auth.login', sessionId);
    return user;
  });
  const token = await new SignJWT({ tid: tenant, sid: sessionId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuer('skillshift')
    .setAudience('skillshift-web')
    .setIssuedAt()
    .setExpirationTime('8h')
    .sign(sessionSecret());
  const headers = new Headers({ Location: '/workspace' });
  headers.append('Set-Cookie', cookie('skillshift-session', token, 28800));
  headers.append('Set-Cookie', cookie('skillshift-flow', '', 0));
  return new Response(null, { status: 302, headers });
}
export async function logout(req: Request) {
  assertOrigin(req);
  await withActor(req, async (db, actor) => {
    const token = cookies(req)['skillshift-session'];
    if (token) {
      const { payload } = await jwtVerify(token, sessionSecret(), {
        issuer: 'skillshift',
        audience: 'skillshift-web',
        algorithms: ['HS256'],
      });
      await db.query('DELETE FROM sessions WHERE id=$1 AND user_id=$2', [
        payload.sid,
        actor.userId,
      ]);
    }
  });
  return Response.json(
    { ok: true },
    { headers: { 'Set-Cookie': cookie('skillshift-session', '', 0) } },
  );
}
