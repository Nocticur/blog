import fs from "node:fs/promises";
import { friendsConfig } from "../src/config/friendsConfig";

const results: {title:string; url:string; ok:boolean; detail:string}[] = [];
for (const friend of friendsConfig.filter(friend => friend.enabled && friend.siteurl)) {
  try {
    const response = await fetch(friend.siteurl,{redirect:"follow",signal:AbortSignal.timeout(10000)});
    await response.body?.cancel();
    results.push({title:friend.title,url:friend.siteurl,ok:response.ok,detail:`HTTP ${response.status}`});
  } catch(error) {
    results.push({title:friend.title,url:friend.siteurl,ok:false,detail:error instanceof Error?error.message:String(error)});
  }
}
await fs.mkdir("reports",{recursive:true});
await fs.writeFile("reports/friend-links.json",JSON.stringify({checkedAt:new Date().toISOString(),results},null,2));
const failures=results.filter(result=>!result.ok);
const summary=`检查 ${results.length} 个友链，失败 ${failures.length} 个。仅生成报告，不修改友链。\n`;
console.log(summary);
if(process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY,summary);
if(failures.length) { console.error(failures); process.exitCode=1; }
