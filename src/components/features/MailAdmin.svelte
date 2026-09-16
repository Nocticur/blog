<!--
  Admin information architecture and visual language are adapted from
  Lur1N77777/loven7-mail/apps/admin (MIT). This component is intentionally
  native Svelte so the blog remains the only front-end bundle.
-->
<script lang="ts">
import {
	Activity,
	Archive,
	ChevronDown,
	CircleHelp,
	Database,
	FileText,
	LayoutDashboard,
	LogOut,
	Mail,
	Menu,
	Moon,
	RefreshCw,
	Search,
	Settings,
	ShieldCheck,
	Sun,
	Trash2,
	UserRound,
	Users,
	X,
} from "lucide-svelte";
import { onMount } from "svelte";
import {
	adminRequest,
	bootstrapAdmin,
	getAdminSession,
	loginAdmin,
	logoutAdmin,
	MailAdminError,
	type MailAdminProfile,
	parseJsonObject,
} from "@/utils/mail-admin-api";
import { sanitizeMailHtml } from "@/utils/mail-html";

type ViewId =
	| "dashboard"
	| "addresses"
	| "users"
	| "inbox"
	| "sent"
	| "unknown"
	| "settings"
	| "maintenance";
type Phase = "loading" | "login" | "bootstrap" | "ready";
type RecordValue = Record<string, unknown>;
type ModuleState = "loading" | "ready" | "error";
type ModuleLoad = {
	state: ModuleState;
	data: RecordValue | null;
	stale: boolean;
	error: string;
};
type AdvancedSettingId =
	| "account"
	| "users"
	| "roles"
	| "oauth"
	| "webhook"
	| "mailWebhook"
	| "blacklist"
	| "aiExtract";

const advancedSettingOptions: Array<{
	id: AdvancedSettingId;
	label: string;
	endpoint: string;
}> = [
	{
		id: "account",
		label: "地址规则、黑名单与发信限制",
		endpoint: "/admin/account_settings",
	},
	{ id: "users", label: "用户注册与验证", endpoint: "/admin/user_settings" },
	{
		id: "roles",
		label: "角色与地址额度",
		endpoint: "/admin/role_address_config",
	},
	{ id: "oauth", label: "OAuth 登录", endpoint: "/admin/user_oauth2_settings" },
	{ id: "webhook", label: "管理 Webhook", endpoint: "/admin/webhook/settings" },
	{
		id: "mailWebhook",
		label: "邮件 Webhook",
		endpoint: "/admin/mail_webhook/settings",
	},
	{
		id: "blacklist",
		label: "IP 黑名单",
		endpoint: "/admin/ip_blacklist/settings",
	},
	{
		id: "aiExtract",
		label: "AI 邮件提取",
		endpoint: "/admin/ai_extract/settings",
	},
];

const navItems: Array<{ id: ViewId; label: string; group: string }> = [
	{ id: "dashboard", label: "系统概览", group: "工作台" },
	{ id: "addresses", label: "邮箱地址", group: "资源管理" },
	{ id: "users", label: "用户与角色", group: "资源管理" },
	{ id: "inbox", label: "全站收件箱", group: "邮件" },
	{ id: "sent", label: "发件箱", group: "邮件" },
	{ id: "unknown", label: "未知邮件", group: "邮件" },
	{ id: "settings", label: "系统设置", group: "配置" },
	{ id: "maintenance", label: "数据库维护", group: "配置" },
];

let phase = $state<Phase>("loading");
let profile = $state<MailAdminProfile | null>(null);
let activeView = $state<ViewId>("dashboard");
let sidebarOpen = $state(false);
let darkMode = $state(false);
let authError = $state("");
let notice = $state("");
let error = $state("");
let busy = $state(false);
let loginEmail = $state("");
let loginPassword = $state("");
let bootstrapSecret = $state("");
let bootstrapEmail = $state("");
let bootstrapPassword = $state("");
let bootstrapConfirm = $state("");
let rows = $state<RecordValue[]>([]);
let total = $state(0);
let search = $state("");
let searchInput = $state("");
let selected = $state<RecordValue | null>(null);
const dashboardModules = {
	statistics: { label: "系统统计", endpoint: "/admin/statistics" },
	configs: { label: "后端配置", endpoint: "/admin/worker/configs" },
} as const;
type DashboardModuleId = keyof typeof dashboardModules;

const emptyModuleLoad = (): ModuleLoad => ({
	state: "loading",
	data: null,
	stale: false,
	error: "",
});
let statisticsLoad = $state<ModuleLoad>(emptyModuleLoad());
let workerConfigLoad = $state<ModuleLoad>(emptyModuleLoad());
const moduleRequestIds: Record<DashboardModuleId, number> = {
	statistics: 0,
	configs: 0,
};
let dbStatus = $state<RecordValue>({});
let userSettings = $state<RecordValue>({});
let accountSettings = $state<RecordValue>({});
let businessSettings = $state<RecordValue>({});
let autoCleanup = $state<RecordValue>({});
let roleOptions = $state<RecordValue[]>([]);
let registrationEnabled = $state(false);
let userMailboxEnabled = $state(false);
let anonymousMailboxEnabled = $state(false);
let userDeleteEnabled = $state(false);
let cleanupType = $state("raw_mails");
let cleanupDays = $state("30");
let newAddressName = $state("");
let newAddressDomain = $state("");
let randomSubdomain = $state(false);
let newUserEmail = $state("");
let newUserPassword = $state("");
let selectedUserRole = $state("");
let bindAddressName = $state("");
let advancedKey = $state<AdvancedSettingId>("account");
let advancedText = $state("{}");
let advancedBusy = $state(false);

const numberValue = (value: unknown): number => {
	const number = Number(value);
	return Number.isFinite(number) ? number : 0;
};

const stringValue = (value: unknown, fallback = "—"): string =>
	typeof value === "string" && value.trim() ? value : fallback;

function recordValue(value: unknown): RecordValue {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as RecordValue)
		: {};
}

function bodyValue(value: unknown): RecordValue {
	const outer = recordValue(value);
	const body = recordValue(outer.body);
	return Object.keys(body).length > 0 ? body : outer;
}

function listValue(value: unknown): { results: RecordValue[]; count: number } {
	const body = bodyValue(value);
	const candidate = Array.isArray(body.results)
		? body.results
		: Array.isArray(body.data)
			? body.data
			: [];
	return {
		results: candidate.filter(
			(item): item is RecordValue =>
				!!item && typeof item === "object" && !Array.isArray(item),
		),
		count: numberValue(body.count ?? body.total ?? candidate.length),
	};
}

function readableError(
	value: unknown,
	fallback = "管理请求失败，请稍后再试。",
) {
	if (value instanceof MailAdminError) return value.message || fallback;
	return value instanceof Error && value.message ? value.message : fallback;
}

function idOf(row: RecordValue): string {
	return String(row.id ?? row.user_id ?? row.mail_id ?? "");
}

