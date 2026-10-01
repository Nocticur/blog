import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { test } from 'node:test';
import { writingDevApi } from '../src/lib/writing-dev-api.mjs';

test('explicit local preview opens reading without a password and keeps unauthenticated writes blocked', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'writing-preview-test-'));
  await mkdir(path.join(root, 'src/content/posts'), { recursive: true });
  await writeFile(path.join(root, 'src/content/posts/note.md'), '---\ntitle: Preview\n---\nPreview body');
  let middleware;
  writingDevApi(root, { preview: true }).configureServer({ middlewares: { use(_prefix, handler) { middleware = handler; } }, watcher: { emit() {} } });
  const server = http.createServer((req, res) => { req.url = req.url.replace(/^\/api\/writing/, ''); middleware(req, res); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const session = await fetch(`${origin}/api/writing/session/`);
    assert.equal(session.status, 200);
    assert.equal((await session.json()).preview, true);
    assert.equal((await fetch(`${origin}/api/writing/posts/`)).status, 200);
    const write = await fetch(`${origin}/api/writing/posts/`, { method: 'POST', headers: { origin }, body: JSON.stringify({ title: 'Never written' }) });
    assert.equal(write.status, 403);
    assert.deepEqual(await readFile(path.join(root, 'src/content/posts/note.md'), 'utf8'), '---\ntitle: Preview\n---\nPreview body');
    const foreignHostStatus = await new Promise((resolve, reject) => {
      http.get(`${origin}/api/writing/session/`, { headers: { host: 'example.test' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
    });
    assert.equal(foreignHostStatus, 401);
    assert.equal((await fetch(`${origin}/api/writing/session/`, { headers: { origin: 'https://other.test' } })).status, 401);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test('local cookie session and concurrent article saves use the original revision in an isolated directory', async () => {
  const previous = process.env.WRITING_PASSWORD;
  process.env.WRITING_PASSWORD = 'temporary-test-password';
  const root = await mkdtemp(path.join(tmpdir(), 'writing-dev-test-'));
  await mkdir(path.join(root, 'src/content/posts'), { recursive: true });
  await writeFile(path.join(root, 'src/content/posts/note.md'), '---\ntitle: Original\npublished: 2026-09-30\ncustom: retained\n---\nOriginal body');
  let middleware;
  writingDevApi(root).configureServer({ middlewares: { use(_prefix, handler) { middleware = handler; } }, watcher: { emit() {} } });
  const server = http.createServer((req, res) => { req.url = req.url.replace(/^\/api\/writing/, ''); middleware(req, res); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  async function invoke(route, { method = 'GET', body, cookie, requestOrigin = origin } = {}) {
    const response = await fetch(`${origin}/api/writing/${route}`, { method, headers: { ...(requestOrigin ? { origin: requestOrigin } : {}), ...(cookie ? { cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, headers: response.headers, data: await response.json() };
  }
  try {
    const rejected = await invoke('auth/', { method: 'POST', requestOrigin: 'https://other.test', body: { password: 'temporary-test-password' } });
    assert.equal(rejected.status, 403);
    const auth = await invoke('auth/', { method: 'POST', body: { password: 'temporary-test-password' } });
    assert.equal(auth.status, 200);
    assert.equal(auth.data.token, undefined);
    const cookie = auth.headers.get('set-cookie').split(';')[0];
    assert.equal((await invoke('session/', { cookie })).status, 200);
    const read = await invoke('posts/?file=note.md', { cookie });
    const version = read.data.version;
    assert.ok(version);
    const saves = await Promise.all(['First', 'Second'].map(title => invoke('posts/', { method: 'PUT', cookie, body: { file: 'note.md', version, title, published: '2026-09-30', content: title } })));
    assert.deepEqual(saves.map(result => result.status).sort(), [200, 409]);
    assert.match(await readFile(path.join(root, 'src/content/posts/note.md'), 'utf8'), /custom: retained/);
    const reread = await invoke('posts/?file=note.md', { cookie });
    assert.notEqual(reread.data.version, version);
    const listed = await invoke('posts/', { cookie });
    assert.equal(listed.data.posts[0].version, reread.data.version);
    assert.equal((await invoke(`posts/?file=note.md&version=${version}`, { cookie, method: 'DELETE' })).status, 409);
    assert.equal((await invoke(`posts/?file=note.md&version=${reread.data.version}`, { cookie, method: 'DELETE' })).status, 200);
    assert.equal((await invoke('posts/', { method: 'PUT', cookie, body: { file: 'note.md', version, title: 'Recreate', published: '2026-09-30' } })).status, 409);
    const logout = await invoke('logout/', { method: 'POST', cookie });
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
    assert.equal((await invoke('session/')).status, 401);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true });
    if (previous === undefined) delete process.env.WRITING_PASSWORD; else process.env.WRITING_PASSWORD = previous;
  }
});
