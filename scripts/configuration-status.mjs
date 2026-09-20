import fs from "node:fs";
const local={};
for(const file of [".env",".env.local",".env.development",".env.development.local"]){
 if(!fs.existsSync(file))continue;
 for(const line of fs.readFileSync(file,"utf8").split(/\r?\n/)){
  const match=line.match(/^\s*(?:export\s+)?([A-Za-z_]\w*)\s*=\s*(.*?)\s*$/);
  if(match){let value=match[2];if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'")))value=value.slice(1,-1);local[match[1]]=value;}
 }
}
Object.assign(local,process.env);
const present=name=>Boolean(local[name]?.trim());
console.log("仅显示本机配置状态，不输出配置值；线上环境需另外填写。");
console.table({
 "后台密码（二选一）":present("WRITING_PASSWORD")||present("WRITING_PASSWORD_HASH")?"已配置":"待填写",
 "GitHub 提交凭据":present("GITHUB_TOKEN")||present("GH_TOKEN")?"已配置":"待填写（线上保存需要）",
 "独立会话密钥":present("WRITING_SESSION_SECRET")?"已配置":"可选，未填则从密码派生",
 "目标仓库":present("WRITING_GITHUB_REPO")?"已配置":"自动从 Git / Vercel 推导",
 "目标分支":present("WRITING_GITHUB_BRANCH")?"已配置":"使用仓库默认分支",
});
for(const name of ["friends","feeds","sponsors","schedules"]){
 const items=JSON.parse(fs.readFileSync(`src/data/${name}.json`,"utf8"));
 console.log(`${name}: ${items.length} 条（空列表可稍后添加）`);
}
