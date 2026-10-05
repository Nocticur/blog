import { randomUUID } from 'node:crypto';
import { MAX_IMAGE_BYTES } from './writing-session.mjs';
import { friendWebUrl } from '../../src/utils/friend-data.mjs';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const imageExtensions = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' };
function imageAddress(value, base, absolute = false) {
  if (typeof value !== 'string' || !value.trim()) return null;
  if (absolute && !/^https?:\/\//i.test(value.trim())) return null;
  try {
    const url = new URL(value, base);
    return friendWebUrl(url.href).href;
  } catch { return null; }
}

export async function uploadImgbedImage(bytes, {
  mimeType,
  folder = 'blog/friends/avatars',
  fileName,
  env = process.env,
  fetcher = globalThis.fetch,
} = {}) {
  if (!imageExtensions[mimeType]) fail('图片格式无效');
  if (!bytes?.length || bytes.length > MAX_IMAGE_BYTES) fail('图片不能超过 3 MiB');
  const configured = String(env.IMGBED_BASE_URL || '').trim();
  const token = String(env.IMGBED_API_TOKEN || '').trim();
  if (!configured || !token) fail('请先配置 IMGBED_BASE_URL 和 IMGBED_API_TOKEN', 503);
  let base;
  try {
    base = friendWebUrl(configured);
    if (base.protocol !== 'https:') fail('图床地址必须使用 HTTPS', 503);
  } catch { fail('IMGBED_BASE_URL 必须为有效的公网 HTTPS 地址', 503); }
  if (!/^[a-z0-9_-]+(?:\/[a-z0-9_-]+)*$/i.test(folder)) fail('图床上传目录无效');
  const endpoint = new URL('/upload', base);
  endpoint.searchParams.set('returnFormat', 'full');
  endpoint.searchParams.set('uploadFolder', folder);
  const form = new FormData();
  form.set('file', new Blob([bytes], { type: mimeType }), fileName || `${randomUUID()}.${imageExtensions[mimeType]}`);
  let response;
  try {
    response = await fetcher(endpoint.href, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
    });
  } catch { fail('图床上传请求失败，请稍后重试', 502); }
  if (response.status === 401 || response.status === 403) fail('图床认证失败，请检查服务端上传凭据', 502);
  if (!response.ok) fail(`图床上传失败（HTTP ${response.status}）`, 502);
  let data;
  try { data = await response.json(); } catch { fail('图床返回的上传结果格式无效', 502); }
  const result = Array.isArray(data) ? data[0] : data;
  const image = imageAddress(result?.publicUrl, base, true) || imageAddress(result?.src, base);
  if (!image) fail('图床未返回有效的图片地址', 502);
  return { image };
}
