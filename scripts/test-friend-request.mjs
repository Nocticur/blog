import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const policy = require('../.github/scripts/process-friend-request.cjs').helpers || {};

test('friend validation requires HTTP(S), the applicant origin, and an actual backlink', () => {
  assert.equal(typeof policy.validateApplication, 'function');
  const application = { site_url: 'https://applicant.example/', friend_page_url: 'https://applicant.example/friends/' };
  assert.doesNotThrow(() => policy.validateApplication(application));
  for (const friend_page_url of ['https://other.example/friends/', 'file:///etc/passwd', 'http://127.0.0.1/']) assert.throws(() => policy.validateApplication({ ...application, friend_page_url }));
  assert.equal(policy.hasBacklink('<p>nocticur.example</p><!-- <a href="https://nocticur.example/">fake</a> -->', 'https://nocticur.example/'), false);
  assert.equal(policy.hasBacklink('<a href="https://nocticur.example.attacker.test/">fake</a>', 'https://nocticur.example/'), false);
  assert.equal(policy.hasBacklink('<a href="https://nocticur.example/">blog</a>', 'https://nocticur.example/'), true);
});

test('friend network checks reject private, mapped, and reserved addresses', () => {
  assert.equal(typeof policy.isPublicAddress, 'function');
  for (const address of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '0.0.0.0', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1']) assert.equal(policy.isPublicAddress(address), false, address);
  for (const address of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) assert.equal(policy.isPublicAddress(address), true, address);
});

test('public friend requests cannot replace an existing site', async () => {
  assert.equal(typeof policy.updateFriendsConfig, 'function');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'blog-friend-test-'));
  try {
    const file = path.join(root, 'src/data/friends.json');
    await fs.mkdir(path.dirname(file), { recursive: true });
    const original = JSON.stringify([{ title: 'Original', siteurl: 'https://applicant.example/', enabled: true }]);
    await fs.writeFile(file, original);
    assert.throws(() => policy.updateFriendsConfig(root, { site_name: 'Replacement', site_url: 'https://applicant.example/' }), /已存在|人工/);
    assert.equal(await fs.readFile(file, 'utf8'), original);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
