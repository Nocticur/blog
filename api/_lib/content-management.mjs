import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import matter from './safe-matter.mjs';
import { MAX_IMAGE_BYTES } from './writing-session.mjs';
import { normalizeAnnouncements, validateAnnouncements } from '../../src/utils/announcement-data.mjs';
import { friendUrlKey, normalizeFriendDraft } from '../../src/utils/friend-data.mjs';
import { uploadImgbedImage } from './imgbed.mjs';

const modules = {
  dynamic: { root: 'src/content/dynamic' },
  notebooks: { root: 'src/content/life/notebooks' },
  places: { root: 'src/content/life/places' },
  routines: { root: 'src/content/life/routines' },
  friends: { file: 'src/data/friends.json' },
  navigation: { file: 'src/data/navigation.json' },
  gallery: { file: 'src/data/gallery.json' },
  sponsors: { file: 'src/data/sponsors.json' },
  feeds: { file: 'src/data/feeds.json' },
  sidebar: { file: 'src/data/sidebar.json' },
  announcements: { file: 'src/data/announcements.json' },
};
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const version = (buffer) => createHash('sha256').update(buffer).digest('hex');
const validPath = (value) => typeof value === 'string' && value.length < 220 && value.split('/').every(s => /^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u.test(s) && !s.includes('..'));
const webUrl = (value) => { try { return ['https:', 'http:'].includes(new URL(value).protocol); } catch { return false; } };
function validate(module, source) {
  if (typeof source !== 'string' || Buffer.byteLength(source) > 1024 * 1024) fail('内容不能为空或超过 1 MB');
  if (modules[module].file) {
    let items;
    try { items = JSON.parse(source); } catch { fail('JSON 格式错误'); }
    const objectConfig = ['sidebar', 'announcements'].includes(module);
    if (objectConfig && (!items || typeof items !== 'object' || Array.isArray(items))) fail('设置内容必须为 JSON 对象');
    if (!objectConfig && !Array.isArray(items)) fail('内容必须为 JSON 数组');
    if (module === 'friends') {
      const seen = new Set();
      const normalized = items.map(item => {
        const row = normalizeFriendDraft(item);
        const key = friendUrlKey(row.siteurl);
        if (seen.has(key)) fail('站点链接重复，请编辑已有友链');
        seen.add(key);
        return row;
      });
      return JSON.stringify(normalized, null, 2);
    }
    if (objectConfig) {
      if (module === 'announcements') {
        const normalized = normalizeAnnouncements(items);
        const error = validateAnnouncements(normalized);
        if (error) fail(error);
        return JSON.stringify(normalized, null, 2);
      } else if (items.position && !['left', 'right', 'both'].includes(items.position)) fail('侧栏位置无效');
      for (const key of ["leftComponents", "rightComponents", "mobileBottomComponents"]) if (key in items && !Array.isArray(items[key])) fail(`${key} 必须为数组`);
      return;
    }
    const ids = new Set();
    for (const item of items) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) fail('列表项必须为对象');
      for (const key of ['name','title','description','desc','imgurl','image','avatar','cover','location','date','amount']) if (key in item && typeof item[key] !== 'string') fail(`${key} 必须为字符串`);
      if ('tags' in item && (!Array.isArray(item.tags) || item.tags.some(tag=>typeof tag !== 'string'))) fail('tags 必须为字符串数组');
      if (module === 'navigation') {
        if (typeof item.category !== 'string' || !Array.isArray(item.items)) fail('导航需要 category 和 items');
        for (const link of item.items) {
          if (!link || typeof link.name !== 'string' || !link.name.trim() || !webUrl(link.url)) fail('导航链接需要名称和 HTTP(S) 地址');
          if (typeof link.description !== 'string' || typeof link.enabled !== 'boolean') fail('导航链接需要 description 和 enabled');
        }
      } else {
        const name = module === 'friends' ? item.title : item.name;
        if (typeof name !== 'string' || !name.trim()) fail('列表项需要名称');
        if (['friends', 'feeds'].includes(module) && !webUrl(module === 'friends' ? item.siteurl : item.url)) fail('链接必须为 HTTP(S) 地址');
        if (module === 'friends' && (typeof item.enabled !== 'boolean' || !Number.isFinite(item.weight))) fail('友链需要 enabled 布尔值和 weight 数字');
        if (module === 'gallery') {
          if (!validPath(item.id) || item.id.includes('/') || ids.has(item.id)) fail('相册 ID 必须唯一且为合法目录名');
          ids.add(item.id);
        }
      }
      for (const key of ['enabled', 'draft']) if (key in item && typeof item[key] !== 'boolean') fail(`${key} 必须为布尔值`);
    }
    return;
  }
  let data;
  try { data = matter(source).data; } catch { fail('Frontmatter 格式错误'); }
  for (const key of ['title','name','description','location','device','time','icon','province','city','experience','cover']) if (key in data && typeof data[key] !== 'string') fail(`${key} 必须为字符串`);
  for (const key of ['draft', 'pinned', 'comment']) if (key in data && typeof data[key] !== 'boolean') fail(`${key} 必须为布尔值`);
  for (const key of ['tags', 'photos']) if (key in data && (!Array.isArray(data[key]) || data[key].some(x => typeof x !== 'string'))) fail(`${key} 必须为字符串数组`);
  if (module === 'dynamic' && !data.published) fail('动态需要 published 日期');
  for (const key of ['published', 'date', 'updated', 'updatedAt']) if (key in data && !Number.isFinite(new Date(data[key]).getTime())) fail(`${key} 日期无效`);
  if (module !== 'dynamic' && !String(data.title || data.name || '').trim()) fail('需要 title 或 name');
  if (module === 'places') {
    for (const [key, limit] of [['lat',90],['lng',180]]) if (key in data && (!Number.isFinite(data[key]) || Math.abs(data[key]) > limit)) fail(`${key} 经纬度无效`);
    if (('lat' in data) !== ('lng' in data)) fail('经纬度必须同时填写');
  }
  if ('status' in data && !['todo','active','done'].includes(data.status)) fail('status 必须为 todo、active 或 done');
}

