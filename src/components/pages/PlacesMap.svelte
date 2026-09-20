<script lang="ts">
 import {onMount} from "svelte";
 import {geoNaturalEarth1,geoPath,select,zoom,zoomIdentity,type ZoomBehavior} from "d3";
 export let places:{id:string;name:string;lat:number|null;lng:number|null}[]=[];
 let svg:SVGSVGElement, layer:SVGGElement, message="正在加载地图";
 let behavior:ZoomBehavior<SVGSVGElement,unknown>;
 const projection=geoNaturalEarth1().fitSize([900,460],{type:"Sphere"});
 const project=(lng:number,lat:number)=>projection([lng,lat]) || [0,0];
 let land="";
 onMount(()=>{
  const controller=new AbortController();
  fetch("/maps/world-land.geojson",{signal:controller.signal}).then(r=>{if(!r.ok)throw new Error();return r.json();})
   .then(data=>{land=geoPath(projection)(data)||"";message="拖动地图或使用缩放按钮查看足迹";})
   .catch(()=>{if(!controller.signal.aborted)message="地图暂不可用，仍可查看下方足迹列表";});
  behavior=zoom<SVGSVGElement,unknown>().scaleExtent([1,8]).extent([[0,0],[900,460]])
    .translateExtent([[-200,-100],[1100,560]]).on("zoom",event=>select(layer).attr("transform",event.transform));
  select(svg).call(behavior).on("wheel.zoom",null);
  return ()=>{controller.abort();select(svg).on(".zoom",null);};
 });
 const scale=(factor:number)=>select(svg).call(behavior.scaleBy,factor);
</script>
<div class="rounded-2xl border border-neutral-500/20 overflow-hidden">
 <div class="flex items-center gap-2 p-3">
  <button aria-label="放大地图" onclick={()=>scale(1.5)}>＋</button>
  <button aria-label="缩小地图" onclick={()=>scale(1/1.5)}>－</button>
  <button onclick={()=>select(svg).call(behavior.transform,zoomIdentity)}>重置地图</button>
 </div>
 <svg bind:this={svg} viewBox="0 0 900 460" role="img" aria-label="世界足迹地图" class="w-full bg-neutral-500/5">
  <g bind:this={layer}>
   <path d={land} fill="currentColor" opacity=".16" stroke="currentColor" stroke-width=".5"/>
   {#each places.filter(place=>place.lat!==null && place.lng!==null) as place}
    {@const point=project(place.lng!,place.lat!)}
    <a href={`#${place.id}`} aria-label={`查看足迹：${place.name}`}>
     <circle cx={point[0]} cy={point[1]} r="5" fill="var(--primary)" stroke="var(--card-bg)" stroke-width="1.5"><title>{place.name}</title></circle>
    </a>
   {/each}
  </g>
 </svg>
 <p aria-live="polite" class="p-3 text-xs text-neutral-500">{message} · Natural Earth</p>
</div>
<style>button{border:1px solid #8886;padding:.35rem .7rem;border-radius:.5rem}svg{touch-action:pan-y}a:focus circle{stroke-width:4}</style>
