const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { URL } = require('node:url');
const { validateApplication, isPublicAddress, hasBacklink, fetchPublicPage } = require('./friend-policy.cjs');

const FRIENDS_CONFIG_RELATIVE_PATH = 'src/data/friends.json';

// 与友链页面共享已有站点资料。
const SITE_INFO = require('../../src/data/friend-site.json');

const DEFAULT_TAG = 'Blog';

function normalizeUrl(value) {
	if (!value) return '';
	try {
		return new URL(value.trim()).toString();
	} catch {
		return '';
	}
}

function trimTrailingSlash(value) {
	return value.replace(/\/$/, '');
}

function escapeString(value) {
	return String(value ?? '')
		.replace(/\\/g, '\\\\')
		.replace(/"/g, '\\"');
}

function parseIssueBody(body) {
	const data = {
		site_name: '',
		site_url: '',
		friend_page_url: '',
		site_desc: '',
		site_avatar: '',
		site_image: '',
		site_tag: DEFAULT_TAG,
	};

	const lines = body.split(/\r?\n/).map((line) => line.trim());
	let pendingField = null;

	const assignField = (field, value) => {
		if (!value) return;
		const trimmed = value.trim();
		if (!trimmed) return;
		switch (field) {
			case 'site_name':
				data.site_name = trimmed;
				break;
			case 'site_url':
				data.site_url = normalizeUrl(trimmed);
				break;
			case 'friend_page_url':
				data.friend_page_url = normalizeUrl(trimmed);
				break;
			case 'site_desc':
				data.site_desc = trimmed;
				break;
			case 'site_avatar':
				data.site_avatar = normalizeUrl(trimmed);
				break;
			case 'site_image':
				data.site_image = normalizeUrl(trimmed);
				break;
			case 'site_tag':
				data.site_tag = trimmed || DEFAULT_TAG;
				break;
		}
	};

	for (const line of lines) {
		if (!line) continue;

		// 匹配现有 Issue 模板的字段标题
		if (/^#+\s*(网站名称|名称|站点名称)/.test(line)) {
			pendingField = 'site_name';
			continue;
		}
		if (/^#+\s*(网站链接|站点链接|链接|网址|地址)/.test(line)) {
			pendingField = 'site_url';
			continue;
		}
		if (/^#+\s*(友链页面|友链地址|友链页面 URL)/.test(line)) {
			pendingField = 'friend_page_url';
			continue;
		}
		if (/^#+\s*(网站描述|描述|简介)/.test(line)) {
			pendingField = 'site_desc';
			continue;
		}
		if (/^#+\s*(网站头像|头像|图标|头像链接)/.test(line)) {
			pendingField = 'site_avatar';
			continue;
		}
		if (/^#+\s*(封面图片|封面图|封面)/.test(line)) {
			pendingField = 'site_image';
			continue;
		}
		if (/^#+\s*(网站标签|标签|分类)/.test(line)) {
			pendingField = 'site_tag';
			continue;
		}

		if (pendingField) {
			assignField(pendingField, line);
			pendingField = null;
			continue;
		}

		if (/[:：]/.test(line)) {
			const [key, ...rest] = line.split(/[:：]/);
			const value = rest.join(':').trim();
			if (!value) continue;

			if (/名称|标题/.test(key)) assignField('site_name', value);
			else if (/网站链接|站点链接|链接|网址|地址/.test(key)) assignField('site_url', value);
			else if (/友链页面|友链地址/.test(key)) assignField('friend_page_url', value);
			else if (/描述|简介/.test(key)) assignField('site_desc', value);
			else if (/头像|图标/.test(key)) assignField('site_avatar', value);
			else if (/封面/.test(key)) assignField('site_image', value);
			else if (/标签|分类/.test(key)) assignField('site_tag', value);
		}
	}

	return data;
}

function extractString(block, key) {
	// 匹配 key: "value" 或 key:\n\t\t"value"（支持换行后的字符串）
	const regex = new RegExp(`${key}:\\s*(?:\\n\\s*)?["']([^"']*?)["']`);
	const match = block.match(regex);
	return match ? match[1] : '';
}

function extractNumber(block, key, fallback = 0) {
	const match = block.match(new RegExp(`${key}:\s*(\d+)`));
	return match ? Number(match[1]) : fallback;
}

function extractBoolean(block, key, fallback = true) {
	const match = block.match(new RegExp(`${key}:\s*(true|false)`));
	return match ? match[1] === 'true' : fallback;
}

function extractTags(block) {
	const match = block.match(/tags:\s*\[([\s\S]*?)\]/);
	if (!match) return [DEFAULT_TAG];
	const tags = [...match[1].matchAll(/["']([^"']+)["']/g)].map((item) => item[1]);
	return tags.length ? tags : [DEFAULT_TAG];
}

function parseFriendsConfig(content) {
 const data=JSON.parse(content);
 if(!Array.isArray(data)) throw new Error("友链数据必须为数组");
 return data;
}

function updateFriendsConfig(repoRoot, data) {
	const filePath = path.join(repoRoot, FRIENDS_CONFIG_RELATIVE_PATH);
	const content = fs.readFileSync(filePath, 'utf8');

	const friends = parseFriendsConfig(content);
	const normalizedUrl = trimTrailingSlash(data.site_url);

	const nextFriend = {
		title: data.site_name,
		imgurl: data.site_avatar || `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(data.site_name)}`,
		desc: data.site_desc || '',
		siteurl: data.site_url,
		image: data.site_image || '',
		...(data.friend_page_url ? { linkpage: data.friend_page_url } : {}),
		tags: [data.site_tag || DEFAULT_TAG],
		weight: 5,
		enabled: true,
	};

	const existingIndex = friends.findIndex((friend) => trimTrailingSlash(friend.siteurl) === normalizedUrl);
	if (existingIndex >= 0) throw new Error('站点已存在，更新资料请联系站长人工审核');
	friends.push(nextFriend);

	const updatedContent = JSON.stringify(friends, null, 2) + "\n";

	const changed = updatedContent !== content;
	if (changed) {
		fs.writeFileSync(filePath, updatedContent, 'utf8');
	}

	return {
		changed,
		filePath,
		friend: nextFriend,
	};
}

function run(command, args, options = {}) {
	const result = spawnSync(command, args, {
		stdio: 'inherit',
		shell: false,
		...options,
	});
	if (result.status !== 0) {
		throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
	}
}

function formatFriendsConfig(repoRoot) {
	const biomeBinary = path.join(
		repoRoot,
		"node_modules",
		".bin",
		process.platform === "win32" ? "biome.cmd" : "biome"
	);
	if (!fs.existsSync(biomeBinary)) {
		throw new Error("未找到 Biome 可执行文件，无法格式化 friends.json。");
	}
	run(biomeBinary, ["format", "--write", FRIENDS_CONFIG_RELATIVE_PATH], { cwd: repoRoot });
}

async function validateFriendPage(pageUrl, siteUrl) {
 try {
  const response = await fetchPublicPage(pageUrl, new URL(siteUrl).origin);
  const ok = response.status >= 200 && response.status < 300;
  return { ok: ok && hasBacklink(response.content, SITE_INFO.url), kind: ok ? 'missing-backlink' : 'unreachable', actualUrl: response.actualUrl, pageTitle: '', statusCode: response.status };
 } catch (error) { return {ok:false,kind:'unreachable',actualUrl:pageUrl,error:error.message}; }
}

async function addLabels(github, owner, repo, issueNumber, labels) {
	if (!labels.length) return;
	await github.rest.issues.addLabels({
		owner,
		repo,
		issue_number: issueNumber,
		labels,
	});
}

async function removeLabelIfExists(github, owner, repo, issueNumber, label) {
	try {
		await github.rest.issues.removeLabel({
			owner,
			repo,
			issue_number: issueNumber,
			name: label,
		});
	} catch (error) {
		if (error.status !== 404) throw error;
	}
}

async function createComment(github, owner, repo, issueNumber, body) {
	await github.rest.issues.createComment({
		owner,
		repo,
		issue_number: issueNumber,
		body,
	});
}

function commitAndPush(repoRoot, defaultBranch, filePath, siteName) {
	run('git', ['config', 'user.name', 'github-actions[bot]'], { cwd: repoRoot });
	run('git', ['config', 'user.email', 'github-actions[bot]@users.noreply.github.com'], { cwd: repoRoot });
	run('git', ['add', filePath], { cwd: repoRoot });

	const hasChanges = spawnSync('git', ['diff', '--cached', '--quiet', '--', filePath], {
		cwd: repoRoot,
		shell: false,
	}).status !== 0;

	if (!hasChanges) {
		return false;
	}

	run('git', ['commit', '-m', `🤝 更新友链: ${siteName}`], { cwd: repoRoot });
	run('git', ['pull', '--rebase', 'origin', defaultBranch], { cwd: repoRoot });
	run('git', ['push', 'origin', `HEAD:${defaultBranch}`], { cwd: repoRoot });
	return true;
}

module.exports = async function processFriendRequest({ github, context }) {
	const issue = context.payload.issue;
	if (!issue) {
		console.log('当前事件不包含 issue，跳过。');
		return;
	}

	const owner = context.repo.owner;
	const repo = context.repo.repo;
	const issueNumber = issue.number;
	const action = context.payload.action;
	const body = issue.body || '';
	const isCommentEvent = context.eventName === 'issue_comment';

	// 检测是否为友链申请（包含特定表单字段）
	const isFriendRequest = body.includes('### 网站名称') && body.includes('### 网站链接');
	const isFriendRequestAlt = body.includes('### 网站名称') && body.includes('### 头像链接');
	if (!isFriendRequest && !isFriendRequestAlt) {
		console.log('非友链申请 issue，跳过。');
		return;
	}

	try {

		if (action === 'opened' || action === 'reopened') {
			await addLabels(github, owner, repo, issueNumber, ['验证中']);
		}

		if (isCommentEvent) {
			const isAuthor = context.payload.comment?.user?.login === issue.user?.login;
			if (!isAuthor) {
				console.log('评论不是来自 issue 作者，跳过。');
				return;
			}
		}

		const formData = parseIssueBody(body);

		if (!formData.site_name || !formData.site_url || !formData.friend_page_url) {
			await createComment(
				github,
				owner,
				repo,
				issueNumber,
				'❌ 友链信息不完整，请确保填写了网站名称、网站链接和友链页面 URL。'
			);
			await addLabels(github, owner, repo, issueNumber, ['needs-update']);
			return;
		}

		if (!normalizeUrl(formData.site_url) || !normalizeUrl(formData.friend_page_url)) {
			await createComment(
				github,
				owner,
				repo,
				issueNumber,
				'❌ 提交的信息中包含无效 URL，请检查网站链接和友链页面 URL。'
			);
			await addLabels(github, owner, repo, issueNumber, ['needs-update']);
			return;
		}

		validateApplication(formData);
		const validation = await validateFriendPage(formData.friend_page_url, formData.site_url);

		if (!validation.ok) {
			const failureMessage =
				validation.kind === 'missing-backlink'
					? `❌ 友链验证失败：**${formData.site_name}**

**失败原因**：未在网站中找到本站友链
- 网站: ${validation.actualUrl}
- 标题: ${validation.pageTitle || '无'}

请先在你的网站添加本站友链：
- **名称**: ${SITE_INFO.name}
- **链接**: ${SITE_INFO.url}
- **头像**: ${SITE_INFO.avatar}
- **描述**: ${SITE_INFO.desc}

---
💡 添加友链后，回复本 Issue 即可重新检查。`
					: `❌ 友链验证失败：**${formData.site_name}**

**失败原因**：友链页面无法访问
- 链接: ${formData.friend_page_url}
- 实际访问: ${validation.actualUrl}
- 状态码: ${validation.statusCode || '无'}
- 错误: ${validation.error || '未知错误'}

请确认友链页面是否可以正常访问。`;

			await createComment(github, owner, repo, issueNumber, failureMessage);
			await addLabels(github, owner, repo, issueNumber, ['needs-update']);
			return;
		}

		const repoRoot = process.env.GITHUB_WORKSPACE || process.cwd();
		const updateResult = updateFriendsConfig(repoRoot, formData);
		formatFriendsConfig(repoRoot);

		const committed = commitAndPush(
			repoRoot,
			context.payload.repository?.default_branch || 'main',
			FRIENDS_CONFIG_RELATIVE_PATH,
			formData.site_name
		);

		const commentBody = committed
			? `✅ 你的网站 **${formData.site_name}** (${formData.site_url}) 已成功添加到 ${SITE_INFO.name} 的友链中。

**友链信息**：
- 名称: ${formData.site_name}
- 链接: ${formData.site_url}
- 描述: ${formData.site_desc || '无'}
- 头像: ${formData.site_avatar || updateResult.friend.imgurl}
${formData.site_image ? `- 封面图: ${formData.site_image}\n` : ''}`
			: `✅ 友链信息已经是最新状态，无需重复提交。

**网站**：${formData.site_name}
**链接**：${formData.site_url}`;

		await createComment(github, owner, repo, issueNumber, commentBody);
		await removeLabelIfExists(github, owner, repo, issueNumber, '验证中');
		await removeLabelIfExists(github, owner, repo, issueNumber, 'needs-update');
		await github.rest.issues.update({
			owner,
			repo,
			issue_number: issueNumber,
			state: 'closed',
			state_reason: 'completed',
		});
		return { changed: committed };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(message);
		await createComment(
			github,
			owner,
			repo,
			issueNumber,
			`❌ 自动处理友链申请时出现异常：${message}

请检查 workflow 日志后重试。`
		);
		throw error;
	}
};

module.exports.helpers = {validateApplication,isPublicAddress,hasBacklink,updateFriendsConfig};
