import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_COOKIE = 'writing_session';
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
// A 3 MiB image occupies 4 MiB after base64, plus JSON metadata.
export const MAX_REQUEST_BYTES = 4 * 1024 * 1024 + 16 * 1024;
export function resolvePasswordHash(env = process.env) {
  return env.WRITING_PASSWORD ? createHash('sha256').update(env.WRITING_PASSWORD).digest('hex') : env.WRITING_PASSWORD_HASH || '';
}
export function verifyPassword(password, env = process.env) {
  if (!password || typeof password !== 'string') return false;
  const expected = Buffer.from(resolvePasswordHash(env));
  const given = Buffer.from(createHash('sha256').update(password).digest('hex'));
  return given.length === expected.length && timingSafeEqual(given, expected);
}
export function resolveSessionSecret(env = process.env) {
  return env.WRITING_SESSION_SECRET || `firefly-writing-session:${resolvePasswordHash(env)}`;
}
export function signSession(env = process.env, ttlMs = SESSION_TTL_MS) {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + ttlMs })).toString('base64url');
  return `${payload}.${createHmac('sha256', resolveSessionSecret(env)).update(payload).digest('base64url')}`;
}
export function verifySession(token, env = process.env) {
  if (!resolvePasswordHash(env) || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))) return false;
  const [payload, signature] = parts;
  const expected = createHmac('sha256', resolveSessionSecret(env)).update(payload).digest();
  const given = Buffer.from(signature, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;
  try { const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); return Number.isFinite(data.exp) && data.exp > Date.now(); }
  catch { return false; }
}
export function cookieSession(headers) {
  const cookie = headers instanceof Headers ? headers.get('cookie') : headers?.cookie;
  const value = String(cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${SESSION_COOKIE}=`));
  return value ? value.slice(SESSION_COOKIE.length + 1) : '';
}
export function sessionCookie(token, secure = true) {
  return `${SESSION_COOKIE}=${token || ''}; Path=/api/writing/; HttpOnly; SameSite=Strict; Max-Age=${token ? SESSION_TTL_MS / 1000 : 0}${secure ? '; Secure' : ''}`;
}
export function requireSameOrigin(headers, expectedOrigin) {
  const origin = headers instanceof Headers ? headers.get('origin') : headers?.origin;
  const site = headers instanceof Headers ? headers.get('sec-fetch-site') : headers?.['sec-fetch-site'];
  if (origin !== expectedOrigin || site === 'cross-site') throw Object.assign(new Error('写请求来源无效，请从本站后台重试'), { status: 403 });
}
export function assertRequestSize(text) {
  if (Buffer.byteLength(text) > MAX_REQUEST_BYTES) throw Object.assign(new Error('请求体过大，图片上限为 3 MiB'), { status: 413 });
}
