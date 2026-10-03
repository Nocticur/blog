import { spawn } from 'node:child_process';
import { dev } from 'astro';
const origin = 'http://127.0.0.1:4322';
process.env.WRITING_DEV_PREVIEW = '1';
const server = await dev({ server: { host: '127.0.0.1', port: 4322 }, devToolbar: { enabled: false }, logLevel: 'error' });
async function run(script) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], { stdio: 'inherit', env: { ...process.env, FEATURE_TEST_ORIGIN: origin, BROWSER_BASE_URL: origin, ADMIN_TEST_ORIGIN: origin, HERO_TEST_ORIGIN: origin } });
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${script}: exit ${code}`)));
  });
}
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { const response = await fetch(`${origin}/admin/`, { signal: AbortSignal.timeout(10000) }); if (response.ok) { ready = true; break; } } catch { /* Wait for startup. */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error('Development server startup timed out');
  for (const script of ['scripts/test-project-browser.mjs','scripts/test-feature-browser.mjs','scripts/test-admin-navigation-browser.mjs','scripts/test-admin-state-browser.mjs','scripts/test-admin-editor-browser.mjs','scripts/test-content-manager-browser.mjs','scripts/test-admin-workspace-browser.mjs','scripts/test-admin-refinement-browser.mjs','scripts/test-visitor-welcome-browser.mjs'].filter(script => script.includes(process.env.BROWSER_TEST_FILTER || ''))) await run(script);
} finally { await server.stop(); }
