export const reportBranch = 'codex/friend-status';
export const reportPath = 'reports/friend-links.json';
const disabledConfiguration = { git: { deploymentEnabled: false } };
const reportRef = `heads/${reportBranch}`;

export function createGitHubApi({ token = process.env.GITHUB_TOKEN, fetcher = fetch } = {}) {
  if (!token) throw new Error('报告发布需要 GITHUB_TOKEN');
  return async (route, { method = 'GET', body } = {}) => {
    const response = await fetcher(`https://api.github.com${route}`, {
      method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: 'error', signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) { const error = new Error(`GitHub 报告请求失败 HTTP ${response.status}`); error.status = response.status; throw error; }
    return response.status === 204 ? null : response.json();
  };
}

function repositoryPath(repository) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '')) throw new Error('报告仓库必须为 owner/repo');
  return `/repos/${repository}`;
}
function decode(file) { return JSON.parse(Buffer.from(file.content, 'base64').toString('utf8')); }
async function maybeFile(api, route) {
  try { return await api(route); } catch (error) { if (error.status === 404) return null; throw error; }
}
function fileRoute(root, path) { return `${root}/contents/${path}?ref=${encodeURIComponent(reportBranch)}`; }
function updateRoute(root, path) { return `${root}/contents/${path}`; }

export async function loadPreviousReport({ repository = process.env.GITHUB_REPOSITORY, api = createGitHubApi() } = {}) {
  const root = repositoryPath(repository);
  const file = await maybeFile(api, fileRoute(root, reportPath));
  return file ? decode(file) : { schemaVersion: 1, checkedAt: null, results: [] };
}

async function ensureDisabledDeployment(root, api) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const file = await maybeFile(api, fileRoute(root, 'vercel.json'));
    const config = file ? decode(file) : {};
    if (config.git?.deploymentEnabled === false) return;
    config.git = { ...config.git, deploymentEnabled: false };
    try {
      await api(updateRoute(root, 'vercel.json'), { method: 'PUT', body: {
        message: 'chore: disable friend report deployments', branch: reportBranch,
        ...(file ? { sha: file.sha } : {}), content: Buffer.from(JSON.stringify(config, null, 2) + '\n').toString('base64'),
      } }); return;
    } catch (error) { if (![409, 422].includes(error.status) || attempt === 2) throw error; }
  }
}

export async function publishFriendReport(report, { repository = process.env.GITHUB_REPOSITORY, api = createGitHubApi() } = {}) {
  const root = repositoryPath(repository);
  const content = JSON.stringify(report, null, 2) + '\n';
  try {
    await api(`${root}/git/ref/${reportRef}`);
  } catch (error) {
    if (error.status !== 404) throw error;
    const tree = await api(`${root}/git/trees`, { method: 'POST', body: { tree: [
      { path: 'vercel.json', mode: '100644', type: 'blob', content: JSON.stringify(disabledConfiguration, null, 2) + '\n' },
      { path: reportPath, mode: '100644', type: 'blob', content },
    ] } });
    const commit = await api(`${root}/git/commits`, { method: 'POST', body: { message: 'chore: initialize friend health report', tree: tree.sha, parents: [] } });
    try {
      await api(`${root}/git/refs`, { method: 'POST', body: { ref: `refs/${reportRef}`, sha: commit.sha } });
      return;
    } catch (error) { if (error.status !== 422) throw error; }
  }
  await ensureDisabledDeployment(root, api);
  for (let attempt = 0; attempt < 3; attempt++) {
    const file = await maybeFile(api, fileRoute(root, reportPath));
    if (file && Date.parse(decode(file).checkedAt) > Date.parse(report.checkedAt)) throw new Error('报告分支已有较新的检测结果，拒绝覆盖');
    try {
      await api(updateRoute(root, reportPath), { method: 'PUT', body: {
        branch: reportBranch, message: 'chore: update friend health report',
        ...(file ? { sha: file.sha } : {}), content: Buffer.from(content).toString('base64'),
      } }); return;
    } catch (error) { if (![409, 422].includes(error.status) || attempt === 2) throw error; }
  }
}