function displayUser(row: RecordValue): string {
	return stringValue(row.user_email ?? row.email ?? row.address ?? row.name);
}

function displaySubject(row: RecordValue): string {
	return stringValue(row.subject ?? row.title ?? row.mail_subject, "无主题");
}

function displayTime(row: RecordValue): string {
	const value = row.created_at ?? row.createdAt ?? row.updated_at ?? row.time;
	if (!value) return "—";
	const date = new Date(String(value));
	return Number.isNaN(date.valueOf())
		? String(value)
		: date.toLocaleString("zh-CN");
}

function moduleData(load: ModuleLoad): RecordValue | null {
	return load.state === "error" && !load.data ? null : load.data;
}

function statisticText(key: string, legacyKey: string): string {
	const data = moduleData(statisticsLoad);
	if (!data) return "—";
	const raw = data[key] ?? data[legacyKey];
	if (raw === undefined || raw === null) return "暂不支持";
	const number = Number(raw);
	return Number.isFinite(number) ? String(number) : "暂不支持";
}

function configState(key: string): "on" | "off" | "unknown" {
	const data = moduleData(workerConfigLoad);
	const raw = data ? data[key] : undefined;
	if (raw === true || raw === "true") return "on";
	if (raw === false || raw === "false") return "off";
	return "unknown";
}

function configText(key: string): string {
	const state = configState(key);
	return state === "on" ? "已开启" : state === "off" ? "已关闭" : "未知";
}

function anonymousConfigText(): string {
	const state = configState("DISABLE_ANONYMOUS_USER_CREATE_EMAIL");
	return state === "unknown" ? "未知" : state === "on" ? "已关闭" : "已开启";
}

function moduleChip(load: ModuleLoad): { tone: string; text: string } {
	if (load.state === "loading") return { tone: "loading", text: "读取中" };
	if (load.state === "ready") return { tone: "ok", text: "数据正常" };
	return { tone: "error", text: load.stale ? "刷新失败" : "加载失败" };
}

const backendStatus = $derived.by(() => {
	if (
		statisticsLoad.state === "loading" ||
		workerConfigLoad.state === "loading"
	) {
		return { tone: "loading", text: "后端数据读取中" };
	}
	if (statisticsLoad.state === "ready" && workerConfigLoad.state === "ready") {
		return { tone: "ok", text: "数据读取正常" };
	}
	if (statisticsLoad.state === "ready" || workerConfigLoad.state === "ready") {
		return { tone: "warn", text: "部分请求失败" };
	}
	return { tone: "error", text: "管理数据加载失败" };
});

async function sha256Hex(value: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(value),
	);
	return Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}

function setError(value: unknown, fallback?: string) {
	error = readableError(value, fallback);
	notice = "";
}

async function reconcileSession() {
	try {
		await getAdminSession();
	} catch {
		profile = null;
		phase = "login";
		authError = "登录已过期，请重新登录。";
	}
}

function getModuleLoad(id: DashboardModuleId): ModuleLoad {
	return id === "statistics" ? statisticsLoad : workerConfigLoad;
}

function setModuleLoad(id: DashboardModuleId, value: ModuleLoad) {
	if (id === "statistics") statisticsLoad = value;
	else workerConfigLoad = value;
}

async function fetchDashboardModule(
	id: DashboardModuleId,
	requestId: number,
): Promise<void> {
	const meta = dashboardModules[id];
	try {
		const response = await adminRequest(meta.endpoint, { module: meta.label });
		if (requestId !== moduleRequestIds[id]) return;
		const payload = parseJsonObject(response, meta.label);
		setModuleLoad(id, {
			state: "ready",
			data: bodyValue(payload),
			stale: false,
			error: "",
		});
	} catch (value) {
		if (requestId !== moduleRequestIds[id]) return;
		const message = readableError(value, `${meta.label}加载失败。`);
		if (value instanceof MailAdminError && value.status === 401) {
			void reconcileSession();
		}
		const previous = getModuleLoad(id);
		setModuleLoad(id, {
			state: "error",
			data: previous.data,
			stale: !!previous.data,
			error: message,
		});
	}
}

async function loadDashboard(): Promise<boolean> {
	const statisticsRequest = ++moduleRequestIds.statistics;
	const configsRequest = ++moduleRequestIds.configs;
	statisticsLoad = { ...statisticsLoad, state: "loading", error: "" };
	workerConfigLoad = { ...workerConfigLoad, state: "loading", error: "" };
	await Promise.all([
		fetchDashboardModule("statistics", statisticsRequest),
		fetchDashboardModule("configs", configsRequest),
	]);
	return statisticsLoad.state === "ready" && workerConfigLoad.state === "ready";
}

async function reloadDashboardModule(id: DashboardModuleId): Promise<void> {
	const requestId = ++moduleRequestIds[id];
	setModuleLoad(id, { ...getModuleLoad(id), state: "loading", error: "" });
	await fetchDashboardModule(id, requestId);
}

async function loadList(path: string) {
	const query = new URLSearchParams({ limit: "50", offset: "0" });
	if (search.trim()) query.set("query", search.trim());
	const response = await adminRequest(`${path}?${query.toString()}`);
	const list = listValue(response);
	rows = list.results;
	total = list.count;
	selected = null;
}

async function loadSettings() {
	const [
		userResponse,
		accountResponse,
		cleanupResponse,
		configResponse,
		businessResponse,
	] = await Promise.all([
		adminRequest("/admin/user_settings"),
		adminRequest("/admin/account_settings"),
		adminRequest("/admin/auto_cleanup"),
		adminRequest("/admin/worker/configs"),
		adminRequest("/admin/business_settings"),
	]);
	userSettings = bodyValue(userResponse);
	accountSettings = bodyValue(accountResponse);
	autoCleanup = bodyValue(cleanupResponse);
	workerConfigLoad = {
		state: "ready",
		data: bodyValue(configResponse),
		stale: false,
		error: "",
	};
	businessSettings = bodyValue(businessResponse);
	registrationEnabled = Boolean(
		businessSettings.allowRegistration ?? userSettings.enable,
	);
	userMailboxEnabled = Boolean(businessSettings.allowUserCreateEmail);
	anonymousMailboxEnabled = Boolean(businessSettings.allowAnonymousCreateEmail);
	userDeleteEnabled = Boolean(businessSettings.allowUserDeleteEmail);
	advancedText = JSON.stringify(accountSettings, null, 2);
}

function advancedSettingEndpoint(id: AdvancedSettingId) {
	return (
		advancedSettingOptions.find((item) => item.id === id)?.endpoint ??
		"/admin/account_settings"
	);
}

async function loadAdvancedSetting() {
	advancedBusy = true;
	error = "";
	try {
		const response = await adminRequest(advancedSettingEndpoint(advancedKey));
		advancedText = JSON.stringify(response, null, 2);
	} catch (value) {
		advancedText = "";
		setError(value, "该功能尚未配置或读取失败，请检查后端能力状态。");
	} finally {
		advancedBusy = false;
	}
}

