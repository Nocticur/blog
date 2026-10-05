import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const policy = require('../.github/scripts/friend-policy.cjs');
const health = await import('./friend-health.mjs').catch(() => ({}));
const shots = await import('./friend-screenshots.mjs').catch(() => ({}));
const store = await import('../.github/scripts/friend-report-store.mjs').catch(() => ({}));

const now = new Date('2026-10-05T02:00:00.000Z');
const friend = { title: 'Example', siteurl: 'https://example.com/', enabled: true };
const screenshot = 'https://image.example/file/previous.webp';
const page = (status = 200, content = '') => ({ status, content, actualUrl: friend.siteurl });

test('report screenshot matching uses the shared site key with query strings and trailing path slashes', () => {
  assert.equal(typeof health.normalizedFriendUrl, 'function');
  assert.equal(health.normalizedFriendUrl('https://example.com/blog/?lang=zh#top'), 'https://example.com/blog?lang=zh');
});

test('health checks only enabled sites and reports HTTP restriction without failing the run', async () => {
  assert.equal(typeof health.checkFriends, 'function', 'friend health report generator is implemented');
  const report = await health.checkFriends([friend, { ...friend, enabled: false }], {
    now, fetchPage: async () => page(403), ownUrl: 'https://blog.example/',
  });
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.checkedAt, now.toISOString());
  assert.equal(report.results.length, 1);
  assert.deepEqual(Object.keys(report.results[0]).sort(), ['title', 'url', 'status', 'checkedAt', 'httpStatus', 'latencyMs', 'backlink', 'screenshotUrl', 'screenshotAt'].sort());
  assert.equal(report.results[0].status, 'restricted');
  assert.equal(report.results[0].httpStatus, 403);
  assert.equal(report.results[0].backlink, 'unchecked');
});

test('timeouts produce an error result while other links continue to be checked', async () => {
  assert.equal(typeof health.checkFriends, 'function');
  const report = await health.checkFriends([friend, { ...friend, siteurl: 'https://other.example/' }], {
    now, fetchPage: async url => { if (url === friend.siteurl) throw new Error('timeout'); return page(); },
  });
  assert.equal(report.results[0].status, 'error');
  assert.equal(report.results[0].httpStatus, null);
  assert.equal(report.results[1].status, 'ok');
});

test('backlinks are checked only for a supplied linkpage and do not change homepage status', async () => {
  assert.equal(typeof health.checkFriends, 'function');
  const fetched = [];
  const report = await health.checkFriends([friend, { ...friend, siteurl: 'https://other.example/', linkpage: 'https://other.example/friends/' }], {
    now, ownUrl: 'https://blog.example/', fetchPage: async url => { fetched.push(url); return page(200, '<a href="https://blog.example/">Blog</a>'); },
  });
  assert.deepEqual(fetched, [friend.siteurl, 'https://other.example/', 'https://other.example/friends/']);
  assert.equal(report.results[0].backlink, 'unchecked');
  assert.equal(report.results[1].backlink, 'found');
  assert.equal(report.results[1].status, 'ok');
});

test('failed screenshot refresh retains the previous successful screenshot', async () => {
  assert.equal(typeof health.checkFriends, 'function');
  const previous = { results: [{ url: friend.siteurl, screenshotUrl: screenshot, screenshotAt: '2026-09-01T00:00:00.000Z' }] };
  const report = await health.checkFriends([friend], {
    now, previous, fetchPage: async () => page(), capture: async () => { throw new Error('upload unavailable'); },
  });
  assert.equal(report.results[0].status, 'ok');
  assert.equal(report.results[0].screenshotUrl, screenshot);
  assert.equal(report.results[0].screenshotAt, previous.results[0].screenshotAt);
});

