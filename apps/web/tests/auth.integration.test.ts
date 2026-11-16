import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { createHash } from 'node:crypto';
import { GET, POST } from '../app/api/auth/[action]/route';
import { GET as workspaceGET } from '../app/api/workspace/[...path]/route';
import { fixture, dbTests } from './helpers';
import { pool, transaction, sessionSecret } from '../lib/server/core';
test(
  'OIDC PKCE, nonce/state, signed sessions, logout and production demo rejection',
  { skip: !dbTests },
  async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const jwk = await exportJWK(publicKey);
    jwk.kid = 'test-key';
    jwk.alg = 'RS256';
    let issuer = '',
      nonce = '',
      challenge = '',
      badNonce = false;
    const server = createServer(async (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/.well-known/openid-configuration')
        return res.end(
          JSON.stringify({
            issuer,
            authorization_endpoint: issuer + '/authorize',
            token_endpoint: issuer + '/token',
            jwks_uri: issuer + '/keys',
          }),
        );
      if (req.url === '/keys') return res.end(JSON.stringify({ keys: [jwk] }));
      if (req.url === '/token') {
        let data = '';
        for await (const chunk of req) data += chunk;
        const form = new URLSearchParams(data);
        assert.equal(
          createHash('sha256').update(form.get('code_verifier')!).digest('base64url'),
          challenge,
        );
        const token = await new SignJWT({ nonce: badNonce ? 'wrong' : nonce })
          .setSubject('employee')
          .setIssuer(issuer)
          .setAudience('test-client')
          .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
          .setIssuedAt()
          .setExpirationTime('5m')
          .sign(privateKey);
        return res.end(JSON.stringify({ id_token: token }));
      }
      res.statusCode = 404;
      res.end('{}');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    issuer = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
    const f = await fixture(issuer);
    process.env.OIDC_ISSUER = issuer;
    process.env.OIDC_CLIENT_ID = 'test-client';
    process.env.APP_URL = 'http://localhost:3000';
    try {
      const start = await GET(
        new Request('http://localhost:3000/api/auth/login?tenant=' + f.tenantId),
        { params: Promise.resolve({ action: 'login' }) },
      );
      assert.equal(start.status, 302);
      const auth = new URL(start.headers.get('location')!);
      nonce = auth.searchParams.get('nonce')!;
      challenge = auth.searchParams.get('code_challenge')!;
      assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');
      const flow = start.headers.get('set-cookie')!.split(';')[0];
      assert.ok(flow.includes('skillshift-flow='));
      const wrong = await GET(
        new Request('http://localhost:3000/api/auth/callback?code=code&state=wrong', {
          headers: { cookie: flow },
        }),
        { params: Promise.resolve({ action: 'callback' }) },
      );
      assert.equal(wrong.status, 401);
      const callbackUrl =
        'http://localhost:3000/api/auth/callback?code=code&state=' + auth.searchParams.get('state');
      badNonce = true;
      assert.equal(
        (
          await GET(new Request(callbackUrl, { headers: { cookie: flow } }), {
            params: Promise.resolve({ action: 'callback' }),
          })
        ).status,
        401,
      );
      badNonce = false;
      const logged = await GET(new Request(callbackUrl, { headers: { cookie: flow } }), {
        params: Promise.resolve({ action: 'callback' }),
      });
      assert.equal(logged.status, 302, await logged.clone().text());
      const cookie = logged.headers
        .getSetCookie()
        .find((c) => c.startsWith('skillshift-session='))!
        .split(';')[0];
      const request = () =>
        new Request('http://localhost:3000/api/workspace/state', { headers: { cookie } });
      const state = await workspaceGET(request(), { params: Promise.resolve({ path: ['state'] }) });
      assert.equal(state.status, 200);
      assert.equal((await state.json()).actor.role, 'employee');
      assert.equal(
        (
          await workspaceGET(
            new Request('http://localhost:3000/api/workspace/state', {
              headers: { cookie: cookie + 'tampered' },
            }),
            { params: Promise.resolve({ path: ['state'] }) },
          )
        ).status,
        401,
      );
      const logout = await POST(
        new Request('http://localhost:3000/api/auth/logout', {
          method: 'POST',
          headers: { cookie, origin: 'http://localhost:3000' },
        }),
        { params: Promise.resolve({ action: 'logout' }) },
      );
      assert.equal(logout.status, 200);
      assert.equal(
        (await workspaceGET(request(), { params: Promise.resolve({ path: ['state'] }) })).status,
        401,
      );
      const expired = await new SignJWT({ tid: f.tenantId, sid: crypto.randomUUID() })
        .setSubject(f.users.employee.userId)
        .setIssuer('skillshift')
        .setAudience('skillshift-web')
        .setExpirationTime('1s')
        .setIssuedAt(Math.floor(Date.now() / 1000) - 60)
        .setExpirationTime(Math.floor(Date.now() / 1000) - 1)
        .setProtectedHeader({ alg: 'HS256' })
        .sign(sessionSecret());
      assert.equal(
        (
          await workspaceGET(
            new Request('http://localhost:3000/api/workspace/state', {
              headers: { cookie: 'skillshift-session=' + expired },
            }),
            { params: Promise.resolve({ path: ['state'] }) },
          )
        ).status,
        401,
      );
      const original = process.env.NODE_ENV;
      Object.assign(process.env, { NODE_ENV: 'production', SKILLSHIFT_DEMO_MODE: 'true' });
      assert.equal(
        (
          await workspaceGET(
            new Request('http://localhost:3000/api/workspace/state', {
              headers: { 'x-demo-user': 'admin' },
            }),
            { params: Promise.resolve({ path: ['state'] }) },
          )
        ).status,
        401,
      );
      Object.assign(process.env, { NODE_ENV: original || 'test', SKILLSHIFT_DEMO_MODE: 'false' });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await f.admin.end();
      await pool().end();
    }
  },
);
