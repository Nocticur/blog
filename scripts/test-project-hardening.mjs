import assert from 'node:assert/strict';
import test, { afterEach, mock } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createLocalStore, executeContent } from '../api/_lib/content-management.mjs';
import handler from '../api/writing/[[...path]].js';
import { signSession, SESSION_COOKIE } from '../api/_lib/writing-session.mjs';
import { writingDevApi } from '../src/lib/writing-dev-api.mjs';
import { mergeGuestbookMessages } from '../src/utils/guestbook-chat.ts';

const originalEnv = { ...process.env };
afterEach(() => { mock.restoreAll(); process.env = { ...originalEnv }; });
function configure() {
  Object.assign(process.env, { WRITING_PASSWORD: 'hardening-test-only', WRITING_GITHUB_REPO: 'test/repo', WRITING_GITHUB_BRANCH: 'main', GITHUB_TOKEN: 'test-only' });
  return `${SESSION_COOKIE}=${signSession()}`;
}
async function invoke(route, body) {
  return handler(new Request(`https://example.test/api/writing/${route}`, {
    method: 'POST', headers: { origin: 'https://example.test', cookie: configure() }, body: JSON.stringify(body),
  }));
}

test('development search serves the real built index with correct MIME and cannot escape its directory', async () => {
  const { pagefindDev } = await import('../src/lib/pagefind-dev.mjs').catch(() => ({}));
  assert.equal(typeof pagefindDev, 'function');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'blog-search-preview-'));
  let middleware;
  let server;
  try {
    await fs.mkdir(path.join(root,'dist/pagefind'), {recursive:true});
    await fs.writeFile(path.join(root,'dist/pagefind/pagefind.js'),'export default "actual built index";');
    await fs.writeFile(path.join(root,'private.txt'),'private');
    pagefindDev(root).configureServer({middlewares:{use(_prefix,handler){middleware=handler;}}});
    server=http.createServer((req,res)=>middleware(req,res,()=>{res.statusCode=404;res.end();}));
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const origin=`http://127.0.0.1:${server.address().port}`;
    const response=await fetch(origin+'/pagefind.js');
    assert.equal(response.status,200); assert.match(response.headers.get('Content-Type'),/javascript/);
    assert.match(await response.text(),/actual built index/);
    assert.equal((await fetch(origin+'/%2e%2e%2f%2e%2e%2fprivate.txt')).status,404);
  } finally { if(server)await new Promise(resolve=>server.close(resolve)); await fs.rm(root,{recursive:true,force:true}); }
});

test('content validation rejects executable Frontmatter engines before writing', async () => {
  const store = { read: async () => null, write: async () => { assert.fail('Rejected source must not be written'); } };
  for (const language of ['js', 'javascript', 'coffee', 'coffeescript']) {
    await assert.rejects(() => executeContent(store, 'notebooks', 'POST', { file: 'note.md', source: `---${language}\n({ title: "Safe test data" })\n---\nbody` }), /Frontmatter/);
  }
});

test('safe frontmatter accepts YAML aliases and JSON consistently', async () => {
  const { default: matter } = await import('../api/_lib/safe-matter.mjs');
  for (const lang of ['', 'yaml', 'yml', 'YAML']) {
    assert.equal(matter(`---${lang}\ntitle: Note\n---\nBody`).data.title, 'Note');
  }
  assert.equal(matter('---json\n{"title":"Note"}\n---\nBody').data.title, 'Note');
});

test('login attempt limits expire, isolate clients and retain abuse history after a successful password', async () => {
  const { createLoginLimiter } = await import('../api/_lib/login-limiter.mjs').catch(() => ({}));
  assert.equal(typeof createLoginLimiter, 'function');
  let now = 0;
  const limiter = createLoginLimiter({ limit: 3, windowMs: 15000, now: () => now, maxClients: 2 });
  for (let attempt = 0; attempt < 3; attempt++) assert.equal(limiter.consume('one'), 0);
  assert.equal(limiter.consume('one'), 15);
  assert.equal(limiter.consume('two'), 0);
  assert.equal(limiter.consume('three'), 15, 'capacity exhaustion fails closed without evicting active limits');
  now = 15001;
  assert.equal(limiter.consume('one'), 0);
});

test('online login rejects repeated attempts with Retry-After before evaluating a password', async () => {
  configure();
  process.env.VERCEL = '1';
  const login = password => handler(new Request('https://example.test/api/writing/auth', {
    method: 'POST', headers: { origin: 'https://example.test', 'x-vercel-forwarded-for': '192.0.2.100' }, body: JSON.stringify({ password }),
  }));
  for (let i = 0; i < 10; i++) assert.equal((await login('wrong')).status, 401);
  const response = await login('hardening-test-only');
  assert.equal(response.status, 429);
  assert.ok(Number(response.headers.get('Retry-After')) > 0);
});

