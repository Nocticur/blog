import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker from '../worker/index.js';

test('removed endpoints resolve through the normal static 404 response', async () => {
  const paths = ['/mail/', '/mail/admin/', '/role/', '/api/mail-auth/login', '/api/mail-admin/session'];
  for (const path of paths) {
    for (const method of ['GET', 'POST']) {
      const request = new Request(`https://blog.example${path}`, { method });
      let calls = 0;
      const missing = new Response('Not found', { status: 404 });
      const response = await worker.fetch(request, { ASSETS: { fetch(received) {
        assert.equal(received, request);
        calls += 1;
        return Promise.resolve(missing);
      } } });
      assert.equal(response, missing);
      assert.equal(calls, 1);
      assert.equal(response.status, 404);
    }
  }
});

test('static response content, status and headers are preserved', async () => {
  const asset = new Response('article', { status: 200, headers: { 'etag': 'asset-version' } });
  const response = await worker.fetch(new Request('https://blog.example/posts/example/'), {
    ASSETS: { fetch: async () => asset },
  });
  assert.equal(response, asset);
  assert.equal(response.headers.get('etag'), 'asset-version');
  assert.equal(await response.text(), 'article');
});

test('legacy service worker scripts remain empty and uncached', async () => {
  for (const path of ['/sw.js', '/registerSW.js']) {
    const response = await worker.fetch(new Request(`https://blog.example${path}`), {
      ASSETS: { fetch() { assert.fail('legacy scripts must not reach assets'); } },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/javascript; charset=utf-8');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(await response.text(), '');
  }
});
