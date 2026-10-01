import test from 'node:test';
import assert from 'node:assert/strict';
import { executeContent } from '../api/_lib/content-management.mjs';

const announcement = (extra = {}) => ({ tag: '欢迎', title: '原始标题', content: '原始正文', time: '2026-10-01', sort: 1, ...extra });
const config = (items = [announcement()], extra = {}) => ({ title: '公告', closable: false, items, ...extra });
const rules = await import('../src/utils/announcement-data.mjs').catch(() => ({}));
function memoryStore(value = config()) {
  let source = JSON.stringify(value);
  let version = 'initial';
  return {
    async read() { return { source, version }; },
    async write(_file, bytes, expected) {
      assert.equal(expected, version);
      source = bytes.toString('utf8'); version += '-next';
      return version;
    },
  };
}

test('repository rejects blank announcement titles and bodies', async () => {
  for (const item of [announcement({ title: ' ' }), announcement({ content: '\n ' })]) {
    await assert.rejects(executeContent(memoryStore(), 'announcements', 'PUT', { source: JSON.stringify(config([item])), version: 'initial' }), error => error.status === 400 && /标题|正文/.test(error.message));
  }
});

test('repository rejects invalid dates, enabled values and external-looking local links', async () => {
  for (const extra of [{ time: '2026-02-30' }, { time: '2026-2-03' }, { enabled: 'false' }, { link: '//evil.example/path' }, { link: '/\\evil.example/path' }, { link: 'javascript:alert(1)' }]) {
    await assert.rejects(executeContent(memoryStore(), 'announcements', 'PUT', { source: JSON.stringify(config([announcement(extra)])), version: 'initial' }), error => error.status === 400);
  }
});

test('repository omits blank links while preserving unknown fields and empty lists', async () => {
  const store = memoryStore();
  const saved = await executeContent(store, 'announcements', 'PUT', { source: JSON.stringify(config([announcement({ link: '   ', enabled: false, custom: { keep: true } })], { icon: 'original-icon' })), version: 'initial' });
  const data = JSON.parse((await store.read()).source);
  assert.equal('link' in data.items[0], false);
  assert.equal(data.icon, 'original-icon');
  assert.deepEqual(data.items[0].custom, { keep: true });
  assert.equal(data.items[0].enabled, false);
  await executeContent(store, 'announcements', 'PUT', { source: JSON.stringify(config([])), version: saved.version });
  assert.deepEqual(JSON.parse((await store.read()).source).items, []);
  await assert.rejects(executeContent(store, 'announcements', 'PUT', { source: JSON.stringify(config()), version: 'initial' }), error => error.status === 409);
});

test('normalization creates independent values and preserves custom metadata', () => {
  assert.equal(typeof rules.normalizeAnnouncements, 'function');
  const original = config([announcement({ link: ' \t', custom: { keep: true } })], { custom: { note: 'keep' } });
  const normalized = rules.normalizeAnnouncements(original);
  assert.equal('link' in normalized.items[0], false);
  assert.equal(original.items[0].link, ' \t');
  normalized.items[0].custom.keep = false;
  normalized.custom.note = 'changed';
  assert.equal(original.items[0].custom.keep, true);
  assert.equal(original.custom.note, 'keep');
});

test('visible items default to enabled and share stable descending sort', () => {
  assert.equal(typeof rules.visibleAnnouncements, 'function');
  const first = announcement({ title: 'first tie', sort: 4 });
  const second = announcement({ title: 'second tie', sort: 4, enabled: true });
  const hidden = announcement({ title: 'hidden', sort: 100, enabled: false });
  const low = announcement({ title: 'low', sort: 1 });
  const original = [low, first, hidden, second];
  assert.deepEqual(rules.visibleAnnouncements(config(original)).map(item => item.title), ['first tie', 'second tie', 'low']);
  assert.deepEqual(rules.sortAnnouncementItems(original).map(item => item.title), ['hidden', 'first tie', 'second tie', 'low']);
  assert.equal(original[0], low);
  assert.deepEqual(rules.visibleAnnouncements(config([])), []);
});

test('shared title defaults and dates use Shanghai time', () => {
  assert.equal(typeof rules.announcementTitle, 'function');
  assert.equal(rules.announcementTitle({ title: ' \n' }), '公告');
  assert.equal(rules.announcementTitle({ title: '  站点公告  ' }), '站点公告');
  assert.equal(rules.announcementDate(new Date('2026-09-30T16:30:00Z')), '2026-10-01');
});

test('shared validation accepts optional enabled and legitimate links', () => {
  assert.equal(typeof rules.validateAnnouncements, 'function');
  for (const item of [announcement(), announcement({ enabled: false, tag: '', link: '/about/?a=1#top' }), announcement({ link: 'https://example.test/path' }), announcement({ time: '2024-02-29' })]) {
    assert.equal(rules.validateAnnouncements(config([item])), null);
  }
  assert.equal(rules.validateAnnouncements(config([])), null);
  assert.match(rules.validateAnnouncements(config([announcement({ time: '2023-02-29' })])), /日期/);
});
