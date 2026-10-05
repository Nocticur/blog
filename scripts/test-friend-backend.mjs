import assert from 'node:assert/strict';
import { test, afterEach, mock } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createLocalStore, executeContent, uploadContentImage } from '../api/_lib/content-management.mjs';
import { writingDevApi } from '../src/lib/writing-dev-api.mjs';
import writingHandler from '../api/writing/[[...path]].js';

const originalEnv = { ...process.env };
afterEach(() => {
  mock.restoreAll();
  for (const key of ['WRITING_PASSWORD','WRITING_PASSWORD_HASH','WRITING_GITHUB_REPO','WRITING_GITHUB_BRANCH','GITHUB_TOKEN','GH_TOKEN','IMGBED_BASE_URL','IMGBED_API_TOKEN']) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});
const friend = { title: '番茄主理人', desc: '躬身入局，心为主理，行有尺度，自持本心。', siteurl: 'https://blog.fqzlr.top/', imgurl: 'https://q1.qlogo.cn/g?b=qq&nk=20447289&s=640' };
test('friend conflict rebase applies only edited fields onto the latest repository row', async () => {
  const { saveFriendRow } = await import('../src/utils/friend-editor.ts');
  const { friendUrlKey } = await import('../src/utils/friend-data.mjs');
  const baseline = { ...friend, enabled: true, weight: 5, tags: ['旧'], image: '', linkpage: '', extension: { old: 1 } };
  const latest = { ...baseline, enabled: false, weight: 9, tags: ['新'], extension: { new: 1 } };
  const draft = { ...baseline, desc: '本次修改', siteurl: 'https://new.example/' };
  const [rebased] = saveFriendRow([latest], draft, friendUrlKey(friend.siteurl), true, baseline);
  assert.deepEqual(rebased, { ...latest, desc: draft.desc, siteurl: draft.siteurl });
  assert.throws(() => saveFriendRow([], draft, friendUrlKey(friend.siteurl), true, baseline), /删除或更改/);
});
async function withStore(action) {
  const root = await mkdtemp(path.join(tmpdir(), 'friend-backend-'));
  try {
    await mkdir(path.join(root,'src/data'),{recursive:true});
    await writeFile(path.join(root,'src/data/friends.json'),'[]');
    const store = createLocalStore(root);
    await action(store,await executeContent(store,'friends','GET'),root);
  } finally { await rm(root,{recursive:true,force:true}); }
}
test('four friend fields save with defaults and preserve custom metadata on subsequent edits', async () => {
  await withStore(async (store,current) => {
    await executeContent(store,'friends','PUT',{version:current.version,source:JSON.stringify([{...friend,custom:{keep:true},linkpage:'https://blog.fqzlr.top/friends/'}])});
    const saved = await executeContent(store,'friends','GET');
    const row = JSON.parse(saved.source)[0];
    assert.equal(row.enabled,true);
    assert.equal(row.weight,5);
    assert.deepEqual(row.custom,{keep:true});
    assert.equal(row.imgurl,friend.imgurl);
    await executeContent(store,'friends','PUT',{version:saved.version,source:JSON.stringify([{...row,title:'Updated',enabled:false,weight:2,tags:['旧标签'],cover:'/assets/cover.png'}])});
    const edited = JSON.parse((await executeContent(store,'friends','GET')).source)[0];
    assert.equal(edited.enabled,false);
    assert.equal(edited.weight,2);
    assert.deepEqual(edited.tags,['旧标签']);
    assert.deepEqual(edited.custom,{keep:true});
  });
});
test('friend validation rejects empty required fields, unsafe images and duplicate normalized URLs', async () => {
  await withStore(async (store,current) => {
    const put = rows => executeContent(store,'friends','PUT',{version:current.version,source:JSON.stringify(rows)});
    for (const field of ['title','desc','siteurl','imgurl']) {
      await assert.rejects(()=>put([{...friend,enabled:true,weight:5,[field]:'   '}]), error=>error.status===400,field);
    }
    for (const image of ['javascript:alert(1)','data:image/svg+xml,bad','//evil.test/a.png','/../../secret.png']) {
      await assert.rejects(()=>put([{...friend,enabled:true,weight:5,imgurl:image}]), error=>error.status===400,image);
    }
    await assert.rejects(()=>put([
      {...friend,enabled:true,weight:5},
      {...friend,title:'Duplicate',enabled:true,weight:5,siteurl:'https://BLOG.fqzlr.top:443/#same'},
    ]),/重复/);
    for (const linkpage of ['https://other.test/friends/','http://127.0.0.1/friends/','javascript:alert(1)']) {
      await assert.rejects(()=>put([{...friend,enabled:true,weight:5,linkpage}]),error=>error.status===400,linkpage);
    }
    for (const field of ['enabled','weight']) await assert.rejects(()=>put([{...friend,enabled:true,weight:5,[field]:null}]),error=>error.status===400,field);
    await assert.rejects(()=>put([{...friend,image:'javascript:alert(1)'}]),error=>error.status===400);
  });
});
test('shared normalization retains query parameters and existing advanced fields', async () => {
  const api = await import('../src/utils/friend-data.mjs').catch(()=>({}));
  assert.equal(typeof api.normalizeFriendDraft,'function');
  assert.equal(api.friendUrlKey('https://EXAMPLE.test:443/path/?a=1#anchor'),'https://example.test/path?a=1');
  assert.notEqual(api.friendUrlKey('https://example.test/?a=1'),api.friendUrlKey('https://example.test/?a=2'));
  const normalized = api.normalizeFriendDraft(friend,{enabled:false,weight:9,tags:['旧'],custom:42,cover:'/assets/cover.png'});
  assert.equal(normalized.enabled,false);
  assert.equal(normalized.weight,9);
  assert.equal(normalized.custom,42);
  assert.deepEqual(normalized.tags,['旧']);
  assert.equal(normalized.cover,'/assets/cover.png');
  assert.equal(api.normalizeFriendDraft({...friend,imgurl:'/assets/avatar.png'}).imgurl,'/assets/avatar.png');
});
function configureImgbed() {
  process.env.IMGBED_BASE_URL = 'https://image.nocticur.eu.cc';
  process.env.IMGBED_API_TOKEN = 'test-only-imgbed-token';
}
test('friend image uploads use multipart Cloudflare ImgBed and prefer publicUrl without repository writes', async () => {
  configureImgbed();
  let requested;
  mock.method(globalThis,'fetch',async(url,init)=>{
    requested = {url:new URL(url),init};
    return Response.json([{src:'/file/internal.png',publicUrl:'https://cdn.example.test/avatar.png'}]);
  });
  const result = await uploadContentImage({write(){assert.fail('Friend images must not be committed to GitHub');}},'friends',{dataUrl:'data:image/png;base64,aGVsbG8='});
  assert.equal(result.image,'https://cdn.example.test/avatar.png');
  assert.equal(requested.url.origin,'https://image.nocticur.eu.cc');
  assert.equal(requested.url.pathname,'/upload');
  assert.equal(requested.url.searchParams.get('returnFormat'),'full');
  assert.equal(requested.url.searchParams.get('uploadFolder'),'blog/friends/avatars');
  assert.equal(requested.init.headers.Authorization,'Bearer test-only-imgbed-token');
  assert.equal(requested.init.redirect,'error');
  const file = requested.init.body.get('file');
  assert.equal(file.type,'image/png');
  assert.equal(await file.text(),'hello');
});
test('friend uploads fall back to absolute src and keep upstream credentials out of error messages', async () => {
  configureImgbed();
  const store = {write(){assert.fail('No friend image repository writes');}};
  const body = {dataUrl:'data:image/png;base64,aGVsbG8='};
  let uploadStatus = 200;
  mock.method(globalThis,'fetch',async()=>uploadStatus === 200 ? Response.json([{publicUrl:'javascript:alert(1)',src:'/file/avatar.png'}]) : new Response('test-only-imgbed-token',{status:401}));
  assert.equal((await uploadContentImage(store,'friends',body)).image,'https://image.nocticur.eu.cc/file/avatar.png');
  uploadStatus = 401;
  await assert.rejects(()=>uploadContentImage(store,'friends',body),error=>error.status===502 && /认证|鉴权/.test(error.message) && !error.message.includes('test-only-imgbed-token'));
  delete process.env.IMGBED_API_TOKEN;
  await assert.rejects(()=>uploadContentImage(store,'friends',body),error=>error.status===503);
});
test('oversized and invalid friend uploads never call upstream', async () => {
  configureImgbed();
  mock.method(globalThis,'fetch',()=>assert.fail('Invalid image must not be uploaded'));
  const store = {write(){assert.fail('Invalid image must not be written');}};
  await assert.rejects(()=>uploadContentImage(store,'friends',{dataUrl:`data:image/png;base64,${Buffer.alloc(3*1024*1024+1).toString('base64')}`}),/3 MiB/);
  await assert.rejects(()=>uploadContentImage(store,'friends',{dataUrl:'data:image/svg+xml;base64,aGVsbG8='}),/格式/);
});
test('invalid publicUrl text falls back to src rather than becoming an invented image path', async () => {
  configureImgbed();
  mock.method(globalThis,'fetch',async()=>Response.json([{publicUrl:'not a URL',src:'/file/actual.png'}]));
  const result = await uploadContentImage(null,'friends',{dataUrl:'data:image/png;base64,aGVsbG8='});
  assert.equal(result.image,'https://image.nocticur.eu.cc/file/actual.png');
});
test('deployed friend image endpoint requires a session but not a GitHub repository or token', async () => {
  configureImgbed();
  process.env.WRITING_PASSWORD = 'friend-api-password';
  delete process.env.WRITING_PASSWORD_HASH;
  delete process.env.GITHUB_TOKEN;
  delete process.env.GH_TOKEN;
  delete process.env.WRITING_GITHUB_REPO;
  const auth = await writingHandler(new Request('https://example.test/api/writing/auth',{method:'POST',headers:{origin:'https://example.test'},body:JSON.stringify({password:'friend-api-password'})}));
  const cookie = auth.headers.get('set-cookie').split(';')[0];
  mock.method(globalThis,'fetch',async()=>Response.json([{src:'/file/avatar.png'}]));
  const send = headers => writingHandler(new Request('https://example.test/api/writing/content/friends/images/',{method:'POST',headers:{origin:'https://example.test',...headers},body:JSON.stringify({dataUrl:'data:image/png;base64,aGVsbG8='})}));
  assert.equal((await send({})).status,401);
  const result = await send({cookie});
  assert.equal(result.status,200);
  assert.equal((await result.json()).image,'https://image.nocticur.eu.cc/file/avatar.png');
});
test('local public friend-status endpoint reads only the fixed report with sanitized output', async () => {
  const root = await mkdtemp(path.join(tmpdir(),'friend-public-status-'));
  try {
    await mkdir(path.join(root,'reports'),{recursive:true});
    await writeFile(path.join(root,'reports/friend-links.json'),JSON.stringify({schemaVersion:1,checkedAt:'2026-10-05T02:00:00.000Z',token:'private',results:[{url:friend.siteurl,title:friend.title,status:'ok',checkedAt:'2026-10-05T02:00:00.000Z',httpStatus:200,latencyMs:10,backlink:'unchecked',screenshotUrl:'https://image.nocticur.eu.cc/file/s.png',screenshotAt:'2026-10-05T02:00:00.000Z',secret:'private'}]}));
    const middlewares = new Map();
    writingDevApi(root,{preview:true}).configureServer({middlewares:{use(prefix,handler){middlewares.set(prefix,handler);}},watcher:{emit(){}}});
    assert.equal(typeof middlewares.get('/api/friend-status'),'function','Public status middleware is registered');
    const server = http.createServer((req,res)=>{req.url=req.url.replace(/^\/api\/friend-status/,'');middlewares.get('/api/friend-status')(req,res);});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    try {
      const url = `http://127.0.0.1:${server.address().port}/api/friend-status/?url=http://127.0.0.1&repo=evil/repo&file=secret.json`;
      const response = await fetch(url);
      assert.equal(response.status,200);
      const data = await response.json();
      assert.equal(data.results[0].title,friend.title);
      assert.equal(data.token,undefined);
      assert.equal(data.results[0].secret,undefined);
      assert.equal((await fetch(url,{method:'POST'})).status,405);
    } finally { await new Promise(resolve=>server.close(resolve)); }
  } finally { await rm(root,{recursive:true,force:true}); }
});
