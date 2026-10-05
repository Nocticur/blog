const dns = require('node:dns/promises');
const http = require('node:http');
const https = require('node:https');
const { BlockList, isIP } = require('node:net');
const sanitize = require('sanitize-html');
const { gunzipSync, inflateSync, brotliDecompressSync } = require('node:zlib');

const blocked = new BlockList();
for (const [address, prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]]) blocked.addSubnet(address,prefix,'ipv4');
const globalV6 = new BlockList(); globalV6.addSubnet('2000::',3,'ipv6');
blocked.addSubnet('2001::',23,'ipv6'); blocked.addSubnet('2001:db8::',32,'ipv6'); blocked.addSubnet('2002::',16,'ipv6');
function isPublicAddress(address) {
  const family = isIP(address);
  return family === 4 ? !blocked.check(address,'ipv4') : family === 6 && globalV6.check(address,'ipv6') && !blocked.check(address,'ipv6');
}
function publicUrl(value) {
  const url = new URL(value);
  if (!['https:','http:'].includes(url.protocol) || url.username || url.password || (url.port && !['80','443'].includes(url.port))) throw new Error('仅支持无凭证的标准 HTTP(S) 地址');
  const hostname = url.hostname.replace(/^\[|\]$/g,'');
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || (isIP(hostname) && !isPublicAddress(hostname))) throw new Error('不允许本机、内网或保留地址');
  return url;
}
function validateApplication(data) {
  const site = publicUrl(data.site_url);
  const page = publicUrl(data.friend_page_url);
  if (page.origin !== site.origin) throw new Error('友链页面必须与申请站点同源');
  for (const image of [data.site_avatar,data.site_image]) if (image) publicUrl(image);
  return site;
}
function hasBacklink(html, expected) {
  const target = new URL(expected);
  const cleaned = sanitize(html, { allowedTags: ['a'], allowedAttributes: { a: ['href'] } });
  for (const match of cleaned.matchAll(/<a\s[^>]*href="([^"]*)"/g)) {
    try { const link = new URL(match[1].replace(/&amp;/g,'&')); if (link.origin === target.origin && link.pathname.replace(/\/$/,'') === target.pathname.replace(/\/$/,'')) return true; } catch { /* Invalid link is not a backlink. */ }
  }
  return false;
}
function requestPinnedResource(url, { address, maxBytes, timeoutMs, signal }) {
  return new Promise((resolve, reject) => {
    // Resolve once and pin the checked answer for the entire connection.
    const request = (url.protocol === 'https:' ? https : http).get(url, {
      signal,
      lookup(_host, options, callback) {
        if (options.all) callback(null, [address]);
        else callback(null, address.address, address.family);
      },
      headers: { 'User-Agent': 'BlogFriendVerifier/2.0', Accept: '*/*', 'Accept-Encoding': 'identity' },
    }, response => {
      const chunks = []; let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > maxBytes) { response.destroy(new Error('响应超过下载大小限制')); return; }
        chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('aborted', () => reject(new Error('响应中断')));
      response.on('end', () => {
        try {
          let body = Buffer.concat(chunks);
          const headers = { ...response.headers };
          const encoding = String(headers['content-encoding'] || '').toLowerCase();
          const decode = { gzip: gunzipSync, deflate: inflateSync, br: brotliDecompressSync }[encoding];
          if (decode) body = decode(body, { maxOutputLength: maxBytes });
          else if (encoding && encoding !== 'identity') throw new Error('不支持的响应压缩格式');
          delete headers['content-encoding']; delete headers['content-length'];
          resolve({ status: response.statusCode, headers, body });
        } catch (error) { reject(error); }
      });
    });
    const timer = setTimeout(() => request.destroy(new Error('页面请求超时')), timeoutMs);
    request.on('close', () => clearTimeout(timer));
    request.on('error', reject);
  });
}

async function fetchPublicResource(value, options = {}) {
  const initial = publicUrl(value);
  const origin = options.origin || initial.origin;
  const maxRedirects = options.maxRedirects ?? 3;
  const maxBytes = options.maxBytes ?? 1024 * 1024;
  const timeoutMs = options.timeoutMs ?? 12000;
  const resolve = options.resolve || (hostname => dns.lookup(hostname, { all: true }));
  const request = options.request || requestPinnedResource;
  const deadline = Date.now() + timeoutMs;
  const signal = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(options.signal ? [options.signal] : [])]);
  const beforeDeadline = operation => new Promise((resolve, reject) => {
    const onAbort = () => reject(new Error('页面请求超时'));
    if (signal.aborted) { onAbort(); return; }
    signal.addEventListener('abort', onAbort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
  let url = initial;
  for (let redirects = 0; ; redirects++) {
    if (!options.allowCrossOrigin && url.origin !== origin) throw new Error('不允许跨站跳转');
    if (redirects > maxRedirects) throw new Error('过多跳转');
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = await beforeDeadline(resolve(hostname));
    if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) throw new Error('域名解析到内网或保留地址');
    const remaining = deadline - Date.now();
    if (remaining <= 0 || options.signal?.aborted) throw new Error('页面请求超时');
    const response = await beforeDeadline(request(url, { address: addresses[0], maxBytes, timeoutMs: remaining, signal }));
    if (response.body.length > maxBytes) throw new Error('响应超过下载大小限制');
    const location = response.headers.location;
    if ([301, 302, 303, 307, 308].includes(response.status) && location) {
      const next = publicUrl(new URL(location, url).href);
      if (!options.allowCrossOrigin && next.origin !== origin) throw new Error('不允许跨站跳转');
      if (options.followRedirects === false) return { ...response, actualUrl: url.href };
      url = next; continue;
    }
    return { ...response, actualUrl: url.href };
  }
}

async function fetchPublicPage(value, origin) {
  const response = await fetchPublicResource(value, { origin });
  return { ...response, location: response.headers.location, content: response.body.toString('utf8') };
}
module.exports = { validateApplication, isPublicAddress, hasBacklink, publicUrl, fetchPublicPage, fetchPublicResource };
