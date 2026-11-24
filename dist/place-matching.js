import {validPlace,needsPlace} from './place-schema.js?v=0.4.1';
import {mapsRequest} from './maps-api.js';
const normalized=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');
const cityName=value=>normalized(value).replace(/(?:自治州|地区|市)$/,'');
export function placeQuery(item){
  return String(item.title||'').trim().replace(/^(?:(?:上午|下午|傍晚|晚上)\s*)?(?:游览|参观|打卡|游玩|抵达|游逛)\s*/,'').replace(/[（(](?:约)?\d+(?:\.\d+)?\s*(?:小时|分钟|h|min)[）)]/gi,'').replace(/(?:游览|参观|游玩)$/,'').trim().slice(0,60);
}
function nameForms(name){const forms=[name,String(name).split(/[-—·]/).at(-1)].map(normalized).filter(Boolean);return [...forms,...forms.map(x=>x.replace(/(?:风景名胜区|风景区|景区)$/,''))];}
export function decidePlace(item,places,city){
  const query=placeQuery(item),unique=[...new Map(places.filter(validPlace).map(p=>[p.id+':'+p.location.join(','),p])).values()];
  const target=normalized(query),generic=target.length<3||/^(?:公园|步道|景区|酒店|餐厅|午餐|晚餐|早餐|民宿|住宿|当地美食)$/.test(target)||item.type==='餐饮'&&/(?:早餐|午餐|晚餐|用餐|午饭|晚饭)/.test(item.title);
  const matches=generic?[]:unique.filter(p=>cityName(p.city)===cityName(city)&&nameForms(p.name).includes(target));
  if(matches.length===1)return {place:matches[0],placeMatch:{status:'matched',query,message:'名称与所在城市唯一匹配',candidates:[]}};
  return {placeMatch:{status:unique.length?'pending':'unmatched',query,message:unique.length?'请核对名称和地址后选择正确地点':'没有找到可确认的高德地点，请换用具体名称搜索',candidates:unique.slice(0,5)}};
}
export function matchingSummary(plan){
  const items=plan.days.flatMap(d=>d.items),spatial=items.filter(needsPlace);
  return {total:spatial.length,matched:spatial.filter(x=>validPlace(x.place)).length,pending:spatial.filter(x=>!validPlace(x.place)).length,activities:items.length-spatial.length};
}
export async function matchPlanPlaces(plan,city,{signal,search=async(payload,options)=>(await mapsRequest('search',{body:payload,signal:options.signal})).places,onProgress=()=>{},budgetMs=45000}={}){
  const result={...plan,days:plan.days.map(d=>({...d,items:d.items.map(x=>({...x}))}))};
  const items=result.days.flatMap(d=>d.items),cache=new Map(),total=items.filter(x=>needsPlace(x)&&!validPlace(x.place)).length;let done=0,stopped='';
  const deadline=new AbortController(),timer=setTimeout(()=>deadline.abort(),budgetMs);
  const combined=signal?AbortSignal.any([signal,deadline.signal]):deadline.signal;
  // Default search needs the combined timeout, whereas an injected search gets it explicitly.
  const lookup=search;
  try{
    for(const item of items){
      if(signal?.aborted)throw new DOMException('已取消匹配','AbortError');
      if(validPlace(item.place)){item.placeMatch={status:'matched',query:placeQuery(item),message:'保留已确认的高德地点',candidates:[]};continue;}
      if(!needsPlace(item)){item.placeMatch={status:'activity',query:'',message:'交通或休息时间安排，不伪造地图坐标',candidates:[]};continue;}
      const query=placeQuery(item);onProgress({done,total,title:item.title});
      if(deadline.signal.aborted)stopped='自动匹配已超时，可继续匹配剩余地点';
      if(stopped){item.placeMatch={status:'pending',query,message:stopped,candidates:[]};continue;}
      const category=item.type==='餐饮'?'food':item.type==='住宿'?'stay':undefined;
      const key=cityName(city)+'|'+normalized(query)+'|'+(category||'');
      try{
        if(!query)throw Error('请填写具体地点名称');
        if(!cache.has(key)){
          const payload={city,keywords:query,...(category?{category}:{})};
          // mapsRequest propagates cancellation and the phase deadline; no retries.
          const places=await lookup(payload,{signal:combined});cache.set(key,Array.isArray(places)?places.filter(validPlace):[]);
        }
        Object.assign(item,decidePlace(item,cache.get(key),city));
      }catch(error){
        if(signal?.aborted)throw new DOMException('已取消匹配','AbortError');
        if(deadline.signal.aborted)stopped='自动匹配已超时，可继续匹配剩余地点';
        else if(/频繁|次数|限额/.test(error.message))stopped='地图查询额度暂不可用，已匹配地点保留，可稍后继续';
        item.placeMatch={status:stopped?'pending':'error',query,message:stopped||'查询未完成，可手动搜索或稍后再试',candidates:[]};
      }
      done++;
    }
    if(signal?.aborted)throw new DOMException('已取消匹配','AbortError');
    onProgress({done,total,title:''});return result;
  }finally{clearTimeout(timer);}
}
export function mergePlaceMatches(current,before,matched){
  if(current.id!==before.id||matched.id!==before.id)throw new Error('旅行已切换，未应用旧匹配结果');
  const updated={...current,days:current.days.map(day=>{const original=before.days.find(d=>d.id===day.id),next=matched.days.find(d=>d.id===day.id);if(!original||!next)return day;
    return {...day,items:day.items.map(item=>{const old=original.items.find(x=>x.id===item.id),match=next.items.find(x=>x.id===item.id);if(!old||!match||old.title!==item.title||JSON.stringify(old.place??null)!==JSON.stringify(item.place??null))return item;
      return {...item,...(validPlace(match.place)?{place:match.place}:{}),...(match.placeMatch?{placeMatch:match.placeMatch}:{})};})};})};
  return updated;
}
