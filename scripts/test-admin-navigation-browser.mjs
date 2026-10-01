import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const origin = process.env.BROWSER_BASE_URL || process.env.FEATURE_TEST_ORIGIN || 'http://127.0.0.1:4321';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 848, height: 719 } });
  const errors = [];
  const writes = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/writing/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== 'GET') { writes.push(path); return route.fulfill({ status: 403, json: { error: '隔离测试不提交内容' } }); }
    if (path.endsWith('/session/')) return route.fulfill({ json: { authenticated: true, preview: true, mode: 'dev' } });
    if (path.includes('/posts/')) return route.fulfill({ json: { posts: [], mode: 'dev' } });
    if (path.includes('/sidebar/')) return route.fulfill({ json: { version: 's1', source: JSON.stringify({ enable: true, position: 'both', leftComponents: [], rightComponents: [], mobileBottomComponents: [] }) } });
    if (path.includes('/announcements/')) return route.fulfill({ json: { version: 'a1', source: JSON.stringify({ title: '原公告', closable: false, items: [] }) } });
    return route.fulfill({ json: { items: [] } });
  });
  await page.goto(origin + '/admin/', { waitUntil: 'domcontentloaded' });
  await page.locator('.admin-shell').waitFor();
  assert.equal(await page.locator('.admin-sidebar nav').getByText('更多内容', { exact: true }).count(), 0, '内容模块直接出现在侧栏');
  assert.equal(await page.locator('.admin-search, .admin-breadcrumb').count(), 0, '装饰横栏不保留搜索和面包屑');
  assert.equal(await page.locator('.admin-topbar').getByRole('button', { name: '刷新', exact: true }).count(), 0);
  assert.notEqual(await page.locator('.admin-account-main').evaluate(node => node.tagName), 'BUTTON', '预览账户为静态信息');
  assert.equal(await page.locator('.admin-account-main').getAttribute('role'), null, '静态预览账号不模拟可点击按钮');
  assert.equal(await page.locator('.admin-avatar img, img.admin-avatar').count(), 1, '管理员复用网站头像');
  assert.equal(await page.getByText('登录以保存', { exact: true }).count(), 0);
  assert.equal(await page.locator('#admin-dashboard').getByRole('button', { name: '重新读取数据', exact: true }).count(), 1);
  assert.equal(await page.locator('.admin-section:visible').count(), 1, '工作台不能堆叠所有管理模块');
  const select = async (label, section, hash) => {
    await page.locator('.admin-sidebar nav button').filter({ hasText: label }).click();
    await page.locator(`#${section}:visible`).waitFor();
    assert.equal(await page.locator('.admin-section:visible').count(), 1, '每次仅显示所选模块');
    await page.waitForFunction(() => window.scrollY === 0);
    assert.equal(await page.evaluate(() => window.scrollY), 0, '模块切换应回到页面顶部');
    assert.equal(new URL(page.url()).hash, '#' + hash);
  };
  await select('公告管理', 'admin-announcements', 'announcements');
  await page.getByLabel('公告栏标题', { exact: true }).fill('保留未提交公告');
  await select('文章管理', 'admin-writing', 'writing');
  await page.locator('#admin-writing').getByRole('button', { name: '新建文章', exact: true }).click();
  await page.getByPlaceholder('文章标题').fill('切换后仍保留的草稿');
  await page.locator('.ws-editor').fill('未提交正文');
  await select('笔记本', 'admin-records', 'notebooks');
  await page.locator('#admin-records').getByRole('button', { name: '新建草稿', exact: true }).click();
  await page.locator('#admin-records textarea').first().fill('笔记本的未提交输入');
  await select('规划记录', 'admin-records', 'routines');
  await page.locator('#admin-records').getByRole('button', { name: '新建草稿', exact: true }).click();
  await page.evaluate(() => { window.__restoreStorage = Storage.prototype.setItem; Storage.prototype.setItem = () => { throw new DOMException('Unavailable', 'QuotaExceededError'); }; });
  await page.locator('#admin-records textarea').first().fill('规划的未提交输入');
  await select('笔记本', 'admin-records', 'notebooks');
  await page.waitForFunction(() => document.querySelector('#admin-records textarea')?.value === '笔记本的未提交输入');
  await select('规划记录', 'admin-records', 'routines');
  assert.equal(await page.locator('#admin-records textarea').first().inputValue(), '规划的未提交输入', '存储不可用时切换仍保留内存中的记录');
  await page.evaluate(() => { Storage.prototype.setItem = window.__restoreStorage; });
  await select('站点管理', 'admin-settings', 'settings');
  for (const [label, hash] of [['动态', 'dynamic'], ['足迹', 'places'], ['友链', 'friends'], ['工具导航', 'navigation'], ['相册', 'gallery'], ['赞助者', 'sponsors'], ['朋友圈订阅', 'feeds']]) {
    await select(label, 'admin-records', hash);
    await page.locator('#admin-records textarea').first().waitFor();
  }
  assert.equal(await page.getByRole('navigation', { name: '内容模块' }).count(), 0, '正文不再重复模块导航');
  await select('文章管理', 'admin-writing', 'writing');
  assert.equal(await page.getByPlaceholder('文章标题').inputValue(), '切换后仍保留的草稿');
  assert.equal(await page.locator('.ws-editor').inputValue(), '未提交正文');
  await select('公告管理', 'admin-announcements', 'announcements');
  assert.equal(await page.getByLabel('公告栏标题', { exact: true }).inputValue(), '保留未提交公告');
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', code: 'KeyS', ctrlKey: true, bubbles: true, cancelable: true })));
  await page.waitForTimeout(200);
  assert.deepEqual(writes, [], '公告页快捷键不得提交隐藏的文章');
  assert.equal(await page.locator('#admin-theme-menu').count(), 0, '账号菜单不能重复主题入口');
  assert.equal(await page.locator('#admin-account-menu').count(), 0);
  await page.getByRole('button', { name: '切换主题', exact: true }).click();
  assert.equal(await page.locator('#admin-account-menu').count(), 0, '主题菜单与账号菜单互斥');
  await page.getByRole('button', { name: '浅色模式', exact: true }).click();
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('dark')), false);
  await page.getByRole('button', { name: '切换主题', exact: true }).click();
  await page.getByRole('button', { name: '深色模式', exact: true }).click();
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('dark')), true);
  await page.getByRole('button', { name: '切换主题', exact: true }).click();
  await page.getByRole('button', { name: '跟随系统', exact: true }).click();
  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForFunction(() => !document.documentElement.classList.contains('dark'));
  await page.getByRole('button', { name: '切换主题', exact: true }).click();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#admin-theme-menu').count(), 0);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('#admin-announcements:visible').waitFor();
  assert.equal(await page.locator('.admin-section:visible').count(), 1, '刷新保留当前模块');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '打开导航', exact: true }).click();
  await select('工作台', 'admin-dashboard', 'dashboard');
  assert.equal(await page.locator('.admin-sidebar.open').count(), 0, '手机选择模块后收起导航');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  await page.setViewportSize({ width: 848, height: 719 });
  for (const [hash, expected] of [['#content', '#dynamic'], ['#admin-content', '#dynamic'], ['#admin-places', '#places'], ['#unknown-module', '#dashboard']]) {
    await page.evaluate(value => { location.hash = value; }, hash);
    await page.waitForURL(url => url.hash === expected);
    assert.equal(await page.locator('.admin-section:visible').count(), 1);
  }
  assert.deepEqual(errors, []);
  console.log('Admin navigation passed: single module views, top position, independent drafts, remembered location and mobile drawer.');
} finally {
  await browser.close();
}
