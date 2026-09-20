import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import matter from 'gray-matter';
import {buildMarkdown,verifyPassword,verifySession} from '../src/lib/writing-server.mjs';
import {createLocalStore,createGithubStore,executeContent} from '../api/_lib/content-management.mjs';
test('GitHub adapter preserves revision checks and sends branch and SHA',async()=>{
 const requests=[];
 const store=createGithubStore({repo:'owner/repo',branch:'main',request:async(url,init)=>{
  requests.push({url,init});
  if(!init)return Response.json({type:'file',size:2,sha:'revision',content:Buffer.from('[]').toString('base64')});
  return new Response('{}',{status:409});
 }});
 await assert.rejects(()=>executeContent(store,'feeds','PUT',{source:'[]',version:'stale'}),/冲突/);
 assert.equal(requests.length,1);
 await assert.rejects(()=>executeContent(store,'feeds','PUT',{source:'[]',version:'revision'}),/冲突/);
 const payload=JSON.parse(requests.at(-1).init.body);
 assert.equal(payload.sha,'revision');assert.equal(payload.branch,'main');
});
test('lists use existing friend fields; invalid URLs and simultaneous writes are rejected',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'blog-list-test-'));
 try{
  const store=createLocalStore(root);
  await fs.mkdir(path.join(root,'src/data'),{recursive:true});
  await fs.writeFile(path.join(root,'src/data/friends.json'),'[]');
  const read=await executeContent(store,'friends','GET');
  const source=JSON.stringify([{title:'friend',siteurl:'https://example.test',imgurl:'',desc:'',enabled:true,weight:5}]);
  await assert.rejects(()=>executeContent(store,'friends','PUT',{source:source.replace('https://example.test','javascript:alert(1)'),version:read.version}),/HTTP/);
  const results=await Promise.allSettled([1,2].map(()=>executeContent(store,'friends','PUT',{source,version:read.version})));
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(JSON.parse((await executeContent(store,'friends','GET')).source)[0].title,'friend');
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('writing requires explicit credentials and preserves custom fields',()=>{
 assert.equal(verifyPassword('firefly',{}),false);
 assert.equal(verifySession('forged.token',{}),false);
 const data=matter(buildMarkdown({title:'changed',published:'2026-09-19'},'body',{password:'secret',comment:false,custom:{keep:true},lang:'zh-CN'})).data;
 assert.equal(data.password,'secret');
 assert.equal(data.comment,false);
 assert.deepEqual(data.custom,{keep:true});
 assert.equal(data.lang,'zh-CN');
});

test('content management supports versions and rejects traversal before writing', async () => {
  const api = await import('../api/_lib/content-management.mjs').catch(() => ({}));
  assert.equal(typeof api.createLocalStore, 'function', 'local content adapter is implemented');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'blog-content-test-'));
  try {
    const store = api.createLocalStore(root);
    await assert.rejects(() => api.executeContent(store, 'dynamic', 'POST', { file: '../bad.md', source: 'bad' }), /路径/);
    const source = '---\npublished: 2026-09-19\ndraft: true\n---\nDraft text';
    const saved = await api.executeContent(store, 'dynamic', 'POST', { file: 'hello.md', source });
    const read = await api.executeContent(store, 'dynamic', 'GET', { file: 'hello.md' });
    assert.equal(read.source, source);
    assert.equal(read.version, saved.version);
    await assert.rejects(() => api.executeContent(store, 'dynamic', 'PUT', { file: 'hello.md', source, version: 'stale' }), /冲突/);
    await assert.rejects(() => api.executeContent(store, 'dynamic', 'PUT', { file: 'hello.md', source: '---\npublished: invalid\n---', version: read.version }), /日期/);
    await api.executeContent(store, 'dynamic', 'DELETE', { file: 'hello.md', version: read.version });
    assert.deepEqual((await api.executeContent(store, 'dynamic', 'GET', {})).items, []);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
