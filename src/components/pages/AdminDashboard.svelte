<script lang="ts">
import {
	Activity,
	ArrowDown,
	ArrowUp,
	Bell,
	ChevronDown,
	Compass,
	ExternalLink,
	FileText,
	Heart,
	Images,
	LayoutDashboard,
	Link,
	ListTodo,
	LogOut,
	MapPin,
	Menu,
	Monitor,
	Moon,
	NotebookPen,
	Plus,
	RefreshCw,
	Rss,
	Settings,
	Sun,
} from "lucide-svelte";
import { onMount, tick } from "svelte";
import {
	getTabBufferKey,
	loadLocalBuffer,
	removeLocalBuffer,
	saveLocalBuffer,
} from "@/utils/admin-editor-state";
import {
	adminNavigationGroups,
	contentModules,
	isContentModule,
	resolveAdminPage,
} from "@/utils/admin-modules";
import {
	announcementDate,
	announcementTitle,
	normalizeAnnouncements,
	sortAnnouncementItems,
	validateAnnouncements,
	visibleAnnouncements,
} from "@/utils/announcement-data.mjs";
import ContentManager from "./ContentManager.svelte";
import WritingStudio from "./WritingStudio.svelte";

let {
	avatarUrl = "/assets/images/logo-nocticur.png",
	siteUrl = "/",
	darkTheme = "github-dark",
	lightTheme = "github-light",
} = $props<{
	avatarUrl?: string;
	siteUrl?: string;
	darkTheme?: string;
	lightTheme?: string;
}>();
type Post = {
	file: string;
	title?: string;
	draft?: boolean;
	published?: string;
	description?: string;
};
type Sidebar = {
	[key: string]: unknown;
	enable: boolean;
	position: "left" | "right" | "both";
	leftComponents: Array<Record<string, unknown>>;
	rightComponents: Array<Record<string, unknown>>;
	mobileBottomComponents: Array<Record<string, unknown>>;
};
type AnnouncementItem = {
	[key: string]: unknown;
	tag: string;
	title: string;
	content: string;
	time: string;
	link?: string;
	sort: number;
	enabled?: boolean;
};
type Announcement = {
	[key: string]: unknown;
	title: string;
	closable: boolean;
	items: AnnouncementItem[];
};
type ConfigModule = "sidebar" | "announcements";
type ConfigBuffer = {
	sidebar?: { value: Sidebar; version: string; previousLocal?: string };
	announcements?: {
		value: Announcement;
		version: string;
		previousLocal?: string;
	};
};
class ApiError extends Error {
	status: number;
	constructor(message: string, status: number) {
		super(message);
		this.status = status;
	}
}
const nav = adminNavigationGroups.flatMap((group) => group.items);
const icons = {
	dashboard: LayoutDashboard,
	writing: FileText,
	routines: ListTodo,
	notebooks: NotebookPen,
	dynamic: Activity,
	places: MapPin,
	settings: Settings,
	announcements: Bell,
	friends: Link,
	navigation: Compass,
	gallery: Images,
	sponsors: Heart,
	feeds: Rss,
};
const componentLabels: Record<string, string> = {
	profile: "个人资料",
	announcement: "公告",
	music: "音乐播放器",
	categories: "分类",
	tags: "标签",
	stats: "站点统计",
	calendar: "日历",
	sidebarToc: "文章目录",
};
let password = $state("");
let authenticated = $state(false);
let workspaceMounted = $state(false);
let preview = $state(false);
let loading = $state(false);
let message = $state("");
let commitUrl = $state("");
let posts = $state<Post[]>([]);
let routines = $state<{ file: string }[]>([]);
let dashboardReady = $state(false);
let sidebar = $state<Sidebar | null>(null);
let announcements = $state<Announcement | null>(null);
let active = $state("dashboard");
let recordsModule = $state("routines");
let accountOpen = $state(false);
let themeOpen = $state(false);
let theme = $state<"dark" | "light" | "system">("system");
let mobileOpen = $state(false);
let motionAllowed = $state(false);
let pageVisible = $state(true);
let announcementView = $state<"edit" | "preview">("edit");
let sidebarVersion = $state("");
let announcementVersion = $state("");
let sidebarBaselineVersion = $state("");
let announcementBaselineVersion = $state("");
let sidebarBaseline = $state("");
let announcementBaseline = $state("");
let sidebarBackup = $state("");
let announcementBackup = $state("");
let settingsReady = $state(false);
let settingsBufferKey = "settings";
let bufferMessage = $state("");
let conflictModule = $state<ConfigModule | null>(null);
let comparison = $state<{
	module: ConfigModule;
	source: string;
	version: string;
} | null>(null);
const itemKeys = new WeakMap<object, number>();
let nextItemKey = 0;
const itemKey = (item: object) => {
	if (!itemKeys.has(item)) itemKeys.set(item, ++nextItemKey);
	return itemKeys.get(item)!;
};
const announcementSource = (value: Announcement) =>
	JSON.stringify(normalizeAnnouncements(value));
const sidebarDirty = $derived(
	Boolean(sidebar && JSON.stringify(sidebar) !== sidebarBaseline),
);
const announcementDirty = $derived(
	Boolean(
		announcements && announcementSource(announcements) !== announcementBaseline,
	),
);
const settingsDirty = $derived(sidebarDirty || announcementDirty);
const hasRecovery = $derived(Boolean(sidebarBackup || announcementBackup));
const orderedAnnouncements = $derived(
	announcements ? sortAnnouncementItems(announcements.items) : [],
);
const publicAnnouncements = $derived(
	announcements ? visibleAnnouncements(announcements) : [],
);
const currentAnnouncement = $derived(publicAnnouncements[0]);
const ThemeIcon = $derived(
	theme === "light" ? Sun : theme === "dark" ? Moon : Monitor,
);

const api = async (path: string, init: RequestInit = {}) => {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 30000);
	try {
		const response = await fetch(path, {
			...init,
			signal: controller.signal,
			credentials: "same-origin",
			cache: "no-store",
			headers: { "Content-Type": "application/json", ...(init.headers || {}) },
		});
		const data = await response.json().catch(() => ({}));
		if (!response.ok) {
			if (response.status === 401) sessionExpired();
			throw new ApiError(
				data.error || "请求失败（" + response.status + "）",
				response.status,
			);
		}
		return data;
	} finally {
		clearTimeout(timeout);
	}
};
const configPath = (module: ConfigModule) =>
	"/api/writing/content/" + module + "/";
const errorMessage = (error: unknown) =>
	error instanceof Error
		? error.name === "AbortError"
			? "请求超时，输入已保留。"
			: error.message
		: String(error);