test('screenshots refresh only when absent or seven days old and reject poisoned prior metadata', async () => {
  assert.equal(typeof health.checkFriends, 'function');
  let captured = 0;
  const capture = async () => { captured++; return 'https://image.example/file/new.webp'; };
  const recent = { results: [{ url: friend.siteurl, screenshotUrl: screenshot, screenshotAt: '2026-10-04T02:00:00.000Z' }] };
  await health.checkFriends([friend], { now, previous: recent, fetchPage: async () => page(), capture });
  assert.equal(captured, 0);
  const older = { results: [{ ...recent.results[0], screenshotAt: '2026-09-28T02:00:00.000Z' }] };
  const report = await health.checkFriends([friend], { now, previous: older, fetchPage: async () => page(), capture });
  assert.equal(captured, 1);
  assert.equal(report.results[0].screenshotAt, now.toISOString());
  const poisoned = { results: [{ ...recent.results[0], screenshotUrl: 'http://127.0.0.1/admin' }] };
  const clean = await health.checkFriends([friend], { now, previous: poisoned, fetchPage: async () => page() });
  assert.equal(clean.results[0].screenshotUrl, null);
});

test('health requests allow public cross-origin redirects but preserve applicant same-origin policy', async () => {
  assert.equal(typeof policy.fetchPublicResource, 'function', 'DNS-pinned resource downloader is available');
  const calls = [];
  const resolve = async hostname => { calls.push(hostname); return [{ address: '1.1.1.1', family: 4 }]; };
  const request = async (url, options) => {
    assert.equal(options.address.address, '1.1.1.1');
    return url.hostname === 'example.com' ? { status: 301, headers: { location: 'https://www.example.com/' }, body: Buffer.alloc(0) } : { status: 200, headers: {}, body: Buffer.from('public') };
  };
  const result = await policy.fetchPublicResource(friend.siteurl, { resolve, request, allowCrossOrigin: true });
  assert.equal(result.actualUrl, 'https://www.example.com/');
  assert.deepEqual(calls, ['example.com', 'www.example.com']);
  await assert.rejects(policy.fetchPublicResource(friend.siteurl, { resolve, request, origin: friend.siteurl.slice(0, -1) }), /跨站/);
});

test('resource downloader blocks private DNS and private redirect targets before requesting them', async () => {
  assert.equal(typeof policy.fetchPublicResource, 'function');
  let called = 0;
  await assert.rejects(policy.fetchPublicResource(friend.siteurl, {
    resolve: async () => [{ address: '127.0.0.1', family: 4 }], request: async () => { called++; },
  }), /内网|保留/);
  assert.equal(called, 0);
  await assert.rejects(policy.fetchPublicResource(friend.siteurl, {
    allowCrossOrigin: true, resolve: async () => [{ address: '1.1.1.1', family: 4 }],
    request: async () => { called++; return { status: 302, headers: { location: 'http://169.254.169.254/' }, body: Buffer.alloc(0) }; },
  }), /内网|保留/);
  assert.equal(called, 1);
});

test('screenshot uploads use multipart Bearer auth and the screenshot folder', async () => {
  assert.equal(typeof shots.uploadScreenshot, 'function');
  const url = await shots.uploadScreenshot(Buffer.from('webp'), {
    baseUrl: 'https://image.example/', token: 'test-only', filename: 'friend.webp',
    fetchImpl: async (input, init) => {
      assert.equal(String(input), 'https://image.example/upload?returnFormat=full&uploadFolder=blog%2Ffriends%2Fscreenshots');
      assert.equal(init.headers.Authorization, 'Bearer test-only');
      assert.equal(init.method, 'POST');
      assert.equal(init.redirect, 'error');
      assert.equal(init.body.get('file').name, 'friend.webp');
      return new Response(JSON.stringify([{ src: '/file/friend.webp' }]), { status: 200 });
    },
  });
  assert.equal(url, 'https://image.example/file/friend.webp');
});

test('resource downloader bounds DNS waiting and redirect count', { timeout: 150 }, async () => {
  assert.equal(typeof policy.fetchPublicResource, 'function');
  await assert.rejects(policy.fetchPublicResource(friend.siteurl, { timeoutMs: 20, resolve: () => new Promise(() => {}) }), /超时/);
  let requests = 0;
  await assert.rejects(policy.fetchPublicResource(friend.siteurl, {
    maxRedirects: 1, resolve: async () => [{ address: '1.1.1.1', family: 4 }],
    request: async () => { requests++; return { status: 302, headers: { location: '/next' }, body: Buffer.alloc(0) }; },
  }), /跳转/);
  assert.equal(requests, 2);
});

