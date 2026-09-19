import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker from '../worker/index.js';
import authHandler from '../api/mail-auth/[[...path]].js';
import adminHandler from '../api/mail-admin/[[...path]].js';

test('disabled mail routes never access assets or upstream services', async () => {
  for (const path of ['/api/mail-auth', '/api/mail-auth/login', '/api/mail-auth/register', '/api/mail-auth/mails', '/api/mail-admin', '/api/mail-admin/login', '/api/mail-admin/proxy/admin/users']) {
    const response = await worker.fetch(new Request(`https://blog.example${path}`), {});
    assert.equal(response.status, 410, path);
    assert.equal((await response.json()).code, 'MAIL_DISABLED');
  }
});

test('Vercel mail handlers are disabled even without configuration', async () => {
  for (const handler of [authHandler, adminHandler]) {
    const res = {
      setHeader() {},
      status(value) { this.statusCode = value; return this; },
      json(value) { this.body = value; return this; },
    };
    await handler({}, res);
    assert.equal(res.statusCode, 410);
    assert.equal(res.body.code, 'MAIL_DISABLED');
  }
});

test('unrelated worker paths still serve assets', async () => {
  const response = await worker.fetch(new Request('https://blog.example/about/'), {
    ASSETS: { fetch: async () => new Response('about') },
  });
  assert.equal(await response.text(), 'about');
});
