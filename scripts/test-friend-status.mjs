import assert from 'node:assert/strict';
import { test } from 'node:test';

const api = await import('../api/_lib/friend-status.mjs').catch(()=>({}));
const report = { schemaVersion:1, checkedAt:'2026-10-05T02:00:00.000Z', results:[{title:'Friend',url:'https://example.test/',status:'ok',checkedAt:'2026-10-05T02:00:00.000Z',httpStatus:200,latencyMs:250,backlink:'found',screenshotUrl:'https://cdn.example.test/s.png',screenshotAt:'2026-10-05T02:00:00.000Z',token:'private'}],token:'private' };
test('public status service reads a fixed GitHub branch and path while caching and coalescing requests',async()=>{
  assert.equal(typeof api.createFriendStatusService,'function');
  let calls=0;
  let now=0;
  const service=api.createFriendStatusService({
    env:{WRITING_GITHUB_REPO:'owner/blog',GITHUB_TOKEN:'test-only-token'},now:()=>now,
    fetcher:async(url,init)=>{
      calls++;
      assert.equal(url,'https://api.github.com/repos/owner/blog/contents/reports/friend-links.json?ref=master');
      assert.equal(init.headers.Authorization,'Bearer test-only-token');
      assert.equal(init.redirect,'error');
      return Response.json({type:'file',size:JSON.stringify(report).length,content:Buffer.from(JSON.stringify(report)).toString('base64')});
    },
  });
  const [a,b]=await Promise.all([service.read(),service.read()]);
  assert.equal(calls,1);
  assert.deepEqual(a,b);
  assert.equal(a.token,undefined);
  assert.equal(a.results[0].token,undefined);
  now=299999;
  await service.read();
  assert.equal(calls,1);
  now=300001;
  await service.read();
  assert.equal(calls,2);
});
test('public status sanitizer strips secrets, rejects unsafe links and converts invalid field values to unknown',()=>{
  assert.equal(typeof api.sanitizeFriendStatus,'function');
  const clean=api.sanitizeFriendStatus({...report,results:[
    {...report.results[0],url:'javascript:alert(1)'},
    {...report.results[0],url:'http://127.0.0.1/'},
    {...report.results[0],status:'lie',backlink:'lie',httpStatus:'200',latencyMs:-1,screenshotUrl:'javascript:alert(1)',checkedAt:'invalid',screenshotAt:'invalid'},
  ]});
  assert.equal(clean.results.length,1);
  assert.equal(clean.schemaVersion,1);
  assert.equal(clean.token,undefined);
  assert.deepEqual(clean.results[0],{title:'Friend',url:'https://example.test/',status:'unknown',checkedAt:null,httpStatus:null,latencyMs:null,backlink:'unknown',screenshotUrl:null,screenshotAt:null});
  assert.deepEqual(api.sanitizeFriendStatus({}),{schemaVersion:1,checkedAt:null,results:[]});
});
test('missing GitHub report yields unchecked data while upstream failures retain last successful report',async()=>{
  assert.equal(typeof api.createFriendStatusService,'function');
  let upstreamStatus=404;
  let now=0;
  const service=api.createFriendStatusService({env:{WRITING_GITHUB_REPO:'owner/blog',GITHUB_TOKEN:'test-only-token'},now:()=>now,fetcher:async()=>upstreamStatus===200?Response.json({type:'file',size:JSON.stringify(report).length,content:Buffer.from(JSON.stringify(report)).toString('base64')}):new Response(null,{status:upstreamStatus})});
  assert.deepEqual(await service.read(),{schemaVersion:1,checkedAt:null,results:[]});
  now=300001;upstreamStatus=200;
  const saved=await service.read();
  now=600002;upstreamStatus=503;
  assert.deepEqual(await service.read(),saved);
});
test('status service rejects repository omissions and failures with a safe static message',async()=>{
  assert.equal(typeof api.createFriendStatusService,'function');
  const fail=()=>assert.fail('Invalid config never contacts GitHub');
  for (const env of [{},{WRITING_GITHUB_REPO:'../../private',GITHUB_TOKEN:'test-only-token'}]) {
    await assert.rejects(()=>api.createFriendStatusService({env,fetcher:fail}).read(),error=>error.status===503);
  }
  const service=api.createFriendStatusService({env:{VERCEL_GIT_REPO_OWNER:'owner',VERCEL_GIT_REPO_SLUG:'blog',GITHUB_TOKEN:'test-only-token'},fetcher:async()=>new Response('test-only-token',{status:403})});
  await assert.rejects(()=>service.read(),error=>error.status===503 && !error.message.includes('test-only-token'));
});
test('Vercel public friend-status endpoint supports fetch and Node requests without arbitrary query routing',async()=>{
  const {default:handler}=await import('../api/friend-status.js').catch(()=>({}));
  assert.equal(typeof handler,'function');
  const response=await handler(new Request('https://example.test/api/friend-status/?url=http://127.0.0.1',{method:'POST'}));
  assert.equal(response.status,405);
  assert.equal(response.headers.get('allow'),'GET');
  let body;
  const res={setHeader(){},end(value){body=value;}};
  await handler({url:'/api/friend-status',method:'POST',headers:{}},res);
  assert.equal(res.statusCode,405);
  assert.match(JSON.parse(body).error,/GET/);
});
