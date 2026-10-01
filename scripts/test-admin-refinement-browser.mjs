import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const origin = process.env.BROWSER_BASE_URL || process.env.FEATURE_TEST_ORIGIN || 'http://127.0.0.1:4321';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const fixtureAnnouncements = () => ({ title: '隔离公告', closable: false, extraSettings: { preserve: true }, items: [
  { tag: '欢迎', title: '公告 A', content: '正文 A', time: '2026-10-01', sort: 3, extraItem: { keep: 'A' } },
  { tag: '通知', title: '公告 B', content: '正文 B', time: '2026-10-01', sort: 2, link: '/about/' },
  { tag: '友链', title: '公告 C', content: '正文 C', time: '2026-10-01', sort: 1 },
] });
const fixtureSidebar = () => ({ enable: true, position: 'both', leftComponents: [{ type: 'profile', enable: true, position: 'top' }], rightComponents: [{ type: 'calendar', enable: true, position: 'top' }], mobileBottomComponents: [] });
const section = page => page.locator('#admin-announcements');
const items = page => section(page).locator('.admin-announcement-item');
const save = page => section(page).getByRole('button', { name: '保存公告', exact: true });
const cancel = page => section(page).getByRole('button', { name: '取消修改', exact: true });
const titles = page => items(page).evaluateAll(nodes => nodes.map(node => [...node.querySelectorAll('label')].find(label => label.textContent.trim() === '标题')?.querySelector('input')?.value));
const saved = page => page.locator('.admin-toast').filter({ hasText: /已保存/ }).waitFor();

async function fixture(options = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  const errors = [];
  const state = { preview: false, authenticated: true, announcements: fixtureAnnouncements(), announcementVersion: 'a1', sidebar: fixtureSidebar(), sidebarVersion: 's1', writes: [], requests: [], reject: null, hold: null, failReads: false, loginCalls: 0, lostReply: null, ...options };
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.route('**/api/writing/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    state.requests.push({ method: request.method(), path });
    // Every management request is intercepted; no write can reach real data.
    if (path.endsWith('/auth/')) { assert.equal(request.method(), 'POST'); state.loginCalls++; state.authenticated = true; return route.fulfill({ json: { ok: true, authenticated: true } }); }
    if (path.endsWith('/session/')) return route.fulfill(state.authenticated ? { json: { authenticated: true, preview: state.preview, mode: 'deployed' } } : { status: 401, json: { error: '登录已过期' } });
    if (path.endsWith('/logout/')) { state.authenticated = false; return route.fulfill({ json: { ok: true } }); }
    if (state.hold?.matches(request)) await state.hold.wait();
    if (request.method() === 'GET') {
      if (state.failReads) return route.fulfill({ status: 503, json: { error: '隔离读取失败' } });
      if (path.includes('/content/announcements/')) return route.fulfill({ json: { source: JSON.stringify(state.announcements), version: state.announcementVersion } });
      if (path.includes('/content/sidebar/')) return route.fulfill({ json: { source: JSON.stringify(state.sidebar), version: state.sidebarVersion } });
      if (path.includes('/posts/')) return route.fulfill({ json: { posts: [], mode: 'deployed', tokenReady: true } });
      if (/\/content\/(friends|navigation|gallery|sponsors|feeds)\//.test(path)) return route.fulfill({ json: { source: '[]', version: 'list-v1', items: [] } });
      return route.fulfill({ json: { items: [], mode: 'deployed' } });
    }
    const body = request.postDataJSON();
    state.writes.push({ path, method: request.method(), body });
    if (state.lostReply && path.includes('/content/' + state.lostReply.module + '/')) {
      const { module, committed } = state.lostReply;
      state.lostReply = null;
      if (committed) state[module] = JSON.parse(body.source);
      else if (module === 'announcements') state.announcements.title = '另一人的仓库更新';
      else state.sidebar.position = 'right';
      state[module === 'announcements' ? 'announcementVersion' : 'sidebarVersion'] = 'verified-v2';
      // Simulate a completed (or different) repository state with a lost HTTP reply.
      return route.abort('failed');
    }
    if (state.reject) return route.fulfill({ status: state.reject, json: { error: state.reject === 409 ? '版本冲突' : state.reject === 401 ? '登录已过期' : '隔离保存失败' } });
    if (path.includes('/content/announcements/')) { state.announcements = JSON.parse(body.source); state.announcementVersion = 'saved-a' + state.writes.length; return route.fulfill({ json: { ok: true, version: state.announcementVersion } }); }
    if (path.includes('/content/sidebar/')) { state.sidebar = JSON.parse(body.source); state.sidebarVersion = 'saved-s' + state.writes.length; return route.fulfill({ json: { ok: true, version: state.sidebarVersion } }); }
    if (path.includes('/posts/')) return route.fulfill({ json: { ok: true, file: 'isolated.md', version: 'saved-post', commit: { url: 'https://example.test/commit/fixture' } } });
    return route.fulfill({ status: 403, json: { error: '隔离测试拒绝未定义写入' } });
  });
  const open = async () => { await page.goto(origin + '/admin/#announcements', { waitUntil: 'domcontentloaded' }); await page.getByLabel('公告栏标题', { exact: true }).waitFor(); };
  const select = async label => page.locator('.admin-sidebar nav button').filter({ hasText: label }).click();
  const cleanup = async () => { await context.close(); assert.deepEqual(errors, [], '浏览器不得出现未处理脚本异常'); };
  return { page, state, context, errors, open, select, cleanup };
}

