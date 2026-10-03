import assert from 'node:assert/strict';
import test from 'node:test';

test('outline tree follows heading levels including skipped levels', async () => {
  const { buildOutlineTree } = await import('../src/utils/article-outline-tree.ts').catch(() => ({}));
  assert.equal(typeof buildOutlineTree, 'function');
  const nodes = buildOutlineTree([{ index: 0, level: 1 }, { index: 1, level: 3 }, { index: 2, level: 2 }, { index: 3, level: 1 }]);
  assert.deepEqual(nodes.map(node => [node.index, node.parent, node.children]), [[0, null, [1, 2]], [1, 0, []], [2, 0, []], [3, null, []]]);
});

test('term links preserve Unicode and distinguish spaces, hyphens, and case', async () => {
  const { termToSlug } = await import('../src/utils/term-slug.ts').catch(() => ({}));
  assert.equal(typeof termToSlug, 'function');
  for (const term of ['中文标签', 'a b', 'a-b', 'JavaScript', 'javascript']) assert.equal(decodeURIComponent(termToSlug(term)), term.trim());
  assert.notEqual(termToSlug('a b'), termToSlug('a-b'));
  assert.notEqual(termToSlug('JavaScript'), termToSlug('javascript'));
});

test('static taxonomy params stay decoded and reserved names cannot become path segments', async () => {
  const { termToRouteParam, termToSlug } = await import('../src/utils/term-slug.ts');
  assert.equal(typeof termToRouteParam, 'function');
  assert.equal(termToRouteParam(' 中文标签 '), '中文标签');
  const terms = ['a/b', 'a\\b', '.', '..', 'a%2Fb', 'a?b', 'a#b', '~612f62', 'a/b'];
  const params = terms.map(termToRouteParam);
  for (const param of params) assert.match(param, /^~[0-9a-f]+$/);
  assert.equal(new Set(params).size, new Set(terms).size);
  assert.equal(termToSlug('a/b'), encodeURIComponent(termToRouteParam('a/b')));
});

test('disabled taxonomy pages keep article terms linked to the existing archive filters', async () => {
  const { taxonomyPath } = await import('../src/utils/term-slug.ts');
  assert.equal(typeof taxonomyPath, 'function');
  assert.equal(taxonomyPath('tags', ' 中文 ', false), '/archive/?tag=%E4%B8%AD%E6%96%87');
  assert.equal(taxonomyPath('categories', 'a/b', false), '/archive/?category=a%2Fb');
  assert.equal(taxonomyPath('tags', '中文', true), '/tags/%E4%B8%AD%E6%96%87/');
});

test('local icon rendering supports dynamic configured icons without loading archives or remote URLs', async () => {
  const { renderLocalIcon } = await import('../src/utils/local-icon.mjs').catch(() => ({}));
  assert.equal(typeof renderLocalIcon, 'function');
  for (const name of ['material-symbols:home-rounded', 'fa7-brands:github', 'mdi:account', 'svg-spinners:3-dots-bounce']) {
    const icon = renderLocalIcon(name);
    assert.match(icon.attributes.viewBox, /^0 0 \d+ \d+$/);
    assert.ok(icon.body.includes('<'));
  }
  assert.throws(() => renderLocalIcon('https://example.test/icon.svg'), /图标/);
  assert.throws(() => renderLocalIcon('unknown:missing'), /图标/);
});

test('build render cache shares work and retries failures while development stays fresh', async () => {
  const { createRenderCache } = await import('../src/utils/render-cache.ts').catch(() => ({}));
  assert.equal(typeof createRenderCache, 'function');
  let calls = 0;
  const render = async entry => { calls++; return { body: entry.body }; };
  const cached = createRenderCache(render, true);
  await Promise.all([cached({ id: 'one', body: 'A' }), cached({ id: 'one', body: 'A' })]);
  assert.equal(calls, 1);
  const fresh = createRenderCache(render, false);
  assert.equal((await fresh({ id: 'one', body: 'B' })).body, 'B');
  assert.equal((await fresh({ id: 'one', body: 'C' })).body, 'C');
  let attempts = 0;
  const retry = createRenderCache(async () => { if (++attempts === 1) throw new Error('retry'); return true; }, true);
  await assert.rejects(retry({ id: 'one' }), /retry/);
  assert.equal(await retry({ id: 'one' }), true);
});

test('content form updates preserve unknown metadata and body, and reject executable frontmatter', async () => {
  const { updateRecordFields, parseRecordSource, updateListField } = await import('../src/utils/content-editor.ts').catch(() => ({}));
  assert.equal(typeof updateRecordFields, 'function');
  const source = '---\ntitle: Old\ncustom:\n  retained: true\ndraft: true\n---\n# Body\n';
  const updated = parseRecordSource(updateRecordFields(source, { title: 'New: title', draft: false, tags: ['中文'] }));
  assert.equal(updated.data.title, 'New: title'); assert.equal(updated.data.custom.retained, true); assert.equal(updated.data.draft, false);
  assert.equal(updated.body, '# Body\n');
  assert.throws(() => parseRecordSource('---js\n({title:"no"})\n---\nbody'), /YAML|JSON/);
  const rows = updateListField('[{"name":"Old","enabled":true,"weight":5,"custom":{"retained":true}}]', 0, 'enabled', false);
  assert.deepEqual(JSON.parse(rows), [{ name: 'Old', enabled: false, weight: 5, custom: { retained: true } }]);
});
