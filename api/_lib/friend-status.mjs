import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { friendWebUrl } from '../../src/utils/friend-data.mjs';

const REPORT_FILE = 'reports/friend-links.json';
const REPORT_BRANCH = 'codex/friend-status';
const MAX_REPORT_BYTES = 1024 * 1024;
const CACHE_MS = 300000;
export const FRIEND_STATUS_CACHE_CONTROL = 'public, max-age=0, s-maxage=300, stale-while-revalidate=300';
const unavailable = () => Object.assign(new Error('友链检测结果暂不可用，请稍后重试'), { status: 503 });
const date = value => {
  if (typeof value !== 'string' || !value.trim() || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
};
function webAddress(value) {
  if (typeof value !== 'string') return null;
  try { return friendWebUrl(value).href; } catch { return null; }
}

/** Only these fields may leave the private GitHub report. */
export function sanitizeFriendStatus(report) {
  const results = [];
  if (Array.isArray(report?.results)) for (const row of report.results) {
    if (!row || typeof row !== 'object') continue;
    const url = webAddress(row.url);
    if (!url) continue;
    results.push({
      title: typeof row.title === 'string' ? row.title.slice(0, 256) : '',
      url,
      status: ['ok', 'restricted', 'error', 'unknown'].includes(row.status) ? row.status : 'unknown',
      checkedAt: date(row.checkedAt),
      httpStatus: Number.isInteger(row.httpStatus) && row.httpStatus >= 100 && row.httpStatus <= 599 ? row.httpStatus : null,
      latencyMs: typeof row.latencyMs === 'number' && Number.isFinite(row.latencyMs) && row.latencyMs >= 0 ? row.latencyMs : null,
      backlink: ['found', 'missing', 'unchecked', 'unknown'].includes(row.backlink) ? row.backlink : 'unknown',
      screenshotUrl: webAddress(row.screenshotUrl),
      screenshotAt: date(row.screenshotAt),
    });
  }
  return { schemaVersion: 1, checkedAt: date(report?.checkedAt), results };
}

export async function readLocalFriendStatus(root) {
  const file = path.resolve(root, REPORT_FILE);
  try {
    if ((await stat(file)).size > MAX_REPORT_BYTES) throw unavailable();
    return sanitizeFriendStatus(JSON.parse(await readFile(file, 'utf8')));
  } catch (error) {
    if (error.code === 'ENOENT') return sanitizeFriendStatus(null);
    throw unavailable();
  }
}

async function boundedJson(response) {
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > MAX_REPORT_BYTES * 2) throw unavailable();
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function createFriendStatusService({ env = process.env, fetcher = globalThis.fetch, now = Date.now } = {}) {
  const cached = new Map();
  const pending = new Map();
  return {
    async read() {
      const configured = String(env.WRITING_GITHUB_REPO || '').trim();
      const repo = configured || (env.VERCEL_GIT_REPO_OWNER && env.VERCEL_GIT_REPO_SLUG ? `${env.VERCEL_GIT_REPO_OWNER}/${env.VERCEL_GIT_REPO_SLUG}` : '');
      const token = env.GITHUB_TOKEN ?? env.GH_TOKEN;
      if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !token) throw unavailable();
      const previous = cached.get(repo);
      if (previous && now() - previous.at < CACHE_MS) return previous.report;
      if (pending.has(repo)) return pending.get(repo);
      const load = (async () => {
        try {
          const response = await fetcher(`https://api.github.com/repos/${repo}/contents/${REPORT_FILE}?ref=${encodeURIComponent(REPORT_BRANCH)}`, {
            headers: {
              Accept: 'application/vnd.github+json',
              Authorization: `Bearer ${token}`,
              'X-GitHub-Api-Version': '2022-11-28',
              'User-Agent': 'firefly-friend-status',
            },
            redirect: 'error',
            signal: AbortSignal.timeout(15000),
          });
          let report;
          if (response.status === 404) report = sanitizeFriendStatus(null);
          else {
            if (!response.ok) throw unavailable();
            const file = await boundedJson(response);
            if (file.type !== 'file' || file.size > MAX_REPORT_BYTES || typeof file.content !== 'string') throw unavailable();
            const bytes = Buffer.from(file.content, 'base64');
            if (bytes.length > MAX_REPORT_BYTES) throw unavailable();
            report = sanitizeFriendStatus(JSON.parse(bytes.toString('utf8')));
          }
          cached.set(repo, { at: now(), report });
          return report;
        } catch {
          if (previous) return previous.report;
          throw unavailable();
        } finally { pending.delete(repo); }
      })();
      pending.set(repo, load);
      return load;
    },
  };
}