// Serializes local writes so two clients cannot both overwrite the same version.
const locks = new Map();
async function locked(key, action) {
  const previous = locks.get(key) || Promise.resolve();
  let release;
  const current = new Promise(resolve => { release = resolve; });
  locks.set(key, current);
  await previous;
  try { return await action(); } finally { release(); if (locks.get(key) === current) locks.delete(key); }
}
export function createLocalStore(root) {
  root = path.resolve(root);
  async function target(file) {
    if (!validPath(file)) fail('路径无效');
    const full = path.resolve(root, file);
    if (!full.startsWith(root + path.sep)) fail('路径越界');
    let current = root;
    for (const segment of file.split('/')) {
      current = path.join(current, segment);
      const stat = await fs.lstat(current).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
      if (stat?.isSymbolicLink()) fail('不允许符号链接路径');
    }
    return full;
  }
  const read = async file => {
    const full = await target(file);
    try { const bytes = await fs.readFile(full); return { source: bytes.toString('utf8'), version: version(bytes) }; }
    catch(error) { if(error.code === 'ENOENT') return null; throw error; }
  };
  return {
    read,
    async list(prefix) {
      const results = [];
      async function walk(dir, rel) {
        for(const item of await fs.readdir(dir, { withFileTypes: true }).catch(e => { if(e.code === 'ENOENT') return []; throw e; })) {
          if(item.name.startsWith('.') || item.isSymbolicLink()) continue;
          const file = `${rel}/${item.name}`;
          if(item.isDirectory()) await walk(path.join(dir,item.name),file);
          else if(item.isFile() && /\.mdx?$/.test(item.name)) results.push(file);
        }
      }
      await walk(await target(prefix),prefix);
      return results.sort();
    },
    async write(file, bytes, expected) {
      const resolved = path.resolve(root, file);
      const lockKey = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
      return locked(lockKey,async()=>{
        const previous = await read(file);
        if((previous?.version || null) !== expected) fail('版本冲突，请重新读取后合并',409);
        const full = await target(file);
        await fs.mkdir(path.dirname(full),{recursive:true});
        if(bytes === null) { await fs.unlink(full); return null; }
        const temporary = `${full}.${randomUUID()}.tmp`;
        try { await fs.writeFile(temporary,bytes); await fs.rename(temporary,full); }
        finally { await fs.rm(temporary,{force:true}); }
        return version(bytes);
      });
    },
  };
}