async function saveAdvancedSetting() {
	let value: unknown;
	try {
		value = JSON.parse(advancedText);
	} catch {
		error = "高级设置必须是有效的 JSON。";
		return;
	}
	advancedBusy = true;
	try {
		await adminRequest(advancedSettingEndpoint(advancedKey), {
			method: "POST",
			body: value,
		});
		notice = "高级设置已保存，后端校验已通过。";
		await loadSettings();
	} catch (value) {
		setError(value, "保存失败，可能是依赖功能未配置或内容不符合后端规则。");
	} finally {
		advancedBusy = false;
	}
}

async function loadView(view: ViewId): Promise<boolean> {
	busy = true;
	error = "";
	let success = true;
	try {
		if (view === "dashboard") success = await loadDashboard();
		if (view === "addresses") await loadList("/admin/address");
		if (view === "users") {
			const [usersResponse, rolesResponse] = await Promise.all([
				adminRequest("/admin/users?limit=50&offset=0"),
				adminRequest("/admin/user_roles"),
			]);
			const list = listValue(usersResponse);
			rows = list.results;
			total = list.count;
			roleOptions = Array.isArray(rolesResponse)
				? rolesResponse.filter(
						(item): item is RecordValue =>
							!!item && typeof item === "object" && !Array.isArray(item),
					)
				: listValue(rolesResponse).results;
			selected = null;
		}
		if (view === "inbox") await loadList("/admin/mails");
		if (view === "sent") await loadList("/admin/sendbox");
		if (view === "unknown") await loadList("/admin/mails_unknow");
		if (view === "settings") await loadSettings();
		if (view === "maintenance") {
			const [configResponse, cleanupResponse, dbResponse] = await Promise.all([
				adminRequest("/admin/worker/configs"),
				adminRequest("/admin/auto_cleanup"),
				adminRequest("/admin/db_version"),
			]);
			workerConfigLoad = {
				state: "ready",
				data: bodyValue(configResponse),
				stale: false,
				error: "",
			};
			autoCleanup = bodyValue(cleanupResponse);
			dbStatus = bodyValue(dbResponse);
		}
		activeView = view;
		sidebarOpen = false;
		return success;
	} catch (value) {
		if (value instanceof MailAdminError && value.status === 401) {
			void reconcileSession();
		}
		setError(value);
		return false;
	} finally {
		busy = false;
	}
}

async function establishSession() {
	try {
		const response = await getAdminSession();
		profile = response.profile;
		phase = "ready";
		await loadView("dashboard");
	} catch (value) {
		phase = "login";
		if (value instanceof MailAdminError && value.status !== 401) {
			authError = readableError(value);
		}
	}
}

async function submitLogin() {
	authError = "";
	busy = true;
	try {
		const response = await loginAdmin(loginEmail, loginPassword);
		profile = response.profile;
		loginPassword = "";
		phase = "ready";
		await loadView("dashboard");
	} catch (value) {
		authError = readableError(value, "登录失败，请检查邮箱和密码。");
	} finally {
		busy = false;
	}
}

async function submitBootstrap() {
	authError = "";
	if (bootstrapPassword !== bootstrapConfirm) {
		authError = "两次输入的管理员密码不一致。";
		return;
	}
	busy = true;
	try {
		const response = await bootstrapAdmin(
			bootstrapSecret,
			bootstrapEmail,
			bootstrapPassword,
		);
		profile = response.profile;
		bootstrapSecret = "";
		bootstrapPassword = "";
		bootstrapConfirm = "";
		phase = "ready";
		await loadView("dashboard");
	} catch (value) {
		authError = readableError(value, "首次设置失败，可能已经存在管理员。");
	} finally {
		busy = false;
	}
}

async function signOut() {
	busy = true;
	try {
		await logoutAdmin();
	} catch {
		// The cookie is cleared by the server even when the network response is lost.
	} finally {
		profile = null;
		phase = "login";
		busy = false;
	}
}

async function refreshCurrent() {
	const success = await loadView(activeView);
	notice = success ? "已刷新当前数据。" : "";
}

async function searchCurrent() {
	search = searchInput;
	await loadView(activeView);
}

async function selectMail(row: RecordValue) {
	selected = row;
	if (!idOf(row)) return;
	try {
		selected = bodyValue(
			await adminRequest(`/admin/mails/${encodeURIComponent(idOf(row))}`),
		);
	} catch (value) {
		setError(value);
	}
}

async function deleteRow(row: RecordValue, endpoint: string, label: string) {
	const actualEndpoint =
		activeView === "sent" && endpoint === "/admin/mails"
			? "/admin/sendbox"
			: endpoint;
	const id = idOf(row);
	if (
		!id ||
		!window.confirm(`确定${label}“${displaySubject(row)}”吗？此操作不可撤销。`)
	)
		return;
	busy = true;
	try {
		await adminRequest(`${actualEndpoint}/${encodeURIComponent(id)}`, {
			method: "DELETE",
		});
		notice = `${label}完成。`;
		await loadView(activeView);
	} catch (value) {
		setError(value);
	} finally {
		busy = false;
	}
}

async function deleteMailRow(row: RecordValue) {
	await deleteRow(
		row,
		activeView === "sent" ? "/admin/sendbox" : "/admin/mails",
		"删除邮件",
	);
}

async function deleteAddress(row: RecordValue) {
	const id = idOf(row);
	if (
		!id ||
		!window.confirm(
			`确定删除地址“${displayUser(row)}”吗？关联邮件也可能无法继续接收。`,
		)
	)
		return;
	busy = true;
	try {
		await adminRequest(`/admin/delete_address/${encodeURIComponent(id)}`, {
			method: "DELETE",
		});
		notice = "地址已删除。";
		await loadView("addresses");
	} catch (value) {
		setError(value);
	} finally {
		busy = false;
	}
}

async function createAddress() {
	if (!newAddressName.trim()) {
		error = "请输入地址名称。";
		return;
	}
	busy = true;
	try {
		await adminRequest("/admin/new_address", {
			method: "POST",
			body: {
				name: newAddressName.trim(),
				domain: newAddressDomain.trim() || undefined,
				enableRandomSubdomain: randomSubdomain,
			},
		});
		newAddressName = "";
		newAddressDomain = "";
		randomSubdomain = false;
		notice = "邮箱地址已创建。";
		await loadView("addresses");
	} catch (value) {
		setError(value);
	} finally {
		busy = false;
	}
}

async function createUser() {
	if (!newUserEmail.trim() || newUserPassword.length < 6) {
		error = "请输入邮箱，并设置至少 6 位密码。";
		return;
	}
	busy = true;
	try {
		await adminRequest("/admin/users", {
			method: "POST",
			body: {
				email: newUserEmail.trim().toLowerCase(),
				password: await sha256Hex(newUserPassword),
			},
		});
		newUserEmail = "";
		newUserPassword = "";
		notice = "用户账号已创建。";
		await loadView("users");
	} catch (value) {
		setError(value);
	} finally {
		busy = false;
	}
}

