import fs from 'node:fs/promises';
import { checkFriends } from './friend-health.mjs';
import { createScreenshotCapture } from './friend-screenshots.mjs';
import { loadPreviousReport } from '../.github/scripts/friend-report-store.mjs';

export async function runFriendHealth(env = process.env) {
  const friends = JSON.parse(await fs.readFile(new URL('../src/data/friends.json', import.meta.url), 'utf8'));
  const site = JSON.parse(await fs.readFile(new URL('../src/data/friend-site.json', import.meta.url), 'utf8'));
  let previous;
  if (env.GITHUB_TOKEN && env.GITHUB_REPOSITORY) previous = await loadPreviousReport({ repository: env.GITHUB_REPOSITORY });
  else {
    try { previous = JSON.parse(await fs.readFile(new URL('../reports/friend-links.json', import.meta.url), 'utf8')); }
    catch { previous = { results: [] }; }
  }
  let screenshots = null;
  let screenshotFailures = 0;
  if (friends.some(friend => friend.enabled === true)) {
    try { screenshots = await createScreenshotCapture(env); }
    catch { screenshotFailures++; console.warn('截图浏览器不可用，将继续检测并保留已有封面。'); }
  }
  let report;
  try {
    report = await checkFriends(friends, { previous, ownUrl: site.url, capture: screenshots?.capture, onScreenshotError: () => { screenshotFailures++; } });
  } finally { await screenshots?.close(); }
  await fs.mkdir(new URL('../reports/', import.meta.url), { recursive: true });
  await fs.writeFile(new URL('../reports/friend-links.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  const counts = report.results.reduce((value, result) => { value[result.status]++; return value; }, { ok: 0, restricted: 0, error: 0, unknown: 0 });
  const summary = `检查 ${report.results.length} 个友链：正常 ${counts.ok}，检测受限 ${counts.restricted}，访问异常 ${counts.error}。截图失败 ${screenshotFailures}。报告不会修改、停用或删除友链。\n`;
  console.log(summary);
  if (env.GITHUB_STEP_SUMMARY) await fs.appendFile(env.GITHUB_STEP_SUMMARY, summary);
  return report;
}
