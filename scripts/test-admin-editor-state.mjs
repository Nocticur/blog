import test from 'node:test';
import assert from 'node:assert/strict';

const state = await import('../src/utils/admin-editor-state.ts').catch(() => ({}));
const memory = () => {
  const values = new Map();
  return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key),key:index=>[...values.keys()][index]??null,get length(){return values.size;}};
};

test('local editor buffer restores exact text, attributes and originally read version after reload', () => {
  assert.equal(typeof state.saveLocalBuffer, 'function', 'local edit buffering is implemented');
  const storage = memory();
  const value = {file:'hello.mdx',version:'read-v1',originalDraft:false,form:{title:'changed',draft:true},tags:['标签'],content:'未提交正文\n<Component />'};
  assert.deepEqual(state.saveLocalBuffer(storage,'posts:editor',value),{ok:true});
  assert.deepEqual(state.loadLocalBuffer(storage,'posts:editor').value,value);
  state.removeLocalBuffer(storage,'posts:editor');
  assert.equal(state.loadLocalBuffer(storage,'posts:editor').value,null);
});

test('storage failures and malformed buffers are reported without claiming a successful local save', () => {
  assert.equal(typeof state.saveLocalBuffer, 'function');
  const denied = {getItem(){throw Error('denied');},setItem(){throw Error('quota');},removeItem(){throw Error('denied');}};
  assert.equal(state.saveLocalBuffer(denied,'post',{content:'keep'}).ok,false);
  assert.equal(state.loadLocalBuffer(denied,'post').value,null);
  assert.ok(state.loadLocalBuffer(denied,'post').error);
  const storage=memory();storage.setItem('blog-admin-buffer:v1:post','broken-json');
  assert.equal(state.loadLocalBuffer(storage,'post').value,null);
  assert.ok(state.loadLocalBuffer(storage,'post').error);
});

test('saving published modifications retains published state and uses the read version', () => {
  assert.equal(typeof state.buildPostMutation,'function','article writes use an editor revision');
  const editor={file:'hello.md',version:'read-v1',originalDraft:false,form:{title:'changed',draft:true},tags:[],content:'unsent changes'};
  const body=state.buildPostMutation(editor,'save');
  assert.equal(body.version,'read-v1');assert.equal(body.file,'hello.md');assert.equal(body.draft,false);
  assert.equal(editor.form.draft,true,'building a request does not discard local input');
  assert.throws(()=>state.buildPostMutation({...editor,version:''},'save'),/版本/);
});

test('new articles save as drafts and publishing or withdrawing is explicit', () => {
  assert.equal(typeof state.buildPostMutation,'function');
  const fresh={file:null,version:'',originalDraft:true,form:{title:'new',draft:false},tags:[],content:'new text'};
  assert.equal(state.buildPostMutation(fresh,'save').draft,true);
  assert.equal(state.buildPostMutation(fresh,'publish').draft,false);
  assert.equal(state.buildPostMutation({...fresh,file:'existing.md',version:'v1',originalDraft:false},'withdraw').draft,true);
});

test('article deletion includes the list revision and refuses an absent revision', () => {
  assert.equal(typeof state.postDeleteUrl,'function');
  const url=new URL(state.postDeleteUrl('nested/file.mdx','version+/='),'https://example.test');
  assert.equal(url.searchParams.get('file'),'nested/file.mdx');assert.equal(url.searchParams.get('version'),'version+/=');
  assert.throws(()=>state.postDeleteUrl('file.md',''),/版本/);
});

test('two tabs keep separate recoverable edit buffers while reload reuses the same tab buffer', () => {
  assert.equal(typeof state.getTabBufferKey,'function','tab edit buffers are isolated');
  const shared=memory(),firstTab=memory(),secondTab=memory();
  const first=state.getTabBufferKey(firstTab,'posts:editor'),second=state.getTabBufferKey(secondTab,'posts:editor');
  assert.notEqual(first,second);
  state.saveLocalBuffer(shared,first,{content:'tab A',version:'v1'});
  state.saveLocalBuffer(shared,second,{content:'tab B',version:'v1'});
  assert.equal(state.getTabBufferKey(firstTab,'posts:editor'),first);
  assert.equal(state.loadLocalBuffer(shared,first).value.content,'tab A');
  assert.equal(state.loadLocalBuffer(shared,second).value.content,'tab B');
});

test('duplicating a tab copies its existing draft into a new local scope without changing the original', () => {
  const shared=memory(),original=memory();
  const first=state.getTabBufferKey(original,'posts:editor');
  state.saveLocalBuffer(shared,first,{content:'recoverable draft',version:'read-v1'});
  const duplicated=memory();duplicated.setItem('blog-admin-editor-tab',original.getItem('blog-admin-editor-tab'));
  const next=state.getTabBufferKey(duplicated,'posts:editor',{navigationType:'navigate',buffers:shared});
  assert.notEqual(next,first,'a new document cannot share the original tab scope');
  assert.equal(state.loadLocalBuffer(shared,next).value.content,'recoverable draft');
  state.saveLocalBuffer(shared,next,{content:'duplicate edits',version:'read-v1'});
  assert.equal(state.loadLocalBuffer(shared,first).value.content,'recoverable draft');
  const reload=memory();reload.setItem('blog-admin-editor-tab',duplicated.getItem('blog-admin-editor-tab'));
  assert.equal(state.getTabBufferKey(reload,'posts:editor',{navigationType:'reload',buffers:shared}),next);
});