test('content manager lists and edits MDX records with revision checks', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'blog-hardening-'));
  try {
    const store = createLocalStore(root);
    const saved = await executeContent(store, 'notebooks', 'POST', { file: 'note.mdx', source: '---\ntitle: MDX\n---\n# A note' });
    assert.deepEqual((await executeContent(store, 'notebooks', 'GET')).items, [{ file: 'note.mdx' }]);
    assert.equal((await executeContent(store, 'notebooks', 'GET', { file: 'note.mdx' })).version, saved.version);
    await assert.rejects(() => executeContent(store, 'notebooks', 'PUT', { file: 'note.mdx', version: 'stale', source: '---\ntitle: Changed\n---' }), /冲突/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('online article saves reject impossible and invalid updated dates before GitHub', async () => {
  mock.method(globalThis, 'fetch', () => { assert.fail('Invalid dates must not reach GitHub'); });
  for (const dates of [{ published: '2026-02-30' }, { published: '2026-10-02', updated: 'invalid' }, { published: '2026-10-02', updated: '2026-02-30' }]) {
    assert.equal((await invoke('posts', { slug: 'note', title: 'Note', ...dates })).status, 400);
  }
});

test('online uploads in the same second create distinct image paths', async () => {
  const paths = [];
  mock.method(globalThis, 'fetch', async (url, init) => { assert.equal(init.method, 'PUT'); paths.push(String(url)); return Response.json({ content: { sha: 'image' } }); });
  const body = { slug: 'note', dataUrl: 'data:image/png;base64,aW1hZ2U=' };
  const first = await invoke('images', body);
  const second = await invoke('images', body);
  assert.equal(first.status, 200); assert.equal(second.status, 200);
  assert.notEqual(paths[0], paths[1]);
});

test('local uploads cannot overwrite each other and invalid dates leave no article', async () => {
  configure();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'blog-local-hardening-'));
  let middleware;
  writingDevApi(root).configureServer({ middlewares: { use(_prefix, handler) { middleware = handler; } }, watcher: { emit() {} } });
  const server = http.createServer((req, res) => { req.url = req.url.replace(/^\/api\/writing/, ''); middleware(req, res); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  async function post(route, body) { return fetch(`${origin}/api/writing/${route}`, { method: 'POST', headers: { origin, cookie: `${SESSION_COOKIE}=${signSession()}` }, body: JSON.stringify(body) }); }
  try {
    const body = { slug: 'note', dataUrl: 'data:image/png;base64,aW1hZ2U=' };
    const first = await (await post('images', body)).json();
    const second = await (await post('images', body)).json();
    assert.notEqual(first.image, second.image);
    const response = await post('posts', { slug: 'bad', title: 'Bad date', published: '2026-10-02', updated: 'invalid' });
    assert.equal(response.status, 400);
    await assert.rejects(fs.access(path.join(root, 'src/content/posts/bad.md')));
    for (let i = 0; i < 10; i++) assert.equal((await post('auth', {password:'wrong'})).status, 401);
    const limited = await post('auth', {password:'hardening-test-only'});
    assert.equal(limited.status, 429); assert.ok(Number(limited.headers.get('Retry-After')) > 0);
  } finally { await new Promise(resolve => server.close(resolve)); await fs.rm(root, { recursive: true, force: true }); }
});

test('authoritative guestbook refresh removes deleted or no-longer-visible server messages', () => {
  const current = [{ id: 'private', createdAt: 1 }, { id: 'pending', createdAt: 3, localState: 'sending' }];
  assert.deepEqual(mergeGuestbookMessages(current, [{ id: 'public', createdAt: 2 }], { replace: true }).map(message => message.id), ['public', 'pending']);
});

test('share metadata has an absolute cover/default fallback without generating images', async () => {
  const { resolveShareImage } = await import('../src/utils/share-image.ts').catch(() => ({}));
  assert.equal(typeof resolveShareImage, 'function');
  const site = new URL('https://example.test/blog/');
  assert.equal(resolveShareImage({ site, cover: '/cover.jpg', fallback: '/default.jpg' }), 'https://example.test/cover.jpg');
  assert.equal(resolveShareImage({ site, fallback: '/default.jpg' }), 'https://example.test/default.jpg');
  assert.equal(resolveShareImage({ site, cover: 'javascript:alert(1)', fallback: '/default.jpg' }), 'https://example.test/default.jpg');
});

test('password-protected articles expose only explicit public descriptions', async () => {
  const { getPublicPostDescription, getPublicPostHeadings } = await import('../src/utils/public-post-metadata.ts').catch(() => ({}));
  assert.equal(typeof getPublicPostDescription, 'function');
  assert.equal(getPublicPostDescription({ password: 'secret', description: '' }, 'Private body'), '');
  assert.equal(getPublicPostDescription({ password: 'secret', description: 'Public summary' }, 'Private body'), 'Public summary');
  assert.deepEqual(getPublicPostHeadings({ password: 'secret' }, [{ depth: 2, text: 'Private heading', slug: 'private' }]), []);
});