async function updateUserRole(row: RecordValue) {
	const id = idOf(row);
	if (!id) return;
	busy = true;
	try {
		await adminRequest("/admin/user_roles", {
			method: "POST",
			body: { user_id: Number(id), role_text: selectedUserRole || null },
		});
		notice = selectedUserRole ? "用户角色已更新。" : "用户角色已撤销。";
		await loadView("users");
	} catch (value) {
		setError(value);
	} finally {
		busy = false;
	}
}

async function resetUserPassword(row: RecordValue) {
	const password = window.prompt(
		`请输入“${displayUser(row)}”的新密码（至少 6 位）：`,
	);
	if (!password || password.length < 6) return;
	busy = true;
	try {
		await adminRequest(
			`/admin/users/${encodeURIComponent(idOf(row))}/reset_password`,
			{
				method: "POST",
				body: { password: await sha256Hex(password) },
			},
		);
		notice = "用户密码已重置。";
	} catch (value) {
		setError(value);
	} finally {
		busy = false;
	}
}

async function bindUserAddress(row: RecordValue) {
	if (!bindAddressName.trim()) {
		error = "请输入要绑定的完整邮箱地址。";
		return;
	}
	busy = true;
	try {
		await adminRequest("/admin/users/bind_address", {
			method: "POST",
			body: { user_id: Number(idOf(row)), address: bindAddressName.trim() },
		});
		bindAddressName = "";
		notice = "邮箱地址已绑定。";
		await loadView("users");
	} catch (value) {
		setError(value);
	} finally {
		busy = false;
	}
}

async function clearAddress(row: RecordValue, sent = false) {
	const id = idOf(row);
	const action = sent ? "清理发件箱" : "清理收件箱";
	if (!id || !window.confirm(`确定${action}“${displayUser(row)}”吗？`)) return;
	busy = true;
	try {
		await adminRequest(
			`${sent ? "/admin/clear_sent_items" : "/admin/clear_inbox"}/${encodeURIComponent(id)}`,
			{ method: "DELETE" },
		);
		notice = `${action}完成。`;
	} catch (value) {
		setError(value);
	} finally {
		busy = false;
	}
}

async function saveUserSettings() {
	busy = true;
	try {
		await adminRequest("/admin/user_settings", {
			method: "POST",
			body: { ...userSettings, enable: registrationEnabled },
		});
		notice = "账号注册设置已保存。";
	} catch (value) {
		setError(value);
	} finally {
		busy = false;
	}
}

async function saveBusinessSettings() {
	busy = true;
	try {
		await adminRequest("/admin/user_settings", {
			method: "POST",
			body: { ...userSettings, enable: registrationEnabled },
		});
		await adminRequest("/admin/business_settings", {
			method: "POST",
			body: {
				allowRegistration: registrationEnabled,
				allowUserCreateEmail: userMailboxEnabled,
				allowAnonymousCreateEmail: anonymousMailboxEnabled,
				allowUserDeleteEmail: userDeleteEnabled,
			},
		});
		notice = "四项业务开关已保存，并将在后端请求中立即生效。";
		await loadSettings();
	} catch (value) {
		setError(value);
	} finally {
		busy = false;
	}
}

async function resetBusinessSettings() {
	if (
		!window.confirm(
			"恢复四项业务开关的环境变量默认值？这会删除 D1 中的覆盖值。",
		)
	)
		return;
	busy = true;
	try {
		await adminRequest("/admin/business_settings", {
			method: "POST",
			body: {
				allowRegistration: null,
				allowUserCreateEmail: null,
				allowAnonymousCreateEmail: null,
				allowUserDeleteEmail: null,
			},
		});
		await loadSettings();
		notice = "已恢复环境变量默认值。";
	} catch (value) {
		setError(value);
	} finally {
		busy = false;
	}
}

async function saveAutoCleanup() {
	busy = true;
	try {
		await adminRequest("/admin/auto_cleanup", {
			method: "POST",
			body: autoCleanup,
		});
		notice = "自动清理设置已保存。";
	} catch (value) {
		setError(value);
	} finally {
		busy = false;
	}
}

function updateCleanupBoolean(key: string, event: Event) {
	const input = event.currentTarget as HTMLInputElement;
	autoCleanup = { ...autoCleanup, [key]: input.checked };
}

function updateCleanupDays(key: string, event: Event) {
	const input = event.currentTarget as HTMLInputElement;
	autoCleanup = {
		...autoCleanup,
		[key]: Math.max(0, Number(input.value) || 0),
	};
}

async function runCleanup() {
	const days = Number(cleanupDays);
	if (!Number.isInteger(days) || days < 0) {
		error = "保留天数必须是大于等于 0 的整数。";
		return;
	}
	if (
		!window.confirm(
			`将清理“${cleanupType}”中早于 ${days} 天的数据，请确认范围后继续。`,
		)
	)
		return;
	busy = true;
	try {
		await adminRequest("/admin/cleanup", {
			method: "POST",
			body: { cleanType: cleanupType, cleanDays: days },
		});
		notice = "条件清理已执行。";
	} catch (value) {
		setError(value);
	} finally {
		busy = false;
	}
}

async function initializeDatabase(migrate = false) {
	const action = migrate ? "迁移数据库" : "初始化数据库";
	if (!window.confirm(`确认${action}？已有数据会按后端迁移语义保留。`)) return;
	busy = true;
	try {
		await adminRequest(
			migrate ? "/admin/db_migration" : "/admin/db_initialize",
			{ method: "POST" },
		);
		notice = `${action}请求已完成。`;
		dbStatus = bodyValue(await adminRequest("/admin/db_version"));
	} catch (value) {
		setError(value);
	} finally {
		busy = false;
	}
}

function toggleTheme() {
	darkMode = !darkMode;
	document.documentElement.classList.toggle("dark", darkMode);
}

function isMailView(view: ViewId) {
	return view === "inbox" || view === "sent" || view === "unknown";
}

onMount(() => {
	darkMode = document.documentElement.classList.contains("dark");
	void establishSession();
});
</script>

