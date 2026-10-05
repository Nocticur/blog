import fs from 'node:fs/promises';
import { publishFriendReport, reportBranch } from '../.github/scripts/friend-report-store.mjs';
const report = JSON.parse(await fs.readFile(new URL('../reports/friend-links.json', import.meta.url), 'utf8'));
await publishFriendReport(report);
console.log(`友链报告已保存至 ${reportBranch}。`);