test('screenshot capture isolates scripts and service workers, blocks WebSockets, and always closes its context', async () => {
  assert.equal(typeof shots.captureHomepage, 'function');
  let closed = 0, sockets = 0;
  const context = {
    route: async () => {}, routeWebSocket: async () => { sockets++; },
    newPage: async () => ({ setDefaultTimeout: () => {}, goto: async () => { throw new Error('timeout'); } }),
    close: async () => { closed++; },
  };
  const browser = { newContext: async options => { assert.equal(options.javaScriptEnabled, false); assert.equal(options.serviceWorkers, 'block'); return context; } };
  await assert.rejects(shots.captureHomepage(friend.siteurl, { browser }), /timeout/);
  assert.equal(closed, 1);
  assert.equal(sockets, 1);
});

test('screenshot interception blocks unsafe subresources and fulfills safe responses through the pinned downloader', async () => {
  assert.equal(typeof shots.createResourceHandler, 'function');
  const fulfilled = [];
  const aborted = [];
  const route = url => ({ request: () => ({ url: () => url, method: () => 'GET' }), fulfill: async result => fulfilled.push(result), abort: async () => aborted.push(url) });
  const handler = shots.createResourceHandler({ fetchResource: async url => { policy.publicUrl(url); return { status: 200, headers: { 'content-type': 'image/png', 'set-cookie': 'secret=x' }, body: Buffer.from('image') }; } });
  await handler(route('https://cdn.example/photo.png'));
  await handler(route('http://127.0.0.1/secret'));
  assert.equal(fulfilled.length, 1);
  assert.equal(fulfilled[0].headers['set-cookie'], undefined);
  assert.equal(aborted.length, 1);
});

test('report publisher creates and updates only the report file on master through the Contents API', async () => {
  assert.equal(typeof store.publishFriendReport, 'function');
  assert.equal(store.reportBranch, 'master');
  let exists = false;
  let sha = 'first-report-sha';
  const writes = [];
  const report = { schemaVersion: 1, checkedAt: now.toISOString(), results: [] };
  const api = async (route, { method = 'GET', body } = {}) => {
    writes.push({ route, method, body });
    if (method === 'GET' && route === '/repos/owner/repo/contents/reports/friend-links.json?ref=master') {
      if (!exists) { const error = new Error('not found'); error.status = 404; throw error; }
      return { sha, content: Buffer.from(JSON.stringify({ checkedAt: '2026-10-04T00:00:00.000Z', results: [] })).toString('base64') };
    }
    if (method === 'PUT' && route === '/repos/owner/repo/contents/reports/friend-links.json') {
      if (exists) assert.equal(body.sha, sha);
      else assert.equal(Object.hasOwn(body, 'sha'), false);
      assert.equal(body.branch, 'master');
      assert.match(body.message, /\[skip ci\]/);
      assert.deepEqual(JSON.parse(Buffer.from(body.content, 'base64').toString('utf8')), report);
      exists = true; sha = 'updated'; return {};
    }
    throw new Error(`Unexpected ${route}`);
  };
  await store.publishFriendReport(report, { repository: 'owner/repo', api });
  assert.deepEqual(writes.map(item => item.method), ['GET', 'PUT']);
  writes.length = 0;
  await store.publishFriendReport(report, { repository: 'owner/repo', api });
  assert.equal(writes.filter(item => item.method === 'PUT').length, 1);
  assert.ok(writes.every(item => !item.route.includes('/git/') && !item.route.includes('/vercel.json')));
});

