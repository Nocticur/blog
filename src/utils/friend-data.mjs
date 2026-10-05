const invalid = (message) => {
	throw Object.assign(new Error(message), { status: 400 });
};

/** Syntax checks only; actual network requests must also validate and pin DNS. */
export function friendWebUrl(value) {
	let url;
	try {
		url = new URL(value);
	} catch {
		invalid("链接必须为 HTTP(S) 地址");
	}
	if (
		!["http:", "https:"].includes(url.protocol) ||
		url.username ||
		url.password ||
		(url.port && !["80", "443"].includes(url.port))
	) {
		invalid("链接必须为无凭证的标准 HTTP(S) 地址");
	}
	const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
	if (!hostname.includes(".") && !hostname.includes(":"))
		invalid("不允许本机、内网或保留地址");
	if (
		hostname === "localhost" ||
		hostname.endsWith(".localhost") ||
		hostname.endsWith(".local")
	)
		invalid("不允许本机、内网或保留地址");
	if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
		const [a, b, c] = hostname.split(".").map(Number);
		if (
			a === 0 ||
			a === 10 ||
			a === 127 ||
			a >= 224 ||
			(a === 100 && b >= 64 && b <= 127) ||
			(a === 169 && b === 254) ||
			(a === 172 && b >= 16 && b <= 31) ||
			(a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)))) ||
			(a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
			(a === 203 && b === 0 && c === 113)
		) {
			invalid("不允许本机、内网或保留地址");
		}
	} else if (hostname.includes(":")) {
		const [first, second = "0"] = hostname.split(":");
		if (
			!/^[23][0-9a-f]{3}$/.test(first) ||
			first === "2002" ||
			(first === "2001" &&
				(Number.parseInt(second || "0", 16) < 0x200 ||
					Number.parseInt(second || "0", 16) === 0xdb8))
		) {
			invalid("不允许本机、内网或保留地址");
		}
	}
	return url;
}

export function friendUrlKey(value) {
	try {
		const url = new URL(value);
		if (!["https:", "http:"].includes(url.protocol)) return "";
		return `${url.origin}${url.pathname.replace(/\/+$/, "")}${url.search}`;
	} catch {
		return "";
	}
}

export function isFriendImageUrl(value) {
	if (typeof value !== "string" || !value.trim()) return false;
	const image = value.trim();
	if (/^https?:\/\//i.test(image)) {
		try {
			friendWebUrl(image);
			return true;
		} catch {
			return false;
		}
	}
	if (/[:\\?#]/.test(image) || image.startsWith("//")) return false;
	const parts = image.replace(/^\.\//, "").replace(/^\//, "").split("/");
	return (
		parts.length > 0 &&
		parts.every(
			(part) =>
				part &&
				part !== "." &&
				part !== ".." &&
				!Array.from(part).some((character) => character.charCodeAt(0) < 32),
		)
	);
}

export function normalizeFriendDraft(draft, existing = {}) {
	if (!draft || typeof draft !== "object" || Array.isArray(draft))
		invalid("友链内容必须为对象");
	const row = { ...existing, ...draft };
	for (const [field, label] of [
		["title", "站点名称"],
		["desc", "站点描述"],
		["siteurl", "站点链接"],
		["imgurl", "头像链接"],
	]) {
		if (typeof row[field] !== "string" || !row[field].trim())
			invalid(`${label}不能为空`);
		row[field] = row[field].trim();
	}
	const site = friendWebUrl(row.siteurl);
	if (!isFriendImageUrl(row.imgurl))
		invalid("头像链接必须为 HTTP(S) 地址或合法本地图片路径");
	if (row.enabled === undefined) row.enabled = true;
	if (row.weight === undefined) row.weight = 5;
	if (
		typeof row.enabled !== "boolean" ||
		typeof row.weight !== "number" ||
		!Number.isFinite(row.weight)
	)
		invalid("友链需要 enabled 布尔值和 weight 数字");
	if (
		"tags" in row &&
		(!Array.isArray(row.tags) ||
			row.tags.some((tag) => typeof tag !== "string"))
	)
		invalid("tags 必须为字符串数组");
	for (const field of ["image", "cover"])
		if (
			field in row &&
			(typeof row[field] !== "string" ||
				(row[field].trim() && !isFriendImageUrl(row[field])))
		)
			invalid("封面必须为 HTTP(S) 地址或合法本地图片路径");
	if ("linkpage" in row) {
		if (typeof row.linkpage !== "string") invalid("对方友链页地址必须为字符串");
		row.linkpage = row.linkpage.trim();
		if (row.linkpage && friendWebUrl(row.linkpage).origin !== site.origin)
			invalid("友链页面必须与站点同源");
	}
	return row;
}