function gate(state, matches) {
  let release, arrived, timer;
  const reached = Promise.race([
    new Promise(resolve => arrived = resolve),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('等待隔离请求超时')), 12000); }),
  ]).finally(() => clearTimeout(timer));
  const pending = new Promise(resolve => release = resolve);
  state.hold = { matches, async wait() { arrived(); await pending; } };
  return { reached, release() { state.hold = null; release(); } };
}

const cases = [
  ['announcement-create', async () => {
    const f = await fixture({ preview: true });
    try {
      await f.open();
      assert.equal(await section(f.page).getByRole('button', { name: '新增公告', exact: true }).count(), 1, '公告编辑器必须提供新增公告入口');
      await section(f.page).getByRole('button', { name: '新增公告', exact: true }).click();
      assert.equal(await items(f.page).count(), 4, '新增公告保留全部既有条目');
      const newest = items(f.page).first();
      assert.equal(await newest.getByLabel('标题', { exact: true }).inputValue(), '');
      assert.equal(await newest.getByLabel('日期', { exact: true }).inputValue(), new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()));
      assert.equal(await newest.getByRole('checkbox', { name: /启用/ }).isChecked(), true);
      await newest.getByLabel('标题', { exact: true }).fill('本机新增公告');
      await newest.getByLabel('正文', { exact: true }).fill('尚未提交正文');
      assert.deepEqual(f.state.writes, [], '新增只暂存，不自动提交');
      f.state.reject = 403; await save(f.page).click();
      await f.page.getByText('隔离保存失败', { exact: true }).waitFor();
      assert.equal(await newest.getByLabel('正文', { exact: true }).inputValue(), '尚未提交正文', '403保留本机公告');
    } finally { await f.cleanup(); }
  }],
  ['announcement-edit-delete', async () => {
    const f = await fixture();
    try {
      await f.open();
      const first = items(f.page).first();
      await first.getByLabel('链接', { exact: true }).fill('/temporary/');
      await first.getByLabel('链接', { exact: true }).fill('');
      await first.getByLabel('正文', { exact: true }).fill('<img src=x onerror="window.__announcementUnsafe=true">纯文本正文');
      await items(f.page).nth(1).getByRole('button', { name: '删除', exact: true }).click();
      assert.deepEqual(await titles(f.page), ['公告 A', '公告 C'], '删除中间项不串联字段');
      assert.equal(await items(f.page).nth(1).getByLabel('正文', { exact: true }).inputValue(), '正文 C');
      await items(f.page).nth(1).getByRole('button', { name: '上移', exact: true }).click();
      assert.deepEqual(await titles(f.page), ['公告 C', '公告 A']);
      await items(f.page).first().getByRole('checkbox', { name: /启用/ }).uncheck();
      const preview = f.page.locator('.admin-announcement-preview'); await preview.waitFor();
      assert.equal(await preview.getByText('公告 C', { exact: true }).count(), 0, '停用公告不进入预览');
      assert.equal(await preview.locator('img, [onerror]').count(), 0, '公告正文按纯文本预览');
      await save(f.page).click(); await saved(f.page);
      const submitted = JSON.parse(f.state.writes.at(-1).body.source);
      assert.deepEqual(submitted.extraSettings, { preserve: true }, '保存保留配置额外字段');
      const itemA = submitted.items.find(item => item.title === '公告 A');
      assert.deepEqual(itemA.extraItem, { keep: 'A' }, '保存保留公告额外字段');
      assert.equal('link' in itemA, false, '空链接规范化为省略');
      assert.equal(submitted.items[0].enabled, false);
      assert.ok(submitted.items[0].sort > submitted.items[1].sort, '提交顺序与显示顺序一致');
      assert.equal(await save(f.page).isDisabled(), true, '空链接成功保存后应恢复干净状态');
      while (await items(f.page).count()) await items(f.page).first().getByRole('button', { name: '删除', exact: true }).click();
      await section(f.page).getByText(/暂无公告/).first().waitFor();
      await save(f.page).click(); await saved(f.page);
      assert.deepEqual(JSON.parse(f.state.writes.at(-1).body.source).items, [], '允许提交零条公告');
      assert.equal(await f.page.evaluate(() => !!window.__announcementUnsafe), false);
    } finally { await f.cleanup(); }
  }],
  ['buffer-cancel-version', async () => {
    const f = await fixture();
    try {
      await f.open(); await f.page.getByLabel('公告栏标题', { exact: true }).fill('旧版本本机修改');
      await f.page.waitForFunction(() => Object.values(localStorage).some(value => value.includes('旧版本本机修改')));
      f.state.announcements.title = '仓库第二版'; f.state.announcementVersion = 'a2';
      await f.page.reload({ waitUntil: 'domcontentloaded' });
      await f.page.waitForFunction(() => document.querySelector('#admin-announcements label input')?.value === '旧版本本机修改');
      await f.select('站点管理'); await f.page.locator('#admin-settings input[type=checkbox]').first().uncheck();
      await f.select('公告管理'); await cancel(f.page).click();
      assert.equal(await f.page.getByLabel('公告栏标题', { exact: true }).inputValue(), '仓库第二版', '取消恢复新读取基线');
      await f.select('站点管理');
      assert.equal(await f.page.locator('#admin-settings input[type=checkbox]').first().isChecked(), false, '公告取消不影响侧栏修改');
      await f.select('公告管理'); await f.page.getByLabel('公告栏标题', { exact: true }).fill('取消后修改');
      await save(f.page).click(); await saved(f.page);
      assert.equal(f.state.writes.at(-1).body.version, 'a2', '取消同时恢复基线版本');
    } finally { await f.cleanup(); }
  }],
  ['conflict-merge', async () => {
    const f = await fixture();
    try {
      await f.open(); await f.page.getByLabel('公告栏标题', { exact: true }).fill('本机冲突内容');
      f.state.reject = 409; f.state.announcements.title = '远程冲突版本'; f.state.announcementVersion = 'a3';
      await save(f.page).click(); await f.page.getByText(/版本冲突/).first().waitFor();
      assert.equal(f.state.writes.at(-1).body.version, 'a1');
      assert.equal(await f.page.getByLabel('公告栏标题', { exact: true }).inputValue(), '本机冲突内容');
      await f.page.getByRole('button', { name: /读取仓库.*比较/ }).click();
      await f.page.locator('#admin-comparison').getByRole('button', { name: /以仓库.*基础合并/ }).click();
      assert.equal(await f.page.getByLabel('公告栏标题', { exact: true }).inputValue(), '远程冲突版本');
      const previous = f.page.getByLabel('合并前的本机内容', { exact: true });
      assert.ok((await previous.inputValue()).includes('本机冲突内容'), '合并保留原本机对照');
      f.state.reject = null; await f.page.getByLabel('公告栏标题', { exact: true }).fill('手动合并后');
      await save(f.page).click(); await saved(f.page);
      assert.equal(f.state.writes.at(-1).body.version, 'a3');
    } finally { await f.cleanup(); }
  }],
  ['configuration-locks', async () => {
    const f = await fixture(); let pending;
    try {
      await f.open(); await f.page.getByLabel('公告栏标题', { exact: true }).fill('慢保存输入');
      pending = gate(f.state, request => request.method() === 'PUT' && request.url().includes('/announcements/'));
      await save(f.page).click(); await pending.reached;
      assert.equal(await f.page.getByLabel('公告栏标题', { exact: true }).isDisabled(), true);
      assert.equal(await cancel(f.page).isDisabled(), true);
      assert.equal(await section(f.page).getByRole('button', { name: '新增公告', exact: true }).isDisabled(), true);
      pending.release(); pending = null; await saved(f.page);
      await f.page.getByLabel('公告栏标题', { exact: true }).fill('读取失败保留'); await f.select('工作台');
      pending = gate(f.state, request => request.method() === 'GET' && request.url().includes('/announcements/'));
      await f.page.getByRole('button', { name: '重新读取数据', exact: true }).click(); await pending.reached;
      assert.equal(await f.page.locator('#admin-dashboard input[type=checkbox]').first().isDisabled(), true, '慢重读锁定快捷设置');
      await f.select('公告管理');
      assert.equal(await f.page.getByLabel('公告栏标题', { exact: true }).isDisabled(), true, '慢重读锁定公告配置');
      f.state.failReads = true; pending.release(); pending = null;
      await f.page.getByText('隔离读取失败', { exact: true }).waitFor();
      assert.equal(await f.page.getByLabel('公告栏标题', { exact: true }).inputValue(), '读取失败保留');
      assert.equal(await f.page.getByLabel('公告栏标题', { exact: true }).isDisabled(), false);
    } finally { pending?.release(); await f.cleanup(); }
  }],
  ['rapid-content-navigation', async () => {
    const f = await fixture(); let pending;
    try {
      await f.open(); await f.select('规划记录');
      const records = f.page.locator('#admin-records');
      await records.getByRole('button', { name: '新建草稿', exact: true }).click();
      await records.locator('textarea').first().fill('规划记录的本机草稿');
      await f.page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('Storage full', 'QuotaExceededError'); }; });
      pending = gate(f.state, request => request.method() === 'GET' && request.url().includes('/content/places/'));
      await f.select('足迹'); await pending.reached;
      assert.equal(await records.locator('textarea:visible:not(:disabled)').count(), 0, '切换请求未完成时不能继续编辑旧模块');
      await f.select('笔记本'); await f.select('规划记录');
      pending.release(); pending = null;
      await f.page.waitForFunction(() => document.querySelector('#admin-records textarea')?.value === '规划记录的本机草稿');
      assert.equal(new URL(f.page.url()).hash, '#routines');
      assert.equal(await records.locator('textarea').first().inputValue(), '规划记录的本机草稿', '迟到请求不能覆盖最后选择的工作区');
    } finally { pending?.release(); await f.cleanup(); }
  }],
  ['sidebar-buffer-cancel-version', async () => {
    const f = await fixture();
    try {
      await f.open(); await f.select('站点管理');
      await f.page.locator('#admin-settings input[type=checkbox]').first().uncheck();
      await f.page.waitForFunction(() => Object.values(localStorage).some(value => value.includes('"sidebar"')));
      f.state.sidebarVersion = 's2'; f.state.sidebar.leftComponents[0].enable = true;
      await f.page.reload({ waitUntil: 'domcontentloaded' });
      await f.page.locator('#admin-settings input[type=checkbox]').first().waitFor();
      assert.equal(await f.page.locator('#admin-settings input[type=checkbox]').first().isChecked(), false);
      await f.page.locator('#admin-settings').getByRole('button', { name: '取消修改', exact: true }).click();
      assert.equal(await f.page.locator('#admin-settings input[type=checkbox]').first().isChecked(), true);
      await f.page.locator('#admin-settings input[type=checkbox]').first().uncheck();
      await f.page.getByRole('button', { name: '保存设置', exact: true }).click(); await saved(f.page);
      assert.equal(f.state.writes.at(-1).body.version, 's2', '侧栏取消同样恢复基线版本');
    } finally { await f.cleanup(); }
  }],
  ['lost-reply-confirmed', async () => {
    for (const module of ['announcements', 'sidebar']) {
      const f = await fixture();
      try {
        await f.open();
        if (module === 'announcements') await f.page.getByLabel('公告栏标题', { exact: true }).fill('已写入但响应丢失');
        else { await f.select('站点管理'); await f.page.locator('#admin-settings input[type=checkbox]').first().uncheck(); }
        const button = module === 'announcements' ? save(f.page) : f.page.getByRole('button', { name: '保存设置', exact: true });
        const before = f.state.requests.length;
        f.state.lostReply = { module, committed: true };
        await button.click();
        await f.page.locator('.admin-toast').filter({ hasText: /已核验保存结果/ }).waitFor();
        assert.equal(f.state.writes.length, 1, '响应丢失不能自动重复PUT');
        assert.equal(f.state.requests.slice(before).filter(request => request.method === 'GET' && request.path.endsWith('/' + module + '/')).length, 1, '响应丢失后应读取一次核验');
        assert.equal(await button.isDisabled(), true, '核验相同内容后清除未保存状态');
        if (module === 'announcements') await f.page.getByLabel('公告栏标题', { exact: true }).fill('核验后的下一次修改');
        else await f.page.locator('#admin-settings input[type=checkbox]').first().check();
        await button.click(); await saved(f.page);
        assert.equal(f.state.writes.at(-1).body.version, 'verified-v2', '核验成功后使用核验返回的版本');
      } finally { await f.cleanup(); }
    }
  }],
  ['lost-reply-different', async () => {
    for (const module of ['announcements', 'sidebar']) {
      const f = await fixture();
      try {
        await f.open();
        if (module === 'announcements') await f.page.getByLabel('公告栏标题', { exact: true }).fill('待保留本机修改');
        else { await f.select('站点管理'); await f.page.locator('#admin-settings input[type=checkbox]').first().uncheck(); }
        const button = module === 'announcements' ? save(f.page) : f.page.getByRole('button', { name: '保存设置', exact: true });
        f.state.lostReply = { module, committed: false };
        await button.click();
        await f.page.locator('.admin-toast').filter({ hasText: /仓库内容.*不同/ }).waitFor();
        assert.equal(f.state.writes.length, 1, '仓库状态不同不能自动覆盖或重试');
        if (module === 'announcements') assert.equal(await f.page.getByLabel('公告栏标题', { exact: true }).inputValue(), '待保留本机修改');
        else assert.equal(await f.page.locator('#admin-settings input[type=checkbox]').first().isChecked(), false);
        assert.equal(await button.isDisabled(), false, '不同仓库版本仍保留未保存状态');
        await f.page.getByRole('button', { name: /读取仓库.*比较/ }).click();
        const repository = JSON.parse(await f.page.getByLabel('仓库版本', { exact: true }).inputValue());
        assert.equal(module === 'announcements' ? repository.title : repository.position, module === 'announcements' ? '另一人的仓库更新' : 'right');
        f.state.reject = 409;
        await button.click(); await f.page.locator('.admin-toast').filter({ hasText: /版本冲突/ }).waitFor();
        assert.equal(f.state.writes.at(-1).body.version, module === 'announcements' ? 'a1' : 's1', '核验不同内容不悄悄采用仓库版本');
      } finally { await f.cleanup(); }
    }
  }],
  ['session-keeps-workspaces', async () => {
    const f = await fixture();
    try {
      await f.open(); await f.page.getByLabel('公告栏标题', { exact: true }).fill('会话过期公告输入');
      await f.select('文章管理'); const writing = f.page.locator('#admin-writing');
      await writing.getByRole('button', { name: '新建文章', exact: true }).click();
      await writing.getByPlaceholder('文章标题').fill('会话过期文章输入'); await writing.locator('.ws-editor').fill('重新登录后保留正文');
      await f.select('公告管理'); f.state.reject = 401; await save(f.page).click();
      await f.page.locator('.admin-login').waitFor();
      assert.equal(await f.page.locator('#admin-writing .ws-editor').count(), 1, '会话过期不能卸载已有编辑器');
      f.state.reject = null; f.state.announcementVersion = 'a9'; f.state.announcements.title = '登录后的远程配置';
      await f.page.getByPlaceholder('输入管理密码').fill('isolated-fake-password');
      await f.page.getByRole('button', { name: '进入工作台', exact: true }).click();
      await f.page.locator('.admin-login').waitFor({ state: 'hidden' });
      assert.equal(new URL(f.page.url()).hash, '#announcements');
      assert.equal(await f.page.getByLabel('公告栏标题', { exact: true }).inputValue(), '会话过期公告输入');
      await save(f.page).click(); await saved(f.page);
      assert.equal(f.state.writes.at(-1).body.version, 'a1', '重新登录仍提交原读取版本');
      await f.select('文章管理');
      assert.equal(await writing.getByPlaceholder('文章标题').inputValue(), '会话过期文章输入');
      assert.equal(await writing.locator('.ws-editor').inputValue(), '重新登录后保留正文');
      assert.equal(f.state.loginCalls, 1);
    } finally { await f.cleanup(); }
  }],
];

const failures = [];
try {
  for (const [name, run] of cases) {
    if (process.env.ADMIN_REFINEMENT_CASE && process.env.ADMIN_REFINEMENT_CASE !== name) continue;
    try { await run(); console.log('PASS', name); }
    catch (error) { failures.push(name); console.error('FAIL', name, error.stack || error); }
  }
} finally { await browser.close(); }
assert.deepEqual(failures, [], '后台完善浏览器用例必须全部通过');
console.log('Admin refinement browser tests passed: isolated CRUD, normalization, baseline versions, locks, conflicts and login recovery.');
