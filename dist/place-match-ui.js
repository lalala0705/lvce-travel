import {mapsRequest} from './maps-api.js';
import {validPlace,needsPlace,placeStatus} from './place-schema.js?v=0.4.1';
import {matchPlanPlaces,mergePlaceMatches,matchingSummary,placeQuery} from './place-matching.js?v=0.4.1';
export function createPlaceMatchUI({sheet,openSheet,btn,icon,e,field,toast,currentTrip,currentDay,onUpdate}){
  let operation=null,review=null,picker=null,pool=[];
  function cancel(){operation?.abort();operation=null;}
  sheet.addEventListener('close',cancel);
  function metadata(item,place){return {status:'matched',query:placeQuery(item),message:'用户已确认高德地点',candidates:[]};}
  function bind(day,id,title,place){
    const t=currentTrip(),item=t.days[day]?.items.find(x=>x.id===id);if(!item||item.title!==title)throw Error('地点已变更，请重新确认');
    const updated={...t,days:t.days.map((d,i)=>i===day?{...d,items:d.items.map(x=>x.id===id?{...x,place,placeMatch:metadata(x,place)}:x)}:d)};onUpdate(updated);
  }
  function showReview(scope='day'){
    const t=currentTrip();review={tripId:t.id,day:currentDay(),scope};
    const days=scope==='all'?t.days.map((d,i)=>({d,i})):[{d:t.days[currentDay()],i:currentDay()}],summary=matchingSummary({days:days.map(x=>x.d)});
    openSheet('确认高德地点',`<div class="note"><div><strong>${summary.matched}/${summary.total} 个地点已匹配</strong><p class="hint">待确认 ${summary.pending} 个。只补充地图位置，不改变名称、时间、备注和账单。</p></div></div><div class="poi-review-list stack section-space">${days.map(({d,i})=>`<section><h3>第 ${i+1} 天 · ${e(d.title)}</h3>${d.items.map(x=>{const status=placeStatus(x),candidates=x.placeMatch?.candidates?.filter(validPlace)||[];return `<article class="card flat poi-review-item"><span class="pill place-${status.kind}">${e(status.label)}</span><h3>${e(x.title)}</h3>${validPlace(x.place)?`<p class="hint">高德：${e(x.place.name)} · ${e(x.place.city+' '+x.place.address)}</p>`:`<p class="hint">${e(x.placeMatch?.message||'请查询并选择实际地点')}</p>`}${!validPlace(x.place)&&needsPlace(x)?candidates.slice(0,3).map((p,k)=>`<div class="poi-choice"><strong>${e(p.name)}</strong><p class="hint">${e(p.city+' '+p.district+' '+p.address)}</p>${btn('确认这个地点','poi-review-pick','soft','pin',`data-day="${i}" data-id="${e(x.id)}" data-candidate="${k}"`)}</div>`).join(''):''}${needsPlace(x)?btn(validPlace(x.place)?'重新选择地点':'搜索其他地点','poi-review-search','text','pin',`data-day="${i}" data-id="${e(x.id)}"`):''}</article>`;}).join('')}</section>`).join('')}</div><div class="form-actions">${btn('完成','close','primary')}${btn('继续自动匹配','poi-batch','secondary','',`data-scope="${scope}"`)}</div>`);
  }
  async function batch(scope='day'){
    cancel();const before=structuredClone(currentTrip()),day=currentDay(),op=new AbortController();operation=op;
    openSheet('正在匹配高德地点',`<div class="ai-working"><span class="ai-spinner" aria-hidden="true"></span><h3>补齐行程里的真实位置</h3><p id="poi-match-progress" role="status">正在准备查询…</p></div><p class="hint">明确且唯一的名称会自动匹配；重名、泛称和未找到的地点保留待确认。不会修改账单。</p><div class="form-actions">${btn('取消匹配','poi-match-cancel','secondary full')}</div>`);
    try{
      const part={...before,days:scope==='all'?before.days:[before.days[day]]};
      const matchedPart=await matchPlanPlaces(part,before.city,{signal:op.signal,onProgress:progress=>{const node=sheet.querySelector('#poi-match-progress');if(node)node.textContent=`正在查询 ${progress.done}/${progress.total} · ${progress.title||'整理匹配结果'}`;}});
      if(op.signal.aborted||operation!==op)return;
      const matched=scope==='all'?matchedPart:{...before,days:before.days.map((d,i)=>i===day?matchedPart.days[0]:d)};
      const updated=mergePlaceMatches(currentTrip(),before,matched);operation=null;onUpdate(updated);showReview(scope);
    }catch(error){if(!op.signal.aborted){operation=null;openSheet('地点匹配暂未完成',`<p>${e(error.message||'地图查询暂不可用')}</p><p class="hint">已有行程未被覆盖，可以稍后重试或逐个选择地点。</p><div class="form-actions">${btn('关闭','close','primary')}</div>`);}}
    finally{if(operation===op)operation=null;}
  }
  function choose({title,city,candidates=[],onChoose}){
    cancel();picker={title,city,onChoose};pool=candidates.filter(validPlace).slice(0,10);
    openSheet('选择实际高德地点',`<p class="hint">为「${e(title)}」确认实际位置。请核对城市、门店或景区入口，选中后才用于地图和路线。</p><form data-form="poi-picker"><div class="form-grid">${field('搜索城市','city',city,{full:true,maxlength:30})}${field('具体地点名称','keywords',placeQuery({title}),{full:true,maxlength:60})}</div><p class="form-error" role="alert"></p><div class="form-actions"><button type="submit" class="btn primary">查询高德</button>${btn('取消','close')}</div></form><div id="poi-picker-results" class="stack section-space" aria-live="polite"></div>`);paintChoices();
  }
  function paintChoices(){const node=sheet.querySelector('#poi-picker-results');if(!node)return;node.innerHTML=pool.length?pool.map((p,i)=>`<article class="card flat"><h3>${e(p.name)}</h3><p class="hint">${e(p.city+' '+p.district+' '+p.address)}</p>${btn('使用这个地点','poi-picker-select','soft full','pin',`data-index="${i}"`)}</article>`).join(''):'<p class="hint">输入具体景点、餐厅或酒店名称后查询。</p>';}
  async function searchPicker(form){
    cancel();const op=new AbortController(),context=picker;operation=op;const data=new FormData(form),error=form.querySelector('.form-error'),button=form.querySelector('[type="submit"]');button.disabled=true;error.textContent='';pool=[];
    try{const response=await mapsRequest('search',{body:{city:String(data.get('city')||''),keywords:String(data.get('keywords')||'')},signal:op.signal});if(op.signal.aborted||picker!==context||!sheet.open)return;pool=response.places.filter(validPlace);paintChoices();if(!pool.length)error.textContent='没有找到地点，请换一个具体名称或城市';}
    catch(err){if(!op.signal.aborted&&form.isConnected)error.textContent=err.message||'查询未完成';}
    finally{if(form.isConnected)button.disabled=false;if(operation===op)operation=null;}
  }
  function matchOne(el){const t=currentTrip(),day=Number(el.dataset.day??currentDay()),item=t.days[day]?.items.find(x=>x.id===el.dataset.id);if(!item)return;
    const tripId=t.id,title=item.title;
    choose({title,city:t.city,candidates:item.placeMatch?.candidates,onChoose:place=>{if(currentTrip().id!==tripId){toast('旅行已切换，请重新选择');return;}try{bind(day,item.id,title,place);toast('已绑定高德位置，地图已更新');}catch(error){toast(error.message);}}});
  }
  return {choose,matchOne,handleSubmit(form){if(form.dataset.form!=='poi-picker')return false;searchPicker(form);return true;},actions:{
    'poi-batch':el=>batch(el.dataset.scope==='all'?'all':'day'),'poi-review':el=>showReview(el.dataset.scope==='all'?'all':'day'),
    'poi-match-cancel':()=>{cancel();sheet.close();toast('已取消匹配，行程未修改');},'poi-picker-select':el=>{const p=pool[Number(el.dataset.index)],context=picker;if(!validPlace(p)||!context)return;cancel();picker=null;sheet.close();context.onChoose(p);},
    'poi-review-pick':el=>{if(!review||review.tripId!==currentTrip().id)return;const day=Number(el.dataset.day),item=currentTrip().days[day]?.items.find(x=>x.id===el.dataset.id),p=item?.placeMatch?.candidates?.[Number(el.dataset.candidate)];if(!item||!validPlace(p))return;const scope=review.scope;try{bind(day,item.id,item.title,p);showReview(scope);}catch(error){toast(error.message);}},
    'poi-review-search':matchOne
  }};
}