async function login() {
	if (!password || loading) return;
	loading = true;
	message = "";
	try {
		await api("/api/writing/auth/", {
			method: "POST",
			body: JSON.stringify({ password }),
		});
		authenticated = true;
		preview = false;
		password = "";
		if (!workspaceMounted) {
			active = resolveAdminPage(location.hash);
			if (isContentModule(active)) recordsModule = active;
			await load(true);
			workspaceMounted = true;
		} else {
			message = "已重新登录，未提交编辑已保留。";
		}
	} catch (error) {
		message = errorMessage(error);
	} finally {
		loading = false;
	}
}
async function load(restoreLocal = false) {
	if (!restoreLocal && loading) return;
	if (
		!restoreLocal &&
		(settingsDirty || hasRecovery) &&
		!confirm("重新读取会丢弃侧栏和公告的未保存配置及合并备份，是否继续？")
	)
		return;
	loading = true;
	message = "";
	try {
		const [postData, routineData, sidebarData, announcementData] =
			await Promise.all([
				api("/api/writing/posts/?_=" + Date.now()),
				api("/api/writing/content/routines/"),
				api(configPath("sidebar")),
				api(configPath("announcements")),
			]);
		// Parse all replies before changing any draft or version.
		const nextSidebar = JSON.parse(sidebarData.source) as Sidebar;
		const nextAnnouncements = JSON.parse(
			announcementData.source,
		) as Announcement;
		if (
			!Array.isArray(nextSidebar.leftComponents) ||
			!Array.isArray(nextSidebar.rightComponents) ||
			typeof sidebarData.version !== "string" ||
			typeof announcementData.version !== "string"
		)
			throw new Error("配置读取结果无效，当前编辑仍保留。");
		const invalid = validateAnnouncements(nextAnnouncements);
		if (invalid) throw new Error(invalid);
		settingsReady = false;
		posts = postData.posts || [];
		routines = routineData.items || [];
		dashboardReady = true;
		sidebar = nextSidebar;
		announcements = nextAnnouncements;
		sidebarVersion = sidebarBaselineVersion = sidebarData.version;
		announcementVersion = announcementBaselineVersion =
			announcementData.version;
		sidebarBaseline = JSON.stringify(nextSidebar);
		announcementBaseline = announcementSource(nextAnnouncements);
		sidebarBackup = "";
		announcementBackup = "";
		comparison = null;
		conflictModule = null;
		if (restoreLocal) {
			try {
				const buffer = loadLocalBuffer<ConfigBuffer>(
					localStorage,
					settingsBufferKey,
				);
				if (buffer.error) bufferMessage = buffer.error;
				const saved = buffer.value;
				if (
					saved?.sidebar &&
					typeof saved.sidebar.version === "string" &&
					Array.isArray(saved.sidebar.value?.leftComponents) &&
					Array.isArray(saved.sidebar.value?.rightComponents)
				) {
					sidebar = saved.sidebar.value;
					sidebarVersion = saved.sidebar.version;
					sidebarBackup = saved.sidebar.previousLocal || "";
				}
				const savedAnnouncement = saved?.announcements;
				if (
					savedAnnouncement &&
					typeof savedAnnouncement.version === "string" &&
					Array.isArray(savedAnnouncement.value?.items) &&
					savedAnnouncement.value.items.every(
						(item) =>
							item &&
							typeof item.title === "string" &&
							typeof item.content === "string" &&
							Number.isFinite(item.sort),
					)
				) {
					announcements = savedAnnouncement.value;
					announcementVersion = savedAnnouncement.version;
					announcementBackup = savedAnnouncement.previousLocal || "";
				}
			} catch {
				bufferMessage =
					"无法读取本机暂存，浏览器存储不可用；请保留当前页面或复制配置。";
			}
		}
		settingsReady = true;
	} catch (error) {
		message = errorMessage(error);
	} finally {
		loading = false;
	}
}
function sessionExpired() {
	authenticated = false;
	accountOpen = false;
	themeOpen = false;
	mobileOpen = false;
	message = "登录已过期，请重新登录；当前编辑和版本仍保留。";
}
async function logout() {
	if (loading) return;
	loading = true;
	try {
		await api("/api/writing/logout/", { method: "POST" });
		authenticated = false;
		preview = false;
		accountOpen = false;
		message = "已退出登录，未提交编辑仍保留。";
	} catch (error) {
		message = errorMessage(error);
	} finally {
		loading = false;
	}
}
function applyTheme(next: "dark" | "light" | "system", remember = true) {
	theme = next;
	const dark =
		next === "dark" ||
		(next === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
	document.documentElement.classList.toggle("dark", dark);
	document.documentElement.setAttribute(
		"data-theme",
		dark ? darkTheme : lightTheme,
	);
	if (remember) {
		try {
			localStorage.setItem("firefly-admin-theme", next);
		} catch {
			bufferMessage = "浏览器存储不可用，主题偏好无法记住；当前编辑仍保留。";
		}
	}
}
function chooseTheme(next: "dark" | "light" | "system") {
	applyTheme(next);
	themeOpen = false;
}
function toggleAccount() {
	if (preview) return;
	accountOpen = !accountOpen;
	themeOpen = false;
}
function toggleTheme() {
	themeOpen = !themeOpen;
	accountOpen = false;
}
function setSidebarValue(
	side: "leftComponents" | "rightComponents",
	index: number,
	enabled: boolean,
) {
	if (!sidebar || loading) return;
	sidebar = {
		...sidebar,
		[side]: sidebar[side].map((item, i) =>
			i === index ? { ...item, enable: enabled } : item,
		),
	};
}
function setSideEnabled(
	side: "leftComponents" | "rightComponents",
	enabled: boolean,
) {
	if (!sidebar || loading) return;
	sidebar = {
		...sidebar,
		[side]: sidebar[side].map((item) => ({ ...item, enable: enabled })),
	};
}
function moveComponent(
	side: "leftComponents" | "rightComponents",
	index: number,
	direction: -1 | 1,
) {
	if (!sidebar || loading) return;
	const next = index + direction;
	if (next < 0 || next >= sidebar[side].length) return;
	const items = [...sidebar[side]];
	[items[index], items[next]] = [items[next], items[index]];
	sidebar = { ...sidebar, [side]: items };
}
async function addAnnouncement() {
	if (!announcements || loading) return;
	const max = Math.max(0, ...announcements.items.map((item) => item.sort));
	const item: AnnouncementItem = {
		tag: "",
		title: "",
		content: "",
		time: announcementDate(),
		sort: max + 1,
		enabled: true,
	};
	announcements.items = [item, ...announcements.items];
	const key = itemKey(announcements.items[0]);
	announcementView = "edit";
	await tick();
	document
		.getElementById("announcement-item-" + key)
		?.querySelector<HTMLInputElement>("input[data-announcement-title]")
		?.focus();
}
function removeAnnouncement(item: AnnouncementItem) {
	if (
		!announcements ||
		loading ||
		!confirm(
			"删除公告“" +
				(item.title.trim() || "未命名公告") +
				"”？点击保存公告后才会更新公开展示。",
		)
	)
		return;
	announcements.items = announcements.items.filter(
		(candidate) => itemKey(candidate) !== itemKey(item),
	);
}
function moveAnnouncement(item: AnnouncementItem, direction: -1 | 1) {
	if (!announcements || loading) return;
	const items = sortAnnouncementItems(announcements.items);
	const index = items.findIndex(
		(candidate) => itemKey(candidate) === itemKey(item),
	);
	const next = index + direction;
	if (index < 0 || next < 0 || next >= items.length) return;
	[items[index], items[next]] = [items[next], items[index]];
	items.forEach((entry, position) => {
		entry.sort = items.length - position;
	});
	announcements.items = items;
}
function clearConfigConflict(module: ConfigModule) {
	if (conflictModule === module) conflictModule = null;
	if (comparison?.module === module) comparison = null;
}
function cancelConfig(module: ConfigModule) {
	if (loading) return;
	if (module === "sidebar" && sidebarBaseline) {
		sidebar = JSON.parse(sidebarBaseline);
		sidebarVersion = sidebarBaselineVersion;
		sidebarBackup = "";
	}
	if (module === "announcements" && announcementBaseline) {
		announcements = JSON.parse(announcementBaseline);
		announcementVersion = announcementBaselineVersion;
		announcementBackup = "";
	}
	clearConfigConflict(module);
	message = "";
}
function savedConfig(module: ConfigModule, source: string, version: string) {
	if (module === "sidebar") {
		sidebarVersion = sidebarBaselineVersion = version;
		sidebarBaseline = JSON.stringify(JSON.parse(source));
		sidebarBackup = "";
	} else {
		announcementVersion = announcementBaselineVersion = version;
		announcementBaseline = announcementSource(JSON.parse(source));
		announcementBackup = "";
	}
	clearConfigConflict(module);
}
async function saveConfig(module: ConfigModule) {
	const value = module === "sidebar" ? sidebar : announcements;
	const version = module === "sidebar" ? sidebarVersion : announcementVersion;
	if (!value || !version || loading || !authenticated) return;
	const normalized =
		module === "announcements"
			? normalizeAnnouncements(value as Announcement)
			: value;
	if (module === "announcements") {
		const invalid = validateAnnouncements(normalized);
		if (invalid) {
			message = invalid;
			return;
		}
	}
	const source = JSON.stringify(normalized, null, 2);
	loading = true;
	message = "";
	commitUrl = "";
	try {
		const result = await api(configPath(module), {
			method: "PUT",
			body: JSON.stringify({ source, version }),
		});
		if (typeof result.version !== "string")
			throw new Error("保存响应不完整，正在核验提交结果。");
		savedConfig(module, source, result.version);
		const link = result.commit?.url || result.commit?.html_url;
		if (typeof link === "string" && /^https?:\/\//.test(link)) commitUrl = link;
		message = result.commit
			? "已保存到仓库，等待构建部署。"
			: "已保存到本地文件。";
	} catch (error) {
		if (error instanceof ApiError && error.status === 409) {
			conflictModule = module;
			message = "版本冲突：编辑内容已保留，请读取仓库版本进行比较。";
		} else if (
			!(error instanceof ApiError) ||
			[408, 502, 503, 504].includes(error.status)
		) {
			// A lost reply may follow a successful commit. Verify before offering a retry.
			try {
				const read = await api(configPath(module));
				const actual = JSON.parse(read.source);
				const matches =
					JSON.stringify(
						module === "announcements"
							? normalizeAnnouncements(actual)
							: actual,
					) === JSON.stringify(normalized);
				if (matches && typeof read.version === "string") {
					savedConfig(module, source, read.version);
					message = "已核验保存结果，内容已保存；网站以构建结果为准。";
				} else {
					message =
						errorMessage(error) +
						" 当前仓库内容与本次提交不同，输入已保留；请比较后重试。";
					conflictModule = module;
				}
			} catch {
				message =
					errorMessage(error) +
					" 暂时无法核验保存结果，输入已保留；恢复连接后先重新读取比较。";
				conflictModule = module;
			}
		} else {
			message = errorMessage(error);
		}
	} finally {
		loading = false;
	}
}
async function compareConfig(module = conflictModule) {
	if (!module || loading) return;
	loading = true;
	try {
		const result = await api(configPath(module));
		comparison = { module, source: result.source, version: result.version };
		await tick();
		document
			.getElementById("admin-comparison")
			?.scrollIntoView({ block: "center" });
	} catch (error) {
		message = errorMessage(error);
	} finally {
		loading = false;
	}
}
function acceptRepositoryConfig() {
	if (
		!comparison ||
		loading ||
		!confirm(
			"以仓库版本为新的编辑基础？本机内容会保留为只读备份，请手动合并后保存。",
		)
	)
		return;
	const { module, source, version } = comparison;
	try {
		const value = JSON.parse(source);
		if (module === "announcements") {
			const invalid = validateAnnouncements(value);
			if (invalid) throw new Error(invalid);
		}
		if (module === "sidebar") {
			sidebarBackup = JSON.stringify(sidebar, null, 2);
			sidebar = value;
			sidebarVersion = sidebarBaselineVersion = version;
			sidebarBaseline = JSON.stringify(value);
		} else {
			announcementBackup = JSON.stringify(announcements, null, 2);
			announcements = value;
			announcementVersion = announcementBaselineVersion = version;
			announcementBaseline = announcementSource(value);
		}
		clearConfigConflict(module);
		message =
			"已采用仓库版本作为编辑基础，原本机内容保留在下方；请手动合并后保存。";
	} catch (error) {
		message = errorMessage(error);
	}
}
async function switchPage(id: string) {
	active = resolveAdminPage("#" + id);
	mobileOpen = false;
	accountOpen = false;
	themeOpen = false;
	if (isContentModule(active)) recordsModule = active;
	await tick();
	history.replaceState(history.state, "", "#" + active);
	window.scrollTo({ top: 0, behavior: "instant" });
}
$effect(() => {
	if (!settingsReady) return;
	const buffer: ConfigBuffer = {};
	if ((sidebarDirty || sidebarBackup) && sidebar)
		buffer.sidebar = {
			value: sidebar,
			version: sidebarVersion,
			previousLocal: sidebarBackup,
		};
	if ((announcementDirty || announcementBackup) && announcements)
		buffer.announcements = {
			value: announcements,
			version: announcementVersion,
			previousLocal: announcementBackup,
		};
	try {
		const needed = Object.keys(buffer).length > 0;
		const result = needed
			? saveLocalBuffer(localStorage, settingsBufferKey, buffer)
			: removeLocalBuffer(localStorage, settingsBufferKey);
		bufferMessage = result.ok ? (needed ? "已暂存到本机" : "") : result.error;
	} catch {
		bufferMessage =
			"本机暂存失败，当前编辑仍保留在内存；请保留页面或复制内容。";
	}
});
onMount(() => {
	try {
		settingsBufferKey = getTabBufferKey(sessionStorage, "settings");
	} catch {
		bufferMessage = "浏览器存储不可用，当前编辑仍保留在内存。";
	}
	try {
		const stored = localStorage.getItem("firefly-admin-theme");
		if (stored === "dark" || stored === "light" || stored === "system")
			theme = stored;
		sessionStorage.removeItem("firefly-writing-auth");
	} catch {
		/* Theme and editor memory remain available. */
	}
	applyTheme(theme, false);
	const abort = new AbortController();
	const media = matchMedia("(prefers-color-scheme: dark)");
	const reduced = matchMedia("(prefers-reduced-motion: reduce)");
	const hardware = navigator as Navigator & { deviceMemory?: number };
	const limited =
		(typeof hardware.deviceMemory === "number" &&
			hardware.deviceMemory > 0 &&
			hardware.deviceMemory <= 4) ||
		(hardware.hardwareConcurrency > 0 && hardware.hardwareConcurrency <= 4);
	const updateMotion = () => {
		motionAllowed = !reduced.matches && !limited;
		pageVisible = !document.hidden;
	};
	updateMotion();
	media.addEventListener(
		"change",
		() => {
			if (theme === "system") applyTheme("system", false);
		},
		{ signal: abort.signal },
	);
	reduced.addEventListener("change", updateMotion, { signal: abort.signal });
	document.addEventListener("visibilitychange", updateMotion, {
		signal: abort.signal,
	});
	document.addEventListener(
		"pointerdown",
		(event) => {
			if (
				!(event.target instanceof Element) ||
				!event.target.closest(".admin-account")
			) {
				accountOpen = false;
				themeOpen = false;
			}
		},
		{ signal: abort.signal },
	);
	document.addEventListener(
		"keydown",
		(event) => {
			if (event.key === "Escape") {
				accountOpen = false;
				themeOpen = false;
				mobileOpen = false;
			}
		},
		{ signal: abort.signal },
	);
	window.addEventListener(
		"hashchange",
		() => {
			if (workspaceMounted) void switchPage(resolveAdminPage(location.hash));
		},
		{ signal: abort.signal },
	);
	window.addEventListener(
		"beforeunload",
		(event) => {
			if (settingsDirty || hasRecovery) {
				event.preventDefault();
				event.returnValue = "";
			}
		},
		{ signal: abort.signal },
	);
	void (async () => {
		loading = true;
		try {
			const session = await api("/api/writing/session/");
			preview = session.preview === true;
			authenticated = true;
			active = resolveAdminPage(location.hash);
			if (isContentModule(active)) recordsModule = active;
			await load(true);
			workspaceMounted = true;
			await switchPage(active);
		} catch (error) {
			if (!(error instanceof ApiError && error.status === 401))
				message = errorMessage(error);
		} finally {
			loading = false;
		}
	})();
	return () => abort.abort();
});
</script>

{#if !authenticated}
  <main class="admin-login" class:reauth={workspaceMounted}>
    <div class="admin-login-card">
      <img class="admin-login-avatar" src={avatarUrl} alt="" width="48" height="48" />
      <p class="admin-eyebrow">PERSONAL WORKSPACE</p>
      <h1>{workspaceMounted ? "重新登录" : "博客管理"}</h1>
      <p class="admin-muted">{workspaceMounted ? "编辑内容仍在，请登录后继续。" : "写下想法，有序记录，持续更新。"}</p>
      <form onsubmit={event => { event.preventDefault(); void login(); }}>
        <label>管理密码<input type="password" bind:value={password} autocomplete="current-password" placeholder="输入管理密码" /></label>
        <button class="admin-primary" disabled={loading || !password}>{loading ? "验证中…" : "进入工作台"}</button>
      </form>
      {#if message}<p class="admin-error" role="alert">{message}</p>{/if}
    </div>
  </main>
{/if}

{#if workspaceMounted}
  <div class="admin-shell" inert={!authenticated} aria-hidden={!authenticated ? "true" : undefined}>
    <aside class:open={mobileOpen} class="admin-sidebar">
      <a class="admin-brand" href={siteUrl} data-no-swup aria-label="返回博客">
        <span class="admin-brand-mark"><LayoutDashboard size={22} strokeWidth={1.6} /></span>
        <span><strong>博客管理</strong><small>PERSONAL WORKSPACE</small></span>
      </a>
      <nav aria-label="后台导航">
        {#each adminNavigationGroups as group}
          <div class="admin-nav-group">
            <p>{group.label}</p>
            {#each group.items as item}
              {@const NavIcon = icons[item.id as keyof typeof icons] || FileText}
              <button class:active={active === item.id} aria-current={active === item.id ? "page" : undefined} onclick={() => void switchPage(item.id)}>
                <NavIcon size={18} strokeWidth={1.7} /><span>{item.label}</span>
              </button>
            {/each}
          </div>
        {/each}
      </nav>
      <div class="admin-account">
        <div class="admin-account-line">
          {#if preview}
            <div class="admin-account-main admin-account-static"><img class="admin-avatar" src={avatarUrl} alt="" width="34" height="34" /><span><strong>管理员</strong><small>个人工作区</small></span></div>
          {:else}
            <button class="admin-account-main" aria-expanded={accountOpen} aria-controls="admin-account-menu" onclick={toggleAccount}>
              <img class="admin-avatar" src={avatarUrl} alt="" width="34" height="34" /><span><strong>管理员</strong><small>个人工作区</small></span><ChevronDown size={14} class="admin-chevron" />
            </button>
          {/if}
          <button class="admin-theme-button" aria-label="切换主题" aria-expanded={themeOpen} aria-controls="admin-theme-menu" onclick={toggleTheme}><ThemeIcon size={17} /></button>
        </div>
        {#if accountOpen && !preview}<div id="admin-account-menu" class="admin-account-menu"><button disabled={loading} onclick={() => void logout()}><LogOut size={15} />退出登录</button></div>{/if}
        {#if themeOpen}
          <div id="admin-theme-menu" class="admin-account-menu" role="group" aria-label="主题选项">
            <button aria-pressed={theme === "light"} onclick={() => chooseTheme("light")}><Sun size={15} />浅色模式</button>
            <button aria-pressed={theme === "dark"} onclick={() => chooseTheme("dark")}><Moon size={15} />深色模式</button>
            <button aria-pressed={theme === "system"} onclick={() => chooseTheme("system")}><Monitor size={15} />跟随系统</button>
          </div>
        {/if}
      </div>
    </aside>
    {#if mobileOpen}<button class="admin-backdrop" aria-label="关闭菜单" onclick={() => mobileOpen = false}></button>{/if}
    <section class="admin-main">
      <header class="admin-topbar" class:motion={motionAllowed} class:paused={!pageVisible}>
        <div class="admin-sky" aria-hidden="true"><div class="admin-stars"></div><div class="admin-aurora admin-aurora-one"></div><div class="admin-aurora admin-aurora-two"></div></div>
        <button class="admin-menu-button" aria-label="打开导航" onclick={() => mobileOpen = true}><Menu size={21} /></button>
      </header>
      <div class="admin-content">
        {#if preview}<p class="admin-preview-note" role="status">本地预览 · 已跳过密码，可浏览和试填；保存需正常登录。</p>{/if}
        <section id="admin-dashboard" hidden={active !== "dashboard"} class="admin-section">
          <div class="admin-heading">
            <div><p class="admin-eyebrow">OVERVIEW</p><h1>工作台</h1><p class="admin-muted">写下想法，有序记录，持续更新。</p></div>
            <div class="admin-actions"><button class="admin-secondary" disabled={loading} onclick={() => void load()}><RefreshCw size={15} />{loading ? "正在读取…" : "重新读取数据"}</button><button class="admin-primary" onclick={() => void switchPage("writing")}><Plus size={16} />新建文章</button></div>
          </div>
          <p class="admin-hint admin-refresh-hint">重新读取文章、规划摘要和配置；不会发布内容或清除正文编辑。</p>
          <div class="admin-stats" aria-busy={loading}><article><span>文章总数</span><strong>{dashboardReady ? posts.length : "—"}</strong><small>包含已发布与草稿</small></article><article><span>草稿</span><strong>{dashboardReady ? posts.filter(post => post.draft).length : "—"}</strong><small>等待继续编辑</small></article><article><span>规划记录</span><strong>{dashboardReady ? routines.length : "—"}</strong><small>来自规划记录</small></article></div>
          <div class="admin-grid">
            <div class="admin-panel admin-recent">
              <div class="admin-panel-heading"><h2>文章概览</h2><button class="admin-link" onclick={() => void switchPage("writing")}>查看全部 →</button></div>
              {#if posts.length}
                <div class="admin-table-head"><span>标题</span><span>类型</span><span>状态</span><span>发布时间</span></div>
                {#each posts.slice(0, 6) as post}<button class="admin-row" onclick={() => void switchPage("writing")}><span>{post.title || post.file}</span><span>文章</span><span class:published={!post.draft} class="admin-status">{post.draft ? "草稿" : "已发布"}</span><span>{post.published || "—"}</span><b>•••</b></button>{/each}
              {:else}<div class="admin-empty">{dashboardReady ? "还没有文章，点击新建文章开始写作。" : loading ? "正在读取文章…" : "暂未读取文章，请重新读取数据。"}</div>{/if}
            </div>
            <aside class="admin-side-stack">
              <div class="admin-panel">
                <div class="admin-panel-heading"><h2>组件快捷设置</h2><span class="admin-hint">手动保存后生效</span></div>
                {#if sidebar}
                  <fieldset disabled={loading}>
                    <label class="admin-setting-row"><span>左侧栏</span><input type="checkbox" checked={sidebar.leftComponents.some(item => item.enable)} onchange={event => setSideEnabled("leftComponents", event.currentTarget.checked)} /></label>
                    <label class="admin-setting-row"><span>右侧栏</span><input type="checkbox" checked={sidebar.rightComponents.some(item => item.enable)} onchange={event => setSideEnabled("rightComponents", event.currentTarget.checked)} /></label>
                    {#each sidebar.leftComponents.slice(0, 3) as item, i}<label class="admin-setting-row nested"><span>{componentLabels[String(item.type)] || String(item.type)}</span><input type="checkbox" checked={Boolean(item.enable)} onchange={event => setSidebarValue("leftComponents", i, event.currentTarget.checked)} /></label>{/each}
                  </fieldset>
                  {#if sidebarDirty}<span class="admin-unsaved">未保存</span><div class="admin-actions compact"><button class="admin-secondary small" disabled={loading} onclick={() => cancelConfig("sidebar")}>取消修改</button><button class="admin-primary small" disabled={loading} onclick={() => void saveConfig("sidebar")}>保存设置</button></div>{/if}
                  <button class="admin-link" onclick={() => void switchPage("settings")}>进入组件管理 →</button>
                {/if}
              </div>
              <div class="admin-panel">
                <div class="admin-panel-heading"><h2>当前公告</h2><span class="admin-badge">{currentAnnouncement?.tag || "—"}</span></div>
                {#if announcementDirty}<small class="admin-unsaved">未保存预览</small>{/if}
                <h3>{currentAnnouncement?.title || "暂无启用公告"}</h3><p class="admin-muted">{currentAnnouncement?.content || "可以在公告管理中添加一条公告。"}</p>
                <button class="admin-secondary" onclick={() => void switchPage("announcements")}>编辑公告</button>
              </div>
            </aside>
          </div>
          <div class="admin-panel admin-resume"><div><p class="admin-eyebrow">CONTINUE</p><h2>{posts.find(post => post.draft)?.title || "开始新的写作"}</h2><p class="admin-muted">{posts.find(post => post.draft)?.description || "记录今天的想法，继续未完成的内容。"}</p></div><button class="admin-secondary" onclick={() => void switchPage("writing")}>继续编辑 →</button></div>
        </section>

        <section id="admin-writing" hidden={active !== "writing"} class="admin-section admin-tools">
          <div class="admin-section-title"><div><p class="admin-eyebrow">CONTENT</p><h2>文章管理</h2></div><button class="admin-link" onclick={() => void switchPage("dashboard")}>返回工作台</button></div>
          <WritingStudio {authenticated} embedded={true} isActive={active === "writing" && authenticated} onsessionexpired={sessionExpired} />
        </section>
        <section id="admin-records" hidden={!isContentModule(active)} class="admin-section admin-tools">
          <div class="admin-section-title"><div><p class="admin-eyebrow">CONTENT</p><h2>{contentModules.find(item => item.id === recordsModule)?.label || "内容管理"}</h2></div></div>
          <ContentManager {authenticated} embedded={true} isActive={isContentModule(active) && authenticated} selectedModule={recordsModule} onsessionexpired={sessionExpired} />
        </section>
        <section id="admin-settings" hidden={active !== "settings"} class="admin-section admin-tools">
          <div class="admin-section-title">
            <div><p class="admin-eyebrow">LAYOUT</p><h2>组件管理</h2><p class="admin-muted">设置左右侧栏中的组件，修改后统一保存。</p></div>
            <div class="admin-actions">
              {#if sidebarDirty}<span class="admin-unsaved">未保存</span>{/if}
              <button class="admin-secondary" disabled={loading || (!sidebarDirty && !sidebarBackup)} onclick={() => cancelConfig("sidebar")}>取消修改</button>
              <button class="admin-primary" disabled={!sidebarDirty || loading} onclick={() => void saveConfig("sidebar")}>保存设置</button>
            </div>
          </div>
          <div class="admin-settings-grid">
            {#each [["leftComponents", "左侧栏"], ["rightComponents", "右侧栏"]] as group}
              <div class="admin-panel"><h3>{group[1]}</h3>
                {#if sidebar}<fieldset disabled={loading}>
                  {#each sidebar[group[0] as "leftComponents" | "rightComponents"] as item, i}
                    <div class="admin-component-row"><span class="admin-drag">⋮⋮</span><span>{componentLabels[String(item.type)] || String(item.type)}<small>{item.position === "top" ? "顶部" : "吸附"}</small></span><button class="admin-order-button" aria-label="上移" onclick={() => moveComponent(group[0] as "leftComponents" | "rightComponents", i, -1)}><ArrowUp size={13} /></button><button class="admin-order-button" aria-label="下移" onclick={() => moveComponent(group[0] as "leftComponents" | "rightComponents", i, 1)}><ArrowDown size={13} /></button><input type="checkbox" checked={Boolean(item.enable)} aria-label={"启用" + (componentLabels[String(item.type)] || String(item.type))} onchange={event => setSidebarValue(group[0] as "leftComponents" | "rightComponents", i, event.currentTarget.checked)} /></div>
                  {/each}
                </fieldset>{/if}
              </div>
            {/each}
          </div>
        </section>

        <section id="admin-announcements" hidden={active !== "announcements"} class="admin-section admin-tools">
          <div class="admin-section-title">
            <div><p class="admin-eyebrow">BROADCAST</p><h2>公告管理</h2><p class="admin-muted">新增、排序和启停在保存并构建后更新公开展示。</p></div>
            <div class="admin-actions">
              {#if announcementDirty}<span class="admin-unsaved">未保存</span>{/if}
              <button class="admin-secondary" disabled={loading || !announcements} onclick={() => void addAnnouncement()}><Plus size={15} />新增公告</button>
              <button class="admin-secondary" disabled={loading || (!announcementDirty && !announcementBackup)} onclick={() => cancelConfig("announcements")}>取消修改</button>
              <button class="admin-primary" disabled={!announcementDirty || loading} onclick={() => void saveConfig("announcements")}>保存公告</button>
            </div>
          </div>
          <div class="admin-preview-tabs" role="group" aria-label="公告工作区"><button aria-pressed={announcementView === "edit"} onclick={() => announcementView = "edit"}>编辑</button><button aria-pressed={announcementView === "preview"} onclick={() => announcementView = "preview"}>预览</button></div>
          {#if announcements}
            <div class="admin-announcement-workspace" class:show-preview={announcementView === "preview"}>
              <div class="admin-panel admin-announcement-editor">
                <fieldset disabled={loading}>
                  <label>公告栏标题<input bind:value={announcements.title} /></label>
                  <p class="admin-field-help">显示在首页铃铛弹窗、侧栏卡片和手机公告面板的顶部；留空使用“公告”。</p>
                  <label class="admin-check"><input type="checkbox" bind:checked={announcements.closable} />允许访客关闭侧栏公告卡片</label>
                  <p class="admin-field-help">只对当前页面生效。弹窗和手机面板可独立收起，地区问候不属于公告。</p>
                  {#each orderedAnnouncements as item, i (itemKey(item))}
                    <article class="admin-announcement-item" id={"announcement-item-" + itemKey(item)}>
                      <div class="admin-item-heading"><h3>{item.title || "新公告"}</h3><div class="admin-item-actions">
                        <label class="admin-check"><input type="checkbox" checked={item.enabled !== false} onchange={event => item.enabled = event.currentTarget.checked} />启用</label>
                        <button class="admin-order-button" disabled={i === 0} aria-label="上移" onclick={() => moveAnnouncement(item, -1)}><ArrowUp size={14} /></button>
                        <button class="admin-order-button" disabled={i === orderedAnnouncements.length - 1} aria-label="下移" onclick={() => moveAnnouncement(item, 1)}><ArrowDown size={14} /></button>
                        <button class="admin-delete" onclick={() => removeAnnouncement(item)}>删除</button>
                      </div></div>
                      <div class="admin-fields">
                        <label>标签<input bind:value={item.tag} /></label><label>标题<input data-announcement-title bind:value={item.title} /></label>
                        <label>日期<input type="date" bind:value={item.time} /></label><label>链接<input bind:value={item.link} placeholder="/about/ 或 https://…" /></label>
                      </div>
                      <label>正文<textarea rows="3" bind:value={item.content}></textarea></label>
                    </article>
                  {:else}<div class="admin-empty">暂无公告，点击“新增公告”开始编写。</div>{/each}
                </fieldset>
              </div>
              <aside class="admin-panel admin-announcement-preview" aria-label="公告预览">
                <p class="admin-eyebrow">PREVIEW</p><h3><Bell size={17} />{announcementTitle(announcements)}</h3><p class="admin-field-help">仅预览启用的公告，保存前不会更新网站。</p>
                {#each publicAnnouncements as item}
                  <article class="admin-preview-card"><div><span class="admin-badge">{item.tag || "公告"}</span><strong>{item.title || "未填写标题"}</strong></div><time>{item.time}</time><p>{item.content || "未填写正文"}</p>{#if item.link?.trim()}<span class="admin-hint">{item.link}</span>{/if}</article>
                {:else}<p class="admin-empty">暂无启用公告，公开公告入口将隐藏。</p>{/each}
              </aside>
            </div>
          {/if}
        </section>

        {#if bufferMessage && ["settings", "announcements", "dashboard"].includes(active)}<p class="admin-buffer-note" role="status">{bufferMessage}</p>{/if}
        {#if (active === "settings" && sidebarBackup) || (active === "announcements" && announcementBackup)}
          <section class="admin-panel admin-backup"><h2>合并前的本机内容</h2><p class="admin-muted">只读备份，按需将修改重新应用到上方表单，再手动保存。</p><textarea class="admin-compare-source" readonly aria-label="合并前的本机内容" value={active === "settings" ? sidebarBackup : announcementBackup}></textarea></section>
        {/if}
        {#if comparison}
          <section id="admin-comparison" hidden={active !== (comparison.module === "sidebar" ? "settings" : "announcements")} class="admin-panel admin-comparison">
            <h2>配置版本比较</h2><div class="admin-settings-grid"><label>本机编辑<textarea class="admin-compare-source" readonly value={JSON.stringify(comparison.module === "sidebar" ? sidebar : announcements, null, 2)}></textarea></label><label>仓库版本<textarea class="admin-compare-source" readonly value={comparison.source}></textarea></label></div>
            <button class="admin-secondary" disabled={loading} onclick={acceptRepositoryConfig}>以仓库版本为基础合并</button><button class="admin-link" onclick={() => comparison = null}>保留本机编辑</button>
          </section>
        {/if}
        {#if message && authenticated}<div class="admin-toast" role="status">{message}{#if conflictModule}<button class="admin-link" disabled={loading} onclick={() => void compareConfig()}>读取仓库版本供比较</button>{/if}{#if commitUrl}<a href={commitUrl} target="_blank" rel="noopener noreferrer">查看提交记录 <ExternalLink size={13} /></a>{/if}</div>{/if}
      </div>
    </section>
  </div>
{/if}

<style>
  :global(#top-row), :global(.mobile-dock), :global(.floating-dock), :global(#main-grid-wrapper) { display:none!important }
  :global(body) { background:#101216;color:#eceff4;min-width:320px }
  :global(html:not(.dark) body) { background:#f5f7fa;color:#18212b }
  :global(html:not(.dark)) .admin-shell { --a-bg:#f5f7fa;--a-panel:#fff;--a-input:#fff;--a-sidebar:#edf1f6;--a-border:#dbe1e8;--a-text:#18212b;--a-muted:#647184;--a-accent:#4d8cc7;--a-selected:#dae8f7 }
  .admin-shell { --a-bg:#101216;--a-panel:#191c22;--a-input:#14171c;--a-sidebar:#12151a;--a-border:#2b3038;--a-text:#eceff4;--a-muted:#9aa4b2;--a-accent:#88bbee;--a-selected:#263d5b;display:flex;min-height:100vh;background:var(--a-bg);color:var(--a-text);font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif }
  .admin-shell[inert] { pointer-events:none }
  .admin-sidebar { width:232px;flex:0 0 232px;height:100vh;height:100dvh;box-sizing:border-box;position:sticky;top:0;z-index:20;background:var(--a-sidebar);border-right:1px solid var(--a-border);display:flex;flex-direction:column;padding:24px 14px 18px }
  .admin-brand { display:flex;align-items:center;gap:11px;padding:2px 7px 24px;flex-shrink:0;color:inherit;text-decoration:none }
  .admin-brand-mark { border:1px solid #7198bc;border-radius:11px;width:35px;height:35px;display:grid;place-items:center;color:var(--a-accent);flex-shrink:0 }
  .admin-brand strong { font-size:17px;display:block }
  .admin-brand small { display:block;font:9px ui-monospace,monospace;letter-spacing:.06em;color:var(--a-accent);margin-top:5px }
  .admin-sidebar nav { flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;padding-right:3px }
  .admin-nav-group { margin-bottom:18px }
  .admin-nav-group>p { font-size:10px;color:var(--a-muted);letter-spacing:.12em;margin:0 11px 7px }
  .admin-sidebar nav button { border:0;background:transparent;color:var(--a-muted);display:flex;align-items:center;gap:12px;padding:10px 12px;margin-bottom:3px;border-radius:8px;width:100%;text-align:left;font-size:13px;cursor:pointer;transition:background .18s,color .18s }
  .admin-sidebar nav button :global(svg) { color:var(--a-accent);flex-shrink:0 }
  .admin-sidebar nav button:hover,.admin-sidebar nav button.active { background:var(--a-selected);color:var(--a-text) }
  .admin-account { border-top:1px solid var(--a-border);padding-top:14px;flex-shrink:0;position:relative;margin-top:12px }
  .admin-account-line { display:flex;align-items:center;gap:5px }
  .admin-account-main { flex:1;min-width:0;border:0;background:transparent;color:var(--a-text);display:flex;align-items:center;gap:10px;text-align:left;padding:5px;cursor:pointer }
  .admin-account-static { cursor:default }
  .admin-avatar { width:34px;height:34px;object-fit:cover;border-radius:50%;border:1px solid var(--a-border);flex-shrink:0 }
  .admin-account-main strong { font-size:13px;display:block }.admin-account-main small { font-size:10px;display:block;margin-top:2px;color:var(--a-muted) }
  .admin-account-main :global(.admin-chevron) { margin-left:auto;color:var(--a-muted);flex-shrink:0 }
  .admin-theme-button { width:32px;height:32px;border:1px solid var(--a-border);border-radius:8px;background:transparent;color:var(--a-muted);cursor:pointer;display:grid;place-items:center;flex-shrink:0 }
  .admin-theme-button:hover { border-color:var(--a-accent);color:var(--a-accent) }
  .admin-account-menu { position:absolute;bottom:57px;left:0;right:0;background:var(--a-panel);border:1px solid var(--a-border);border-radius:9px;padding:5px;box-shadow:0 12px 30px #0004;z-index:30 }
  .admin-account-menu button { display:flex;align-items:center;gap:9px;width:100%;border:0;background:transparent;color:var(--a-text);padding:10px;text-align:left;border-radius:6px;cursor:pointer;font-size:13px }
  .admin-account-menu button:hover,.admin-account-menu button[aria-pressed=true] { background:var(--a-selected);color:var(--a-accent) }
  .admin-main { flex:1;min-width:0;overflow-anchor:none }
  .admin-topbar { height:66px;position:sticky;top:0;border-bottom:1px solid var(--a-border);display:flex;align-items:center;padding:0 24px;background:var(--a-bg);z-index:10;isolation:isolate }
  .admin-sky { position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:-1 }
  .admin-stars { position:absolute;inset:0;opacity:.55;background-image:radial-gradient(circle at 5% 23%,var(--a-accent) 1px,transparent 1.7px),radial-gradient(circle at 15% 65%,var(--a-accent) .8px,transparent 1.3px),radial-gradient(circle at 31% 18%,var(--a-accent) .7px,transparent 1.3px),radial-gradient(circle at 45% 74%,var(--a-accent) 1px,transparent 1.8px),radial-gradient(circle at 58% 39%,var(--a-accent) .8px,transparent 1.5px),radial-gradient(circle at 74% 16%,var(--a-accent) 1px,transparent 1.6px),radial-gradient(circle at 86% 66%,var(--a-accent) .7px,transparent 1.3px),radial-gradient(circle at 96% 30%,var(--a-accent) .9px,transparent 1.5px) }
  .admin-aurora { position:absolute;inset:-75% -12%;opacity:.22;background:radial-gradient(ellipse at 36% 60%,#58cdd055 0,transparent 49%);transform:rotate(-7deg);pointer-events:none }
  .admin-aurora-two { opacity:.2;background:radial-gradient(ellipse at 70% 40%,#ac85df66 0,transparent 48%);transform:rotate(6deg) }
  .motion .admin-aurora-one { animation:aurora-drift 20s ease-in-out infinite alternate }.motion .admin-aurora-two { animation:aurora-drift 24s ease-in-out infinite alternate-reverse }
  .paused .admin-aurora { animation-play-state:paused }
  @keyframes aurora-drift { from { transform:translateX(-2%) rotate(-6deg);opacity:.16 } to { transform:translateX(3%) rotate(4deg);opacity:.28 } }
  .admin-menu-button { display:none;border:1px solid var(--a-border);border-radius:8px;background:var(--a-panel);color:var(--a-text);width:35px;height:35px;cursor:pointer;align-items:center;justify-content:center }
  .admin-content { max-width:1440px;margin:auto;padding:32px 32px 64px }
  .admin-section[hidden],#admin-comparison[hidden] { display:none!important }
  .admin-heading,.admin-section-title,.admin-panel-heading { display:flex;align-items:flex-start;justify-content:space-between;gap:18px }
  .admin-section-title { margin-bottom:20px;align-items:center }.admin-panel-heading { align-items:center }
  .admin-heading h1 { font-size:30px;margin:0 0 6px;letter-spacing:-.03em }
  .admin-section-title h2,.admin-panel h2 { font-size:19px;margin:0 }
  .admin-eyebrow { color:var(--a-accent);font:10px ui-monospace,monospace;letter-spacing:.18em;margin:0 0 8px }
  .admin-muted { color:var(--a-muted);font-size:13px;line-height:1.7;margin:4px 0 }
  .admin-actions,.admin-item-actions { display:flex;align-items:center;gap:8px;flex-wrap:wrap }.admin-actions.compact { margin:8px 0 12px }
  .admin-primary,.admin-secondary { display:inline-flex;align-items:center;justify-content:center;gap:7px;border-radius:8px;padding:10px 13px;font-size:12px;cursor:pointer;transition:background .18s,border-color .18s }
  .admin-primary { border:1px solid #a9d1f6;background:#88bbee;color:#101216;font-weight:650 }.admin-primary:hover { background:#b0d8fa }
  .admin-secondary { border:1px solid var(--a-border);background:transparent;color:var(--a-text) }.admin-secondary:hover { border-color:var(--a-accent) }
  .small { padding:7px 10px }
  button:disabled { opacity:.45;cursor:not-allowed }
  button:focus-visible,a:focus-visible { outline:2px solid var(--a-accent);outline-offset:3px }
  .admin-link { border:0;background:transparent;color:var(--a-accent);cursor:pointer;padding:0;font-size:12px }
  .admin-hint { font-size:10px;color:var(--a-muted) }.admin-refresh-hint { margin:12px 0 0 }
  .admin-stats { display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:24px 0 20px }
  .admin-stats article,.admin-panel { background:var(--a-panel);border:1px solid var(--a-border);border-radius:12px }
  .admin-stats article { padding:17px 20px }.admin-stats span,.admin-stats small { display:block;color:var(--a-muted);font-size:12px }.admin-stats strong { display:block;font-size:30px;margin:7px 0 }
  .admin-grid { display:grid;grid-template-columns:minmax(0,1.7fr) minmax(270px,.85fr);gap:16px }.admin-panel { padding:22px }
  .admin-recent { padding-bottom:9px }.admin-table-head,.admin-row { display:grid;grid-template-columns:minmax(150px,1.8fr) .65fr .8fr 1fr 22px;align-items:center;gap:10px }
  .admin-table-head { margin-top:20px;padding:11px 10px;background:var(--a-bg);color:var(--a-muted);font-size:11px }
  .admin-row { width:100%;border:0;border-bottom:1px solid var(--a-border);background:transparent;color:var(--a-text);text-align:left;padding:15px 10px;cursor:pointer;font-size:12px }.admin-row:hover { background:var(--a-bg) }
  .admin-row>span:nth-child(2),.admin-row>span:nth-child(4),.admin-row b { color:var(--a-muted);font-weight:400 }.admin-status.published { color:#60b985 }
  .admin-side-stack { display:grid;gap:16px }.admin-panel h3 { font-size:15px;margin:14px 0 8px }
  fieldset { border:0;padding:0;margin:0;min-width:0 }
  .admin-setting-row,.admin-component-row { display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 0;border-bottom:1px solid var(--a-border);font-size:12px }
  .admin-setting-row.nested { padding-left:16px }
  input[type=checkbox] { accent-color:var(--a-accent);width:16px;height:16px;flex-shrink:0 }
  .admin-badge { font-size:10px;border:1px solid var(--a-border);border-radius:99px;padding:4px 8px;color:var(--a-accent);display:inline-block }
  .admin-resume { margin-top:16px;display:flex;align-items:center;justify-content:space-between;gap:20px }
  .admin-empty { padding:35px 10px;text-align:center;color:var(--a-muted);font-size:12px;line-height:1.7 }
  .admin-unsaved { color:#bf8f39;font-size:11px }.admin-settings-grid { display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px }
  .admin-component-row { justify-content:flex-start }.admin-component-row>span:nth-child(2) { flex:1 }.admin-component-row small { display:block;color:var(--a-muted);font-size:10px;margin-top:3px }
  .admin-drag { color:var(--a-muted) }.admin-order-button { border:1px solid var(--a-border);background:transparent;color:var(--a-muted);border-radius:6px;width:27px;height:27px;display:inline-grid;place-items:center;cursor:pointer }
  .admin-order-button:hover { color:var(--a-accent);border-color:var(--a-accent) }
  .admin-announcement-workspace { display:grid;grid-template-columns:minmax(0,1.8fr) minmax(240px,.8fr);gap:18px;align-items:start }
  .admin-announcement-editor label { display:block;font-size:12px;color:var(--a-muted);margin-bottom:14px }
  .admin-announcement-editor input,.admin-announcement-editor textarea,.admin-login input { display:block;width:100%;margin-top:7px;padding:10px 12px;border:1px solid var(--a-border,#2b3038);border-radius:8px;background:var(--a-input,#14171c);color:var(--a-text,#eceff4);outline:none;box-sizing:border-box;font:inherit }
  .admin-announcement-editor input:focus,.admin-announcement-editor textarea:focus,.admin-login input:focus { border-color:var(--a-accent,#88bbee) }
  .admin-check { display:flex!important;align-items:center;gap:8px }.admin-check input { display:inline!important;width:16px!important;margin:0!important }
  .admin-field-help { font-size:11px;color:var(--a-muted);line-height:1.7;margin:-7px 0 20px }
  .admin-announcement-item { border-top:1px solid var(--a-border);padding-top:18px;margin-top:18px }
  .admin-item-heading { display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px }.admin-item-heading h3 { margin:0;font-size:13px;overflow-wrap:anywhere }
  .admin-item-actions { flex-shrink:0 }.admin-item-actions .admin-check { margin:0 }.admin-delete { color:#d59090;background:transparent;border:0;font-size:11px;padding:5px;cursor:pointer }
  .admin-fields { display:grid;grid-template-columns:1fr 2fr;gap:10px }.admin-fields label { min-width:0 }
  .admin-announcement-preview { position:sticky;top:86px }.admin-announcement-preview>h3 { display:flex;align-items:center;gap:9px;font-size:18px;margin:0 0 18px }
  .admin-preview-card { border:1px solid var(--a-border);border-radius:9px;padding:15px;margin-top:12px }
  .admin-preview-card>div { display:flex;align-items:center;gap:8px;flex-wrap:wrap }.admin-preview-card strong { font-size:12px }.admin-preview-card time { font:10px ui-monospace,monospace;color:var(--a-muted);display:block;margin-top:8px }
  .admin-preview-card p { white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;line-height:1.75;margin:10px 0 }.admin-preview-card .admin-hint { overflow-wrap:anywhere }
  .admin-preview-tabs { display:none;gap:6px;margin-bottom:14px }.admin-preview-tabs button { border:1px solid var(--a-border);background:transparent;color:var(--a-muted);border-radius:8px;padding:8px 20px;font-size:12px;cursor:pointer }.admin-preview-tabs button[aria-pressed=true] { background:var(--a-selected);color:var(--a-text) }
  .admin-preview-note,.admin-buffer-note { color:var(--a-muted);font-size:12px;line-height:1.7 }.admin-preview-note { padding:12px 16px;background:var(--a-panel);border:1px solid var(--a-border);border-radius:8px;margin:0 0 24px }.admin-buffer-note { margin-top:18px }
  .admin-comparison,.admin-backup { margin-top:20px }.admin-comparison .admin-link { margin-left:12px }
  .admin-compare-source { width:100%;min-height:230px;margin:12px 0;padding:12px;border:1px solid var(--a-border);border-radius:8px;background:var(--a-bg);color:var(--a-text);font:11px ui-monospace,monospace;resize:vertical }
  .admin-toast { position:fixed;right:22px;bottom:20px;max-width:min(420px,calc(100vw - 40px));z-index:35;border:1px solid var(--a-border);background:var(--a-panel);color:var(--a-text);padding:13px 16px;border-radius:10px;font-size:12px;box-shadow:0 10px 35px #0003;line-height:1.7 }
  .admin-toast .admin-link,.admin-toast a { display:flex;align-items:center;gap:6px;margin-top:7px;color:var(--a-accent) }
  .admin-login { min-height:100vh;display:grid;place-items:center;background:#101216;color:#eceff4;padding:24px;box-sizing:border-box;font-family:system-ui,sans-serif }.admin-login.reauth { position:fixed;inset:0;z-index:100;background:#101216ee }
  .admin-login-card { width:min(380px,100%);background:#191c22;border:1px solid #2b3038;border-radius:14px;padding:32px;box-sizing:border-box }
  .admin-login-avatar { width:48px;height:48px;object-fit:cover;border-radius:50%;display:block;margin:0 auto 15px }.admin-login-card .admin-eyebrow { text-align:center;color:#88bbee }.admin-login-card h1 { text-align:center;margin:0;font-size:26px }.admin-login-card .admin-muted { text-align:center;color:#9aa4b2;margin:9px 0 24px }
  .admin-login-card form label { color:#9aa4b2;font-size:12px }.admin-login-card .admin-primary { width:100%;margin-top:17px }.admin-error { color:#f19b9b;font-size:12px;margin:15px 0 0;line-height:1.7 }
  .admin-backdrop { display:none }
  @media(min-width:1500px) { .admin-fields { grid-template-columns:1fr 2fr 1fr 1.5fr } }
  @media(max-width:1100px) { .admin-announcement-workspace { grid-template-columns:1fr }.admin-preview-tabs { display:flex }.admin-announcement-preview { display:none;position:static }.show-preview .admin-announcement-preview { display:block }.show-preview .admin-announcement-editor { display:none }.admin-grid { grid-template-columns:1fr }.admin-side-stack { grid-template-columns:repeat(2,minmax(0,1fr)) } }
  @media(max-width:980px) { .admin-sidebar { width:208px;flex-basis:208px }.admin-content { padding:28px 22px }.admin-heading { flex-wrap:wrap }.admin-topbar { padding:0 22px } }
  @media(max-width:680px) { .admin-sidebar { position:fixed;left:-250px;top:0;width:240px;flex-basis:240px;transition:left .18s }.admin-sidebar.open { left:0 }.admin-backdrop { display:block;position:fixed;inset:0;background:#0008;border:0;z-index:15 }.admin-menu-button { display:flex }.admin-topbar { height:58px;padding:0 16px }.admin-content { padding:24px 16px 50px }.admin-heading h1 { font-size:27px }.admin-actions { margin-top:10px }.admin-stats { grid-template-columns:1fr }.admin-table-head { display:none }.admin-row { grid-template-columns:minmax(0,1fr) auto }.admin-row>span:nth-child(2),.admin-row>span:nth-child(4) { display:none }.admin-row b { display:none }.admin-side-stack,.admin-settings-grid { grid-template-columns:1fr }.admin-section-title { display:block }.admin-resume { display:block }.admin-resume .admin-secondary { margin-top:16px }.admin-fields { grid-template-columns:1fr }.admin-panel { padding:18px }.admin-item-heading { flex-wrap:wrap }.admin-item-actions { margin-left:auto }.admin-toast { right:16px;bottom:16px }.admin-announcement-editor input { font-size:16px } }
  @media(prefers-reduced-motion:reduce) { .admin-aurora { animation:none!important }.admin-sidebar { transition:none } }
</style>