test('report writes retry a SHA conflict without force-pushing or overwriting a newer report', async () => {
  assert.equal(typeof store.publishFriendReport, 'function');
  let gets = 0, puts = 0;
  const report = { schemaVersion: 1, checkedAt: now.toISOString(), results: [] };
  const api = async (route, { method = 'GET', body } = {}) => {
    assert.ok(route.startsWith('/repos/owner/repo/contents/reports/friend-links.json'));
    if (method === 'GET') { gets++; return { sha: `sha${gets}`, content: Buffer.from(JSON.stringify({ checkedAt: '2026-10-04T00:00:00.000Z' })).toString('base64') }; }
    puts++; assert.equal(body.sha, `sha${gets}`); assert.equal(body.branch, 'master');
    if (puts === 1) { const e = new Error('conflict'); e.status = 409; throw e; } return {};
  };
  await store.publishFriendReport(report, { repository: 'owner/repo', api });
  assert.equal(puts, 2);
  const newerApi = async (_route, { method = 'GET' } = {}) => {
    assert.equal(method, 'GET', 'newer report must never be written over');
    return { sha: 'newer', content: Buffer.from(JSON.stringify({ checkedAt: '2026-10-06T00:00:00.000Z' })).toString('base64') };
  };
  await assert.rejects(store.publishFriendReport(report, { repository: 'owner/repo', api: newerApi }), /较新|newer/);
});

test('report publisher limits SHA conflict retries to three attempts', async () => {
  let gets = 0, puts = 0;
  const api = async (route, { method = 'GET', body } = {}) => {
    assert.ok(route.startsWith('/repos/owner/repo/contents/reports/friend-links.json'));
    if (method === 'GET') { gets++; return { sha: `sha${gets}`, content: Buffer.from(JSON.stringify({ checkedAt: '2026-10-04T00:00:00.000Z' })).toString('base64') }; }
    puts++;
    assert.equal(body.sha, `sha${gets}`);
    const error = new Error('SHA conflict'); error.status = 409; throw error;
  };
  await assert.rejects(store.publishFriendReport({ checkedAt: now.toISOString(), results: [] }, { repository: 'owner/repo', api }), /SHA conflict/);
  assert.equal(gets, 3);
  assert.equal(puts, 3);
});

test('report retry checks the fresh report time before attempting another write', async () => {
  let gets = 0, puts = 0;
  const api = async (_route, { method = 'GET' } = {}) => {
    if (method === 'GET') {
      gets++;
      return { sha: `sha${gets}`, content: Buffer.from(JSON.stringify({ checkedAt: gets === 1 ? '2026-10-04T00:00:00.000Z' : '2026-10-06T00:00:00.000Z' })).toString('base64') };
    }
    puts++;
    const error = new Error('SHA conflict'); error.status = 409; throw error;
  };
  await assert.rejects(store.publishFriendReport({ checkedAt: now.toISOString(), results: [] }, { repository: 'owner/repo', api }), /较新|newer/);
  assert.equal(gets, 2);
  assert.equal(puts, 1);
});

test('previous reports are read from master and a missing first report has an empty fallback', async () => {
  const report = { schemaVersion: 1, checkedAt: now.toISOString(), results: [] };
  const actual = await store.loadPreviousReport({ repository: 'owner/repo', api: async route => {
    assert.equal(route, '/repos/owner/repo/contents/reports/friend-links.json?ref=master');
    return { content: Buffer.from(JSON.stringify(report)).toString('base64') };
  } });
  assert.deepEqual(actual, report);
  const empty = await store.loadPreviousReport({ repository: 'owner/repo', api: async route => {
    assert.equal(route, '/repos/owner/repo/contents/reports/friend-links.json?ref=master');
    const error = new Error('not found'); error.status = 404; throw error;
  } });
  assert.deepEqual(empty, { schemaVersion: 1, checkedAt: null, results: [] });
});

test('friend request imports preserve the supplied backlink page', async () => {
  const helpers = require('../.github/scripts/process-friend-request.cjs').helpers;
  const os = await import('node:os'); const path = await import('node:path');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'friend-page-test-'));
  try {
    await fs.mkdir(path.join(root, 'src/data'), { recursive: true });
    await fs.writeFile(path.join(root, 'src/data/friends.json'), '[]');
    const result = helpers.updateFriendsConfig(root, { site_name: 'Example', site_url: friend.siteurl, friend_page_url: 'https://example.com/friends/' });
    assert.equal(result.friend.linkpage, 'https://example.com/friends/');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