export function createGithubStore({request, repo, branch}) {
  const contents = file => `/repos/${repo}/contents/${file.split('/').map(encodeURIComponent).join('/')}`;
  async function checked(response) {
    if(response.status === 409 || response.status === 422) fail('版本冲突，请重新读取后合并',409);
    if(!response.ok) fail(`GitHub 请求失败（${response.status}）`,502);
    return response.json();
  }
  return {
    async read(file) {
      const response = await request(`${contents(file)}?ref=${encodeURIComponent(branch)}`);
      if(response.status === 404) return null;
      const data = await checked(response);
      if(data.type !== 'file' || data.size > 1024*1024) fail('文件类型或大小不支持');
      return {source:Buffer.from(data.content,'base64').toString('utf8'),version:data.sha};
    },
    async list(prefix) {
      const data = await checked(await request(`/repos/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`));
      if(data.truncated) fail('仓库目录过大，请通过 Git 管理内容',413);
      return data.tree.filter(x=>x.type==='blob' && x.path.startsWith(prefix+'/') && /\.mdx?$/.test(x.path)).map(x=>x.path).sort();
    },
    async write(file,bytes,expected) {
      const data = await checked(await request(contents(file), {method:bytes===null?'DELETE':'PUT',body:JSON.stringify({message:`${bytes===null?'删除':'保存'}内容：${file}`,branch,...(expected?{sha:expected}:{}),...(bytes===null?{}:{content:Buffer.from(bytes).toString('base64')})})}));
      return { version: data.content?.sha || null, commit: { sha: data.commit?.sha || '', url: data.commit?.html_url || '' } };
    },
  };
}

export async function executeContent(store,module,method,body={}) {
  const config = modules[module];
  if(!config) fail('未知内容模块',404);
  if(method === 'GET' && !body.file && !config.file) return {items:(await store.list(config.root)).map(file=>({file:file.slice(config.root.length+1)}))};
  const file = config.file ? 'list.json' : body.file;
  if(!validPath(file) || (!config.file && !/\.mdx?$/.test(file))) fail('路径无效，仅支持 Markdown 或 MDX 文件');
  const destination = config.file || `${config.root}/${file}`;
  const current = await store.read(destination);
  if(method === 'GET') { if(!current) fail('文件不存在',404); return {file,...current}; }
  if(!['POST','PUT','DELETE'].includes(method)) fail('不支持的请求方法',405);
  if(config.file && method !== 'PUT') fail('列表只能整体保存，清空请保存空数组');
  if(method === 'POST' ? Boolean(current) : (!current || !body.version || body.version !== current.version)) fail('版本冲突，请重新读取后合并',409);
  const source = method !== 'DELETE' ? validate(module,body.source) ?? body.source : null;
  const saved = await store.write(destination,source === null ? null : Buffer.from(source),current?.version || null);
  return {ok:true,file,...(saved && typeof saved === 'object' ? saved : {version:saved})};
}

export async function uploadContentImage(store,module,body) {
  if(!modules[module]) fail('未知模块',404);
  const match = /^data:image\/(png|jpeg|webp|gif|avif);base64,([A-Za-z0-9+/]+={0,2})$/.exec(body?.dataUrl || '');
  if(!match) fail('图片格式无效');
  const bytes = Buffer.from(match[2],'base64');
  if(!bytes.length || bytes.length > MAX_IMAGE_BYTES) fail('图片不能超过 3 MiB');
  if(module === 'friends') return uploadImgbedImage(bytes,{mimeType:`image/${match[1]}`,folder:'blog/friends/avatars'});
  let directory = `uploads/${module}`;
  if(module === 'gallery') {
    if(!validPath(body.album) || body.album.includes('/')) fail('请填写相册 ID');
    const albums = await store.read(modules.gallery.file);
    if(!albums || !JSON.parse(albums.source).some(x=>x.id===body.album)) fail('请先保存相册元数据');
    directory = `gallery/${body.album}`;
  }
  const file = `${directory}/${randomUUID()}.${match[1]==='jpeg'?'jpg':match[1]}`;
  await store.write(`public/${file}`,bytes,null);
  return {image:`/${file}`};
}
