import {parseFeedItems} from "./feature-data";
import type {PengyouFeed} from "../config/pengyouConfig";
export async function fetchCircle(feeds:PengyouFeed[], fetcher:typeof fetch=fetch) {
 const results: (ReturnType<typeof parseFeedItems>[number] & {author:string;avatar?:string})[]=[];
 const active=feeds.filter(feed=>feed.enabled!==false && /^https?:\/\//i.test(feed.url)).slice(0,100);
 for(let start=0;start<active.length;start+=4){
  const batch=await Promise.all(active.slice(start,start+4).map(async feed=>{
   try {
    const response=await fetcher(feed.url,{signal:AbortSignal.timeout(5000)});
    if(!response.ok || !response.body) {await response.body?.cancel();return [];}
    const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
    try {for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2*1024*1024)throw new Error("Feed too large");chunks.push(value);}}
    finally{await reader.cancel().catch(()=>{});}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    return parseFeedItems(new TextDecoder().decode(bytes)).slice(0,100).map(item=>({...item,author:feed.name,avatar:feed.avatar}));
   }catch{console.warn(`[circle] 订阅获取失败：${feed.name}`);return [];}
  }));results.push(...batch.flat());
 }
 const seen=new Set<string>();
 return results.sort((a,b)=>b.date.localeCompare(a.date)).filter(item=>{if(seen.has(item.link))return false;seen.add(item.link);return true;});
}
