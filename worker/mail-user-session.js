const encoder = new TextEncoder();
const decoder = new TextDecoder();

// 普通邮箱用户的会话 Cookie，与管理员会话（mail_admin_session）完全独立：
// 不同的 Cookie 名、独立的密钥入口、7 天有效期，避免两侧会话互相影响。
export const MAIL_USER_COOKIE_NAME = "mail_user_session";
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

function toBase64Url(value) {
	let binary = "";
	for (const byte of value) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value) {
	const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
	const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
	const binary = atob(padded);
	return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function getSessionKey(secret) {
	if (typeof secret !== "string" || secret.length < 32) {
		throw new Error("MAIL_USER_SESSION_SECRET (or MAIL_ADMIN_SESSION_SECRET fallback) must contain at least 32 characters");
	}
	const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
	return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function extractCookieValue(cookieHeader) {
	if (!cookieHeader) return "";
	const cookie = cookieHeader
		.split(";")
		.map((part) => part.trim())
		.find((part) => part.startsWith(MAIL_USER_COOKIE_NAME + "="));
	return cookie ? cookie.slice(MAIL_USER_COOKIE_NAME.length + 1) : "";
}

export async function createUserSessionCookie(session, secret) {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const key = await getSessionKey(secret);
	const encrypted = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv },
		key,
		encoder.encode(JSON.stringify(session)),
	);
	const value = toBase64Url(iv) + "." + toBase64Url(new Uint8Array(encrypted));
	return MAIL_USER_COOKIE_NAME + "=" + value + "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=" + SESSION_MAX_AGE_SECONDS;
}

export function clearUserSessionCookie() {
	return MAIL_USER_COOKIE_NAME + "=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";
}

export async function readUserSessionCookie(cookieHeader, secret) {
	const value = extractCookieValue(cookieHeader);
	if (!value) return null;
	const [ivText, encryptedText] = value.split(".");
	if (!ivText || !encryptedText) return null;
	try {
		const key = await getSessionKey(secret);
		const decrypted = await crypto.subtle.decrypt(
			{ name: "AES-GCM", iv: fromBase64Url(ivText) },
			key,
			fromBase64Url(encryptedText),
		);
		const session = JSON.parse(decoder.decode(decrypted));
		if (
			!session ||
			typeof session !== "object" ||
			typeof session.address !== "string" ||
			!session.address ||
			typeof session.jwt !== "string" ||
			!session.jwt ||
			typeof session.expiresAt !== "number" ||
			session.expiresAt <= Date.now()
		) {
			return null;
		}
		return session;
	} catch {
		return null;
	}
}