{#if phase === "loading"}
	<section class="mail-admin mail-admin-auth" aria-busy="true">
		<div class="mail-admin-auth-card"><RefreshCw class="mail-admin-spin" size={22} aria-hidden="true" /><span>正在验证管理员会话…</span></div>
	</section>
{:else if phase === "login" || phase === "bootstrap"}
	<section class="mail-admin mail-admin-auth">
		<div class="mail-admin-auth-card">
			<div class="mail-admin-brand"><ShieldCheck size={26} aria-hidden="true" /><span>NOCTICUR MAIL</span></div>
			<h1>邮件管理后台</h1>
			<p class="mail-admin-auth-subtitle">沿用 Loven7 Mail Admin 的管理工作台，凭后端管理员权限访问。</p>
			{#if phase === "login"}
				<form class="mail-admin-form" onsubmit={(event) => { event.preventDefault(); void submitLogin(); }}>
					<label for="mail-admin-email">账号邮箱</label>
					<input id="mail-admin-email" type="email" autocomplete="username" bind:value={loginEmail} required />
					<label for="mail-admin-password">密码</label>
					<input id="mail-admin-password" type="password" autocomplete="current-password" bind:value={loginPassword} required />
					{#if authError}<p class="mail-admin-form-error" role="alert">{authError}</p>{/if}
					<button class="mail-admin-primary" type="submit" disabled={busy}>{busy ? "登录中…" : "登录管理后台"}</button>
				</form>
				<div class="mail-admin-auth-links">
					<span>首次部署还没有管理员？</span>
					<button type="button" onclick={() => { phase = "bootstrap"; authError = ""; }}>开始首次设置</button>
				</div>
			{:else}
				<form class="mail-admin-form" onsubmit={(event) => { event.preventDefault(); void submitBootstrap(); }}>
					<label for="mail-admin-bootstrap-secret">现有管理员口令</label>
					<input id="mail-admin-bootstrap-secret" type="password" autocomplete="off" bind:value={bootstrapSecret} required />
					<label for="mail-admin-bootstrap-email">新管理员邮箱</label>
					<input id="mail-admin-bootstrap-email" type="email" autocomplete="username" bind:value={bootstrapEmail} required />
					<label for="mail-admin-bootstrap-password">新管理员密码</label>
					<input id="mail-admin-bootstrap-password" type="password" autocomplete="new-password" minlength="6" bind:value={bootstrapPassword} required />
					<label for="mail-admin-bootstrap-confirm">确认密码</label>
					<input id="mail-admin-bootstrap-confirm" type="password" autocomplete="new-password" minlength="6" bind:value={bootstrapConfirm} required />
					{#if authError}<p class="mail-admin-form-error" role="alert">{authError}</p>{/if}
					<button class="mail-admin-primary" type="submit" disabled={busy}>{busy ? "设置中…" : "创建首位管理员"}</button>
				</form>
				<div class="mail-admin-auth-links"><button type="button" onclick={() => { phase = "login"; authError = ""; }}>返回登录</button></div>
			{/if}
		</div>
	</section>
{:else}
	<div class="mail-admin mail-admin-shell">
		{#if sidebarOpen}<button class="mail-admin-backdrop" type="button" aria-label="关闭菜单" onclick={() => (sidebarOpen = false)}></button>{/if}
		<aside class:mail-admin-sidebar-open={sidebarOpen} class="mail-admin-sidebar">
			<div class="mail-admin-sidebar-brand"><span class="mail-admin-logo"><Mail size={19} aria-hidden="true" /></span><span><strong>Mail Admin</strong><small>管理控制台</small></span></div>
			<nav aria-label="管理导航">
				{#each ["工作台", "资源管理", "邮件", "配置"] as group}
					<div class="mail-admin-nav-group">
						<p>{group}</p>
						{#each navItems.filter((item) => item.group === group) as item}
							<button class:active={activeView === item.id} type="button" onclick={() => void loadView(item.id)}>
								{#if item.id === "dashboard"}<LayoutDashboard size={16} aria-hidden="true" />{:else if item.id === "addresses"}<Archive size={16} aria-hidden="true" />{:else if item.id === "users"}<Users size={16} aria-hidden="true" />{:else if item.id === "inbox"}<Mail size={16} aria-hidden="true" />{:else if item.id === "sent"}<FileText size={16} aria-hidden="true" />{:else if item.id === "unknown"}<CircleHelp size={16} aria-hidden="true" />{:else if item.id === "settings"}<Settings size={16} aria-hidden="true" />{:else}<Database size={16} aria-hidden="true" />{/if}
								<span>{item.label}</span>
							</button>
						{/each}
					</div>
				{/each}
			</nav>
			<div class="mail-admin-sidebar-foot"><span class="mail-admin-status-dot {backendStatus.tone}"></span>{backendStatus.text}<code>apimail.noctis.eu.cc</code></div>
		</aside>

		<main class="mail-admin-main">
			<header class="mail-admin-topbar">
				<button class="mail-admin-icon-button mail-admin-mobile-menu" type="button" aria-label="打开管理菜单" onclick={() => (sidebarOpen = true)}><Menu size={19} aria-hidden="true" /></button>
				<div class="mail-admin-breadcrumb"><span>管理后台</span><ChevronDown size={14} aria-hidden="true" /><strong>{navItems.find((item) => item.id === activeView)?.label}</strong></div>
				<div class="mail-admin-top-actions">
					<button class="mail-admin-icon-button" type="button" aria-label="刷新当前数据" onclick={() => void refreshCurrent()} disabled={busy}><RefreshCw class={busy ? "mail-admin-spin" : undefined} size={17} aria-hidden="true" /></button>
					<button class="mail-admin-icon-button" type="button" aria-label="切换主题" onclick={toggleTheme}>{#if darkMode}<Sun size={17} aria-hidden="true" />{:else}<Moon size={17} aria-hidden="true" />{/if}</button>
					<div class="mail-admin-profile"><span class="mail-admin-avatar"><UserRound size={15} aria-hidden="true" /></span><span>{profile?.email}</span></div>
					<button class="mail-admin-icon-button" type="button" aria-label="退出管理后台" onclick={() => void signOut()} disabled={busy}><LogOut size={17} aria-hidden="true" /></button>
				</div>
			</header>

			{#if notice}<div class="mail-admin-notice" role="status">{notice}<button type="button" aria-label="关闭提示" onclick={() => (notice = "")}><X size={15} /></button></div>{/if}
			{#if error}<div class="mail-admin-error" role="alert">{error}<button type="button" aria-label="关闭错误" onclick={() => (error = "")}><X size={15} /></button></div>{/if}

				<section class="mail-admin-content">
					{#if activeView === "dashboard"}
						<div class="mail-admin-page-heading"><div><p class="mail-admin-eyebrow">OVERVIEW</p><h1>系统概览</h1><p>查看邮件系统状态、资源规模和当前后端能力。</p></div><div class="mail-admin-heading-actions"><span class="mail-admin-status-chip {moduleChip(statisticsLoad).tone}">{moduleChip(statisticsLoad).text}</span><button class="mail-admin-secondary" type="button" onclick={() => void refreshCurrent()}><RefreshCw size={15} />刷新数据</button></div></div>
						<div class="mail-admin-metrics">
							{#each [{ label: "邮箱地址", key: "addressCount", legacyKey: "address_count", icon: "address" }, { label: "用户账号", key: "userCount", legacyKey: "user_count", icon: "users" }, { label: "邮件总量", key: "mailCount", legacyKey: "mail_count", icon: "mail" }, { label: "未知邮件", key: "unknownMailCount", legacyKey: "unknown_mail_count", icon: "unknown" }] as metric}
								<div class="mail-admin-metric"><span class="mail-admin-metric-icon">{#if metric.icon === "address"}<Archive size={18} />{:else if metric.icon === "users"}<Users size={18} />{:else if metric.icon === "mail"}<Mail size={18} />{:else}<CircleHelp size={18} />{/if}</span><div><span>{metric.label}</span><strong>{statisticText(metric.key, metric.legacyKey)}</strong></div></div>
							{/each}
						</div>
						{#if statisticsLoad.state === "error"}
							<div class="mail-admin-module-alert" role="alert">
								<span>{statisticsLoad.stale ? "刷新失败，显示上次结果。" : ""}{statisticsLoad.error}</span>
								<button class="mail-admin-secondary" type="button" onclick={() => void reloadDashboardModule("statistics")}>重试统计</button>
							</div>
						{/if}
						<div class="mail-admin-grid-two"><article class="mail-admin-card"><div class="mail-admin-card-heading"><div><p class="mail-admin-eyebrow">CAPABILITIES</p><h2>功能开关状态</h2></div><span class="mail-admin-status-chip {moduleChip(workerConfigLoad).tone}">{moduleChip(workerConfigLoad).text}</span></div><div class="mail-admin-capability-list"><span class:enabled={configState("ENABLE_USER_CREATE_EMAIL") === "on"} class:unknown={configState("ENABLE_USER_CREATE_EMAIL") === "unknown"}>用户创建邮箱 <b>{configText("ENABLE_USER_CREATE_EMAIL")}</b></span><span class:enabled={configState("DISABLE_ANONYMOUS_USER_CREATE_EMAIL") === "off"} class:unknown={configState("DISABLE_ANONYMOUS_USER_CREATE_EMAIL") === "unknown"}>匿名创建邮箱 <b>{anonymousConfigText()}</b></span><span class:enabled={configState("ENABLE_USER_DELETE_EMAIL") === "on"} class:unknown={configState("ENABLE_USER_DELETE_EMAIL") === "unknown"}>用户删除邮件 <b>{configText("ENABLE_USER_DELETE_EMAIL")}</b></span></div>{#if workerConfigLoad.state === "error"}<div class="mail-admin-module-alert" role="alert"><span>{workerConfigLoad.stale ? "刷新失败，显示上次结果。" : ""}{workerConfigLoad.error}</span><button class="mail-admin-secondary" type="button" onclick={() => void reloadDashboardModule("configs")}>重试配置</button></div>{/if}</article><article class="mail-admin-card"><div class="mail-admin-card-heading"><div><p class="mail-admin-eyebrow">SECURITY</p><h2>当前会话</h2></div><ShieldCheck size={18} /></div><dl class="mail-admin-definition"><div><dt>账号</dt><dd>{profile?.email}</dd></div><div><dt>角色</dt><dd><span class="mail-admin-badge">{profile?.role ?? "master"}</span></dd></div><div><dt>令牌</dt><dd>服务端 HttpOnly 会话</dd></div></dl></article></div>
				{:else if activeView === "settings"}
					<div class="mail-admin-page-heading"><div><p class="mail-admin-eyebrow">CONFIGURATION</p><h1>系统设置</h1><p>设置账号注册、邮件策略及后端能力。环境变量仅在没有覆盖值时生效。</p></div></div>
					<div class="mail-admin-grid-two"><article class="mail-admin-card"><div class="mail-admin-card-heading"><div><p class="mail-admin-eyebrow">ACCOUNT</p><h2>账号与邮箱开关</h2></div><Settings size={18} /></div><div class="mail-admin-toggle-list"><label><span><strong>允许用户注册</strong><small>关闭后不会阻断已有用户登录。</small></span><input type="checkbox" bind:checked={registrationEnabled} /></label><label><span><strong>允许用户创建邮箱</strong><small>用户端新地址接口立即读取此值。</small></span><input type="checkbox" bind:checked={userMailboxEnabled} /></label><label><span><strong>允许匿名创建邮箱</strong><small>匿名用户无需账号即可申请地址。</small></span><input type="checkbox" bind:checked={anonymousMailboxEnabled} /></label><label><span><strong>允许用户删除邮件</strong><small>用户端删除、清理邮件接口立即读取此值。</small></span><input type="checkbox" bind:checked={userDeleteEnabled} /></label></div><p class="mail-admin-config-note">覆盖值存入后端 D1 settings，并在实际邮件接口中生效。</p><div class="mail-admin-button-row"><button class="mail-admin-primary" type="button" onclick={() => void saveBusinessSettings()} disabled={busy}>保存四项业务开关</button><button class="mail-admin-secondary" type="button" onclick={() => void resetBusinessSettings()} disabled={busy}>恢复环境变量默认</button></div></article><article class="mail-admin-card"><div class="mail-admin-card-heading"><div><p class="mail-admin-eyebrow">BACKEND SNAPSHOT</p><h2>后端配置状态</h2></div><Activity size={18} /></div><pre class="mail-admin-json">{JSON.stringify({ businessSettings, workerConfig: workerConfigLoad.data ?? {} }, null, 2)}</pre></article></div>
					<article class="mail-admin-card mail-admin-card-wide"><div class="mail-admin-card-heading"><div><p class="mail-admin-eyebrow">ADVANCED SETTINGS</p><h2>完整系统配置</h2></div><Settings size={18} /></div><p class="mail-admin-card-copy">沿用后端已有设置接口，包含地址规则、额度、发信限制、黑名单、OAuth 与 Webhook。依赖未配置时会显示后端返回的具体状态。</p><div class="mail-admin-form-grid"><label class="mail-admin-field"><span>配置模块</span><select bind:value={advancedKey} onchange={() => void loadAdvancedSetting()}>{#each advancedSettingOptions as option}<option value={option.id}>{option.label}</option>{/each}</select></label><div class="mail-admin-button-row"><button class="mail-admin-secondary" type="button" onclick={() => void loadAdvancedSetting()} disabled={advancedBusy || busy}>读取配置</button><button class="mail-admin-primary" type="button" onclick={() => void saveAdvancedSetting()} disabled={advancedBusy || busy}>保存配置</button></div></div><textarea class="mail-admin-json-editor" aria-label="高级配置 JSON" bind:value={advancedText} spellcheck="false" rows="14"></textarea></article>
				{:else if activeView === "maintenance"}
					<div class="mail-admin-page-heading"><div><p class="mail-admin-eyebrow">MAINTENANCE</p><h1>数据库维护</h1><p>初始化和迁移会保留已有数据；破坏性清理始终需要明确确认。</p></div></div>
					<div class="mail-admin-card mail-admin-db-summary"><div class="mail-admin-card-heading"><div><p class="mail-admin-eyebrow">DATABASE STATUS</p><h2>当前数据库状态</h2></div><Database size={18} /></div><dl class="mail-admin-definition"><div><dt>当前版本</dt><dd>{stringValue(dbStatus.current_db_version, "未读取")}</dd></div><div><dt>代码版本</dt><dd>{stringValue(dbStatus.code_db_version, "未读取")}</dd></div><div><dt>数据库大小</dt><dd>{dbStatus.database_size ? `${numberValue(dbStatus.database_size).toLocaleString()} bytes` : "未读取"}</dd></div><div><dt>状态</dt><dd>{dbStatus.need_initialization ? "需要初始化" : dbStatus.need_migration ? "需要迁移" : "已是最新"}</dd></div></dl></div>
					<div class="mail-admin-grid-two"><article class="mail-admin-card"><div class="mail-admin-card-heading"><div><p class="mail-admin-eyebrow">SCHEMA</p><h2>结构维护</h2></div><Database size={18} /></div><p class="mail-admin-card-copy">沿用后端迁移语义创建缺失表、升级结构，不提供整库重置或任意 SQL。</p><div class="mail-admin-button-row"><button class="mail-admin-secondary" type="button" onclick={() => void initializeDatabase(false)} disabled={busy}>初始化数据库</button><button class="mail-admin-secondary" type="button" onclick={() => void initializeDatabase(true)} disabled={busy}>执行迁移</button></div></article><article class="mail-admin-card"><div class="mail-admin-card-heading"><div><p class="mail-admin-eyebrow">RETENTION</p><h2>按条件清理</h2></div><Trash2 size={18} /></div><label class="mail-admin-field"><span>清理类型</span><select bind:value={cleanupType}><option value="raw_mails">收件邮件</option><option value="sendbox">发件邮件</option><option value="address">邮箱地址</option></select></label><label class="mail-admin-field"><span>保留天数</span><input type="number" min="0" bind:value={cleanupDays} /></label><button class="mail-admin-danger" type="button" onclick={() => void runCleanup()} disabled={busy}>确认执行清理</button></article></div><article class="mail-admin-card mail-admin-card-wide"><div class="mail-admin-card-heading"><div><p class="mail-admin-eyebrow">AUTO CLEANUP</p><h2>自动清理配置</h2></div><Archive size={18} /></div><pre class="mail-admin-json">{JSON.stringify(autoCleanup, null, 2)}</pre><button class="mail-admin-secondary" type="button" onclick={() => void saveAutoCleanup()} disabled={busy}>保存当前配置</button></article>
					<article class="mail-admin-card mail-admin-card-wide"><div class="mail-admin-card-heading"><div><p class="mail-admin-eyebrow">RETENTION CONTROLS</p><h2>自动清理范围</h2></div><Archive size={18} /></div><p class="mail-admin-card-copy">只修改自动清理的启用状态和保留天数；后端仍会校验边界，已有高级清理配置保持不变。</p><div class="mail-admin-cleanup-grid"><label class="mail-admin-cleanup-item"><span>收件邮件</span><input type="checkbox" checked={Boolean(autoCleanup.enableMailsAutoCleanup)} onchange={(event) => updateCleanupBoolean("enableMailsAutoCleanup", event)} /><input type="number" min="0" aria-label="收件邮件保留天数" value={numberValue(autoCleanup.cleanMailsDays)} oninput={(event) => updateCleanupDays("cleanMailsDays", event)} /></label><label class="mail-admin-cleanup-item"><span>未知邮件</span><input type="checkbox" checked={Boolean(autoCleanup.enableUnknowMailsAutoCleanup)} onchange={(event) => updateCleanupBoolean("enableUnknowMailsAutoCleanup", event)} /><input type="number" min="0" aria-label="未知邮件保留天数" value={numberValue(autoCleanup.cleanUnknowMailsDays)} oninput={(event) => updateCleanupDays("cleanUnknowMailsDays", event)} /></label><label class="mail-admin-cleanup-item"><span>发件箱</span><input type="checkbox" checked={Boolean(autoCleanup.enableSendBoxAutoCleanup)} onchange={(event) => updateCleanupBoolean("enableSendBoxAutoCleanup", event)} /><input type="number" min="0" aria-label="发件箱保留天数" value={numberValue(autoCleanup.cleanSendBoxDays)} oninput={(event) => updateCleanupDays("cleanSendBoxDays", event)} /></label><label class="mail-admin-cleanup-item"><span>邮箱地址</span><input type="checkbox" checked={Boolean(autoCleanup.enableAddressAutoCleanup)} onchange={(event) => updateCleanupBoolean("enableAddressAutoCleanup", event)} /><input type="number" min="0" aria-label="邮箱地址保留天数" value={numberValue(autoCleanup.cleanAddressDays)} oninput={(event) => updateCleanupDays("cleanAddressDays", event)} /></label><label class="mail-admin-cleanup-item"><span>非活跃地址</span><input type="checkbox" checked={Boolean(autoCleanup.enableInactiveAddressAutoCleanup)} onchange={(event) => updateCleanupBoolean("enableInactiveAddressAutoCleanup", event)} /><input type="number" min="0" aria-label="非活跃地址保留天数" value={numberValue(autoCleanup.cleanInactiveAddressDays)} oninput={(event) => updateCleanupDays("cleanInactiveAddressDays", event)} /></label><label class="mail-admin-cleanup-item"><span>未绑定地址</span><input type="checkbox" checked={Boolean(autoCleanup.enableUnboundAddressAutoCleanup)} onchange={(event) => updateCleanupBoolean("enableUnboundAddressAutoCleanup", event)} /><input type="number" min="0" aria-label="未绑定地址保留天数" value={numberValue(autoCleanup.cleanUnboundAddressDays)} oninput={(event) => updateCleanupDays("cleanUnboundAddressDays", event)} /></label><label class="mail-admin-cleanup-item"><span>空地址</span><input type="checkbox" checked={Boolean(autoCleanup.enableEmptyAddressAutoCleanup)} onchange={(event) => updateCleanupBoolean("enableEmptyAddressAutoCleanup", event)} /><input type="number" min="0" aria-label="空地址保留天数" value={numberValue(autoCleanup.cleanEmptyAddressDays)} oninput={(event) => updateCleanupDays("cleanEmptyAddressDays", event)} /></label></div><button class="mail-admin-primary" type="button" onclick={() => void saveAutoCleanup()} disabled={busy}>保存自动清理配置</button></article>
				{:else}
					<div class="mail-admin-page-heading"><div><p class="mail-admin-eyebrow">{isMailView(activeView) ? "MAILBOX" : "DIRECTORY"}</p><h1>{navItems.find((item) => item.id === activeView)?.label}</h1><p>{activeView === "addresses" ? "管理地址、额度和关联邮件。" : activeView === "users" ? "管理用户账号、角色、密码和绑定地址。" : "查看、检索和清理邮件数据。"}</p></div><button class="mail-admin-secondary" type="button" onclick={() => void refreshCurrent()}><RefreshCw size={15} />刷新</button></div>
					{#if activeView === "addresses"}<article class="mail-admin-card mail-admin-inline-form"><div class="mail-admin-card-heading"><div><p class="mail-admin-eyebrow">NEW ADDRESS</p><h2>创建邮箱地址</h2></div><Archive size={18} /></div><div class="mail-admin-form-grid"><label class="mail-admin-field"><span>地址名称</span><input placeholder="例如 inbox" bind:value={newAddressName} /></label><label class="mail-admin-field"><span>域名（可选）</span><input placeholder="使用默认域名" bind:value={newAddressDomain} /></label><label class="mail-admin-check"><input type="checkbox" bind:checked={randomSubdomain} /><span>启用随机子域名</span></label><button class="mail-admin-primary" type="button" onclick={() => void createAddress()} disabled={busy}>创建地址</button></div></article>{/if}
					{#if activeView === "users"}<article class="mail-admin-card mail-admin-inline-form"><div class="mail-admin-card-heading"><div><p class="mail-admin-eyebrow">NEW USER</p><h2>创建用户账号</h2></div><Users size={18} /></div><div class="mail-admin-form-grid"><label class="mail-admin-field"><span>账号邮箱</span><input type="email" autocomplete="off" bind:value={newUserEmail} /></label><label class="mail-admin-field"><span>初始密码</span><input type="password" autocomplete="new-password" minlength="6" bind:value={newUserPassword} /></label><button class="mail-admin-primary" type="button" onclick={() => void createUser()} disabled={busy}>创建用户</button></div></article>{/if}
					<div class="mail-admin-toolbar"><div class="mail-admin-search"><Search size={16} aria-hidden="true" /><input aria-label="搜索管理数据" placeholder={activeView === "users" ? "搜索用户邮箱" : "搜索关键字"} bind:value={searchInput} onkeydown={(event) => { if (event.key === "Enter") void searchCurrent(); }} /><button type="button" onclick={() => void searchCurrent()}>搜索</button></div><span class="mail-admin-result-count">共 {total} 条</span></div>
					<div class="mail-admin-table-wrap"><table class="mail-admin-table"><thead><tr>{#if activeView === "users"}<th>账号</th><th>角色</th><th>地址数</th><th>状态</th><th></th>{:else if activeView === "addresses"}<th>地址</th><th>所属用户</th><th>邮件数</th><th>状态</th><th></th>{:else}<th>发件人</th><th>主题</th><th>收件地址</th><th>时间</th><th></th>{/if}</tr></thead><tbody>{#if busy && rows.length === 0}<tr><td colspan="5" class="mail-admin-empty">正在加载…</td></tr>{:else if rows.length === 0}<tr><td colspan="5" class="mail-admin-empty">暂无数据</td></tr>{:else}{#each rows as row}<tr class:selected={selected && idOf(selected) === idOf(row)}>{#if activeView === "users"}<td><strong>{displayUser(row)}</strong><small>{stringValue(row.id, "")}</small></td><td><span class="mail-admin-badge">{stringValue(row.role_text, "普通用户")}</span></td><td>{numberValue(row.address_count)}</td><td>{row.enable === false ? "已禁用" : "正常"}</td><td class="mail-admin-actions-cell"><button class="mail-admin-text-button" type="button" onclick={() => (selected = row)}>查看</button><button class="mail-admin-text-button danger" type="button" onclick={() => void deleteRow(row, "/admin/users", "删除用户")}>删除</button></td>{:else if activeView === "addresses"}<td><strong>{displayUser(row)}</strong><small>{stringValue(row.domain, "")}</small></td><td>{stringValue(row.user_email ?? row.owner_email, "未绑定")}</td><td>{numberValue(row.mail_count ?? row.message_count)}</td><td>{row.enable === false ? "已停用" : "正常"}</td><td class="mail-admin-actions-cell"><button class="mail-admin-text-button" type="button" onclick={() => void clearAddress(row)}>清收件</button><button class="mail-admin-text-button danger" type="button" onclick={() => void deleteAddress(row)}>删除</button></td>{:else}<td><strong>{stringValue(row.sender ?? row.from, "未知发件人")}</strong></td><td><button class="mail-admin-table-link" type="button" onclick={() => void selectMail(row)}>{displaySubject(row)}</button></td><td>{stringValue(row.address ?? row.to, "—")}</td><td>{displayTime(row)}</td><td class="mail-admin-actions-cell"><button class="mail-admin-text-button danger" type="button" onclick={() => void deleteRow(row, "/admin/mails", "删除邮件")}>删除</button></td>{/if}</tr>{/each}{/if}</tbody></table></div>
					{#if selected && activeView === "users"}<article class="mail-admin-card mail-admin-user-detail"><div class="mail-admin-detail-head"><div><p class="mail-admin-eyebrow">USER CONTROL</p><h2>{displayUser(selected)}</h2></div><button class="mail-admin-icon-button" type="button" aria-label="关闭用户详情" onclick={() => (selected = null)}><X size={17} /></button></div><div class="mail-admin-form-grid"><label class="mail-admin-field"><span>角色</span><select bind:value={selectedUserRole}><option value="">撤销角色</option>{#each roleOptions as role}<option value={String(role.role ?? role.name ?? "")}>{String(role.role ?? role.name ?? "")}</option>{/each}</select></label><button class="mail-admin-secondary" type="button" onclick={() => void updateUserRole(selected)} disabled={busy}>保存角色</button><label class="mail-admin-field"><span>绑定地址</span><input placeholder="完整邮箱地址" bind:value={bindAddressName} /></label><button class="mail-admin-secondary" type="button" onclick={() => void bindUserAddress(selected)} disabled={busy}>绑定地址</button></div></article>{/if}
					{#if selected && isMailView(activeView)}<article class="mail-admin-card mail-admin-mail-detail"><div class="mail-admin-detail-head"><div><p class="mail-admin-eyebrow">MESSAGE DETAIL</p><h2>{displaySubject(selected)}</h2></div><button class="mail-admin-icon-button" type="button" aria-label="关闭邮件详情" onclick={() => (selected = null)}><X size={17} /></button></div><dl class="mail-admin-definition"><div><dt>发件人</dt><dd>{stringValue(selected.sender ?? selected.from)}</dd></div><div><dt>收件人</dt><dd>{stringValue(selected.address ?? selected.to)}</dd></div><div><dt>时间</dt><dd>{displayTime(selected)}</dd></div></dl>{#if typeof selected.html === "string" && selected.html}<div class="mail-admin-mail-html">{@html sanitizeMailHtml(selected.html)}</div>{:else}<pre class="mail-admin-mail-text">{stringValue(selected.text ?? selected.content, "邮件没有可显示的正文")}</pre>{/if}</article>{/if}
				{/if}
			</section>
		</main>
	</div>
{/if}
