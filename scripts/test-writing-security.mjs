import assert from 'node:assert/strict';
import { test, afterEach, mock } from 'node:test';
import handler from '../api/writing/[[...path]].js';
import { signSession, SESSION_COOKIE, MAX_REQUEST_BYTES } from '../api/_lib/writing-session.mjs';

const original = { ...process.env };
afterEach(() => { mock.restoreAll(); process.env = { ...original }; });
function setup() {
  process.env.WRITING_PASSWORD = 'isolated-test-password';
  process.env.WRITING_GITHUB_REPO = 'test/repo';
  process.env.WRITING_GITHUB_BRANCH = 'main';
  process.env.GITHUB_TOKEN = 'test-only';
}
async function invoke(route, { method = 'GET', body, cookie, origin = 'https://example.test', headers = {} } = {}) {
  const request = new Request(`https://example.test/api/writing/${route}`, {
    method, headers: { ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const response = await handler(request);
  return { status: response.status, headers: response.headers, data: await response.json() };
}
async function login() {
  setup();
  const result = await invoke('auth', { method: 'POST', body: { password: 'isolated-test-password' } });
  return result.headers.get('set-cookie')?.split(';')[0];
}
test('login keeps the signed session in a Secure HttpOnly same-site cookie', async () => {
  setup();
  const response = await invoke('auth', { method: 'POST', body: { password: 'isolated-test-password' } });
  assert.equal(response.status, 200);
  assert.equal(response.data.token, undefined);
  assert.equal(response.data.authenticated, true);
  assert.match(response.headers.get('set-cookie') || '', /HttpOnly/);
  assert.match(response.headers.get('set-cookie') || '', /Secure/);
  assert.match(response.headers.get('set-cookie') || '', /SameSite=Strict/);
  assert.match(response.headers.get('set-cookie') || '', /Path=\/api\/writing\//);
});
test('session is cookie-only and logout expires the cookie', async () => {
  const cookie = await login();
  assert.equal((await invoke('session', { cookie })).status, 200);
  assert.equal((await invoke('session')).status, 401);
  assert.equal((await invoke('session', { headers: { 'x-writing-auth': cookie?.split('=')[1] || '' } })).status, 401);
  const logout = await invoke('logout', { method: 'POST', cookie });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get('set-cookie') || '', /Max-Age=0/);
});
test('expired and tampered Cookie sessions are rejected', async () => {
  setup();
  const expired = signSession(process.env, -1);
  const valid = signSession();
  for (const value of [expired, `${valid}.extra`, valid.slice(0, -1) + '!']) {
    assert.equal((await invoke('session', { cookie: `${SESSION_COOKIE}=${value}` })).status, 401);
  }
});
test('write requests reject missing and cross-site Origin before touching GitHub', async () => {
  const cookie = await login();
  mock.method(globalThis, 'fetch', () => { assert.fail('No GitHub request for rejected origin'); });
  for (const origin of [undefined, 'https://evil.test']) {
    const response = await invoke('posts', { method: 'POST', cookie, origin: origin ?? '', body: { title: 'No write' } });
    assert.equal(response.status, 403);
  }
});
test('stale update and deletion cannot replace the current GitHub article', async () => {
  const cookie = await login();
  mock.method(globalThis, 'fetch', async (_url, init) => {
    assert.equal(init?.method, undefined, 'stale revisions must never perform PUT or DELETE');
    return Response.json({ sha: 'latest', content: Buffer.from('---\ntitle: Preserved\ncustom: yes\n---\nlatest body').toString('base64') });
  });
  for (const [method, route, body] of [
    ['PUT', 'posts', { file: 'note.md', version: 'old', title: 'stale', published: '2026-09-30', content: 'old body' }],
    ['DELETE', 'posts?file=note.md&version=old', undefined],
    ['PUT', 'posts', { file: 'note.md', title: 'unversioned', published: '2026-09-30' }],
  ]) assert.equal((await invoke(route, { method, body, cookie })).status, 409);
});
test('read gives version and update passes the exact revision plus commit metadata', async () => {
  const cookie = await login();
  mock.method(globalThis, 'fetch', async (_url, init) => {
    if (init?.method === 'PUT') {
      const body = JSON.parse(init.body);
      assert.equal(body.sha, 'v1');
      assert.match(Buffer.from(body.content, 'base64').toString(), /custom: keep/);
      return Response.json({ content: { sha: 'v2' }, commit: { sha: 'commit-2', html_url: 'https://github.com/test/repo/commit/commit-2' } });
    }
    return Response.json({ sha: 'v1', content: Buffer.from('---\ntitle: Existing\ncustom: keep\n---\nbody').toString('base64') });
  });
  const read = await invoke('posts?file=note.md', { cookie });
  assert.equal(read.data.version, 'v1');
  const saved = await invoke('posts', { cookie, method: 'PUT', body: { file: 'note.md', version: read.data.version, title: 'Updated', published: '2026-09-30', content: 'edited' } });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.version, 'v2');
  assert.equal(saved.data.commit.sha, 'commit-2');
});
test('a GitHub concurrency conflict returns 409 and missing article cannot be recreated by PUT', async () => {
  const cookie = await login();
  mock.method(globalThis, 'fetch', async (_url, init) => init?.method === 'PUT'
    ? Response.json({ message: 'sha mismatch' }, { status: 409 })
    : Response.json({ sha: 'v1', content: Buffer.from('body').toString('base64') }));
  const body = { file: 'note.md', version: 'v1', title: 'Title', published: '2026-09-30' };
  assert.equal((await invoke('posts', { cookie, method: 'PUT', body })).status, 409);
  mock.method(globalThis, 'fetch', async () => new Response(null, { status: 404 }));
  assert.equal((await invoke('posts', { cookie, method: 'PUT', body })).status, 409);
});
test('deleting an article removed by another client returns a revision conflict', async () => {
  const cookie = await login();
  mock.method(globalThis, 'fetch', async (_url, init) => {
    assert.equal(init?.method, undefined, 'a deleted article must not produce another DELETE commit');
    return new Response(null, { status: 404 });
  });
  assert.equal((await invoke('posts?file=note.md&version=old', { cookie, method: 'DELETE' })).status, 409);
});
test('encoded image request and decoded image are limited before GitHub writes', async () => {
  const cookie = await login();
  mock.method(globalThis, 'fetch', () => { assert.fail('No GitHub request for invalid image'); });
  const image = Buffer.alloc(3 * 1024 * 1024 + 1).toString('base64');
  const result = await invoke('images', { cookie, method: 'POST', body: { slug: 'test', dataUrl: `data:image/png;base64,${image}` } });
  assert.ok([400, 413].includes(result.status));
  const oversized = await invoke('images', { cookie, method: 'POST', body: { slug: 'test', dataUrl: 'x'.repeat(MAX_REQUEST_BYTES) } });
  assert.equal(oversized.status, 413);
});
test('invalid article paths cannot reach GitHub', async () => {
  const cookie = await login();
  mock.method(globalThis, 'fetch', () => { assert.fail('No GitHub requests for illegal paths'); });
  for (const file of ['../secret.md', 'x/../../secret.md', '/outside.md', 'x//note.md']) {
    const response = await invoke(`posts?file=${encodeURIComponent(file)}`, { cookie });
    assert.equal(response.status, 400);
  }
});
