<script lang="ts">
 import {Solar} from "lunar-typescript";
 import {onMount} from "svelte";
 export let events:{date:string;title:string;type:string;note?:string;url?:string}[]=[];
 export let initialMonth:string;
 export let minYear:number;
 export let maxYear:number;
 let month=initialMonth, selected="";
 const key=(date:Date)=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
 $: [year,number]=month.split("-").map(Number);
 $: start=new Date(year,number-1,1).getDay();
 $: count=new Date(year,number,0).getDate();
 $: cells=Array.from({length:Math.ceil((start+count)/7)*7},(_,index)=>index<start||index>=start+count?0:index-start+1);
 $: dayKey=(day:number)=>`${month}-${String(day).padStart(2,"0")}`;
 $: chosen=events.filter(event=>event.date===selected);
 $: upcoming=events.filter(event=>event.date>=(selected||month+"-01")).slice(0,12);
 const lunar=(day:number)=>Solar.fromYmd(year,number,day).getLunar().getDayInChinese();
 function move(step:number){const date=new Date(year,number-1+step,1);if(date.getFullYear()<minYear||date.getFullYear()>maxYear)return;month=key(date).slice(0,7);selected="";}
 function today(){const date=new Date();month=key(date).slice(0,7);selected=key(date);}
 onMount(today);
</script>
<div class="flex flex-wrap items-center justify-between gap-3 mb-6">
 <h1 class="text-2xl font-semibold">{year} 年 {number} 月</h1>
 <div class="flex flex-wrap gap-2">
  <button aria-label="上个月" onclick={()=>move(-1)} disabled={month===`${minYear}-01`}>上一月</button>
  <label class="sr-only" for="calendar-month">选择月份</label>
  <input id="calendar-month" type="month" min={`${minYear}-01`} max={`${maxYear}-12`} value={month} onchange={event=>{const value=event.currentTarget.value;if(value && +value.slice(0,4)>=minYear && +value.slice(0,4)<=maxYear){month=value;selected="";}}}/>
  <button aria-label="下个月" onclick={()=>move(1)} disabled={month===`${maxYear}-12`}>下一月</button>
  <button onclick={today}>今天</button>
 </div>
</div>
<div class="grid grid-cols-7 gap-1 sm:gap-2">
 {#each ["日","一","二","三","四","五","六"] as label}<span class="text-center text-sm p-2">{label}</span>{/each}
 {#each cells as day}
  {#if day}
   {@const date=dayKey(day)}
   {@const daily=events.filter(event=>event.date===date)}
   <button class="day text-left min-w-0" aria-pressed={selected===date} aria-label={`${date}，${daily.length} 项事件`} onclick={()=>selected=date}>
    <span>{day}</span><span class="block text-[10px] opacity-60">{lunar(day)}</span>
    {#if daily.length}<span class="mt-1 block text-[10px] truncate" title={daily.map(item=>item.title).join("、")}>{daily[0].title}{daily.length>1?` +${daily.length-1}`:""}</span>{/if}
   </button>
  {:else}<span></span>{/if}
 {/each}
</div>
<section class="mt-6" aria-live="polite">
 <h2 class="text-lg font-medium">{selected || "选择日期查看详情"}</h2>
 {#if selected && !chosen.length}<p class="my-3 text-sm text-neutral-500">这一天没有记录。</p>{/if}
 {#each chosen as event}<article class="border-b border-neutral-500/20 py-3"><span class="text-xs opacity-60">{event.type}</span><p>{#if event.url}<a class="underline" href={event.url}>{event.title}</a>{:else}{event.title}{/if}</p>{#if event.note}<p class="text-sm opacity-70">{event.note}</p>{/if}</article>{/each}
</section>
<section class="mt-6"><h2 class="text-lg font-medium">接下来的事件</h2><ul class="mt-3 space-y-2">{#each upcoming as event}<li class="text-sm"><button class="text-left" onclick={()=>{selected=event.date;month=event.date.slice(0,7);}}>{event.date} · {event.title}</button></li>{/each}</ul></section>
<style>button,input{border:1px solid #8885;border-radius:.5rem;padding:.4rem .65rem;background:transparent;color:inherit}button:disabled{opacity:.4}.day{min-height:5.5rem;padding:.4rem}.day[aria-pressed="true"]{outline:2px solid var(--primary)}@media(min-width:640px){.day{min-height:7rem;padding:.7rem}}</style>
