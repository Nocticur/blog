import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGithubStore, createLocalStore, executeContent, uploadContentImage } from '../api/_lib/content-management.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('configuration commits return the GitHub revision and review URL', async () => {
  const store = createGithubStore({ repo: 'isolated/test', branch: 'main', request: async (_url, init) => {
    if (!init) return Response.json({ type: 'file', size: 2, sha: 'old-version', content: Buffer.from('[]').toString('base64') });
    assert.equal(JSON.parse(init.body).sha, 'old-version');
    return Response.json({ content: { sha: 'new-version' }, commit: { sha: 'commit', html_url: 'https://github.com/isolated/test/commit/commit' } });
  } });
  const result = await executeContent(store, 'feeds', 'PUT', { source: '[]', version: 'old-version' });
  assert.equal(result.version, 'new-version');
  assert.deepEqual(result.commit, { sha: 'commit', url: 'https://github.com/isolated/test/commit/commit' });
});
test('all content modules share the 3 MiB image ceiling', async () => {
  const store = { write() { assert.fail('Invalid uploads must not be saved'); } };
  const dataUrl = `data:image/png;base64,${Buffer.alloc(3 * 1024 * 1024 + 1).toString('base64')}`;
  await assert.rejects(() => uploadContentImage(store, 'notebooks', { dataUrl }), /3 MiB/);
});
test('Windows case variants of a file share the same write lock', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'writing-case-test-'));
  try {
    const store = createLocalStore(root);
    const version = await store.write('notes/Note.md', Buffer.from('original'), null);
    const writes = await Promise.allSettled([
      store.write('notes/Note.md', Buffer.from('first update'), version),
      store.write('notes/note.md', Buffer.from('second update'), version),
    ]);
    assert.equal(writes.filter(result => result.status === 'fulfilled').length, 1);
    const rejected = writes.find(result => result.status === 'rejected');
    assert.equal(rejected?.reason.status, 409);
  } finally { await rm(root, { recursive: true, force: true }); }
});
