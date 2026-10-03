const dns = require('node:dns/promises');
const http = require('node:http');
const https = require('node:https');
const { BlockList, isIP } = require('node:net');
const sanitize = require('sanitize-html');

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
async function fetchPublicPage(value, origin, redirects = 0) {
  const url = publicUrl(value);
  if (url.origin !== origin || redirects > 3) throw new Error('不允许跨站跳转或过多跳转');
  const hostname = url.hostname.replace(/^\[|\]$/g,'');
  const addresses = await dns.lookup(hostname,{all:true});
  if (!addresses.length || addresses.some(item=>!isPublicAddress(item.address))) throw new Error('域名解析到内网或保留地址');
  // Pin the checked DNS answer for this request; do not resolve a second time.
  const response = await new Promise((resolve,reject)=>{
    const request = (url.protocol === 'https:' ? https : http).get(url, { lookup(_host,options,callback) { callback(null,options.all ? [addresses[0]] : addresses[0].address,addresses[0].family); }, headers: { 'User-Agent': 'BlogFriendVerifier/1.0', Accept: 'text/html' } }, res=>{
      const chunks=[]; let size=0;
      res.on('data',chunk=>{ size+=chunk.length; if(size>1024*1024) { res.destroy(new Error('页面超过 1 MiB')); return; } chunks.push(chunk); });
      res.on('error',reject);
      res.on('end',()=>resolve({status:res.statusCode,location:res.headers.location,content:Buffer.concat(chunks).toString('utf8')}));
    });
    const timer=setTimeout(()=>request.destroy(new Error('页面请求超时')),12000);
    request.on('close',()=>clearTimeout(timer)); request.on('error',reject);
  });
  if ([301,302,303,307,308].includes(response.status) && response.location) return fetchPublicPage(new URL(response.location,url).href,origin,redirects+1);
  return {...response,actualUrl:url.href};
}
module.exports = { validateApplication, isPublicAddress, hasBacklink, fetchPublicPage };
