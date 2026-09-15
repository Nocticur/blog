const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const COOKIE_NAME = "mail_admin_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60;

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
		throw new Error("MAIL_ADMIN_SESSION_SECRET must contain at least 32 characters");
	}
	const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
	return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function extractCookieValue(cookieHeader) {
	if (!cookieHeader) return "";
	const cookie = cookieHeader
		.split(";")
		.map((part) => part.trim())
		.find((part) => part.startsWith(COOKIE_NAME + "="));
	return cookie ? cookie.slice(COOKIE_NAME.length + 1) : "";
}

export async function createSessionCookie(session, secret) {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const key = await getSessionKey(secret);
	const encrypted = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv },
		key,
		encoder.encode(JSON.stringify(session)),
	);
	const value = toBase64Url(iv) + "." + toBase64Url(new Uint8Array(encrypted));
	return COOKIE_NAME + "=" + value + "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=" + SESSION_MAX_AGE_SECONDS;
}

export function clearSessionCookie() {
	return COOKIE_NAME + "=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";
}

export async function readSessionCookie(cookieHeader, secret) {
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
			typeof session.userToken !== "string" ||
			typeof session.accessToken !== "string" ||
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
