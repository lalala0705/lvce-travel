import {routeScope,routeKey,checkRoute,dayColors} from './route-check.js';
import {mapsRequest,loadAMap,validPlace,placeLink,resolveMapCenter} from './maps-api.js?v=0.3.1';
export function createMapFeature({sheet,e,btn,icon,openSheet,field,toast,currentTrip,currentDay,onPick,rerender}){
  let map=null,mapAbort=null,searchAbort=null,config=null,results=[],targetId=null,focused=null,locationAttempt=0,mapScope='day',mode='driving',routeData=new Map(),lines=[],calculating=false,calculationVersion=0;
  const message=s=>{const n=document.querySelector('#live-map-status');if(n)n.textContent=s;};
  function dispose(){calculationVersion++;mapAbort?.abort();mapAbort=null;map?.destroy();map=null;lines=[];calculating=false;}
  function cancelSearch(){locationAttempt++;focused=null;searchAbort?.abort();searchAbort=null;results=[];}
  sheet.addEventListener('close',cancelSearch);
  function panel(t,index){
    const view=routeScope(t,mapScope,index),known=view.points.length-view.missing.length;
    return `<section class="route-map card flat"><div class="map-tools"><div class="segmented" role="group" aria-label="地图范围">${btn('当天线路','maps-scope',mapScope==='day'?'primary':'secondary','',`data-scope="day"`)}${btn('整体旅行','maps-scope',mapScope==='all'?'primary':'secondary','',`data-scope="all"`)}</div><div class="segmented" role="group" aria-label="交通方式">${btn('驾车','maps-mode',mode==='driving'?'soft':'text','',`data-mode="driving"`)}${btn('步行','maps-mode',mode==='walking'?'soft':'text','',`data-mode="walking"`)}</div></div><div id="live-map" class="live-map" aria-label="旅行真实路线地图"><div class="map-placeholder">${icon('pin')}<p>正在准备地图…</p></div></div><div class="map-summary"><p id="live-map-status" role="status">${known}/${view.points.length} 个地点已确认，正在加载地图…</p><div class="map-legend">${(mapScope==='all'?t.days.map((_,i)=>i):[index]).map(i=>`<span><i style="background:${dayColors[i%dayColors.length]}"></i>第 ${i+1} 天</span>`).join('')}</div><p class="hint">标记为「天数-顺序」，灰色虚线为跨天交通。道路线路需查询后显示，未确认地点不绘制虚构连线。</p><div class="form-actions">${btn('显示道路线路','maps-calculate','soft','pin')}${btn('校验合理性','maps-audit','secondary','check')}</div>${btn('重新加载地图','maps-reload','text')}</div></section>`;
  }
  function drawLines(){
    if(!map||!globalThis.AMap)return;
    if(lines.length)map.remove(lines);lines=[];
    for(const segment of routeScope(currentTrip(),mapScope,currentDay()).segments){
      if(!segment.known)continue;const route=routeData.get(routeKey(segment,mode));if(!route||route.error||route.polyline?.length<2)continue;
      lines.push(new globalThis.AMap.Polyline({path:route.polyline,strokeColor:segment.color,strokeWeight:5,strokeStyle:segment.crossDay?'dashed':'solid'}));
    }
    if(lines.length)map.add(lines);
  }
  function report(){
    const result=checkRoute(currentTrip(),{scope:mapScope,day:currentDay(),mode,routes:routeData});
    const tone={error:'需调整',warning:'提醒',unknown:'待核实'};
    openSheet('路线合理性校验',`<div class="note"><div><strong>${result.complete&&!result.issues.length?'当前数据中未发现时间或交通冲突':'请核对下面的安排'}</strong><p class="hint">${mapScope==='all'?'整体旅行':'当前第 '+(currentDay()+1)+' 天'} · ${mode==='driving'?'驾车':'步行'} · 已核实 ${result.checked}/${result.segments} 段交通</p></div></div><div class="stack section-space">${result.issues.map(issue=>`<article class="card flat"><span class="pill">${tone[issue.severity]}</span><p>${e(issue.text)}</p></article>`).join('')||'<p>停留与已知交通时间能够衔接。</p>'}</div><p class="hint section-space">道路时间按查询时刻估算，并额外预留驾车 10 分钟/步行 5 分钟缓冲。不核验营业时间、预约、天气、停车或临时封路；未匹配地点和查询失败不会标为通过。</p><div class="form-actions">${btn('关闭','close')}${btn('查询交通后复检','maps-recheck','soft')}${btn('问 AI 调整当天','ask-ai-adjust','primary','sparkles')}</div>`);
  }
  async function calculate(showReport=false){
    if(calculating)return;
    const op=mapAbort;if(!op){toast('请先等待地图加载');return;}
    const view=routeScope(currentTrip(),mapScope,currentDay()),known=view.segments.filter(s=>s.known);
    if(known.length>24){toast('整体路段较多，请切换到当天查询，每次最多计算 24 段');return;}
    calculating=true;const version=++calculationVersion;let done=0,failed=0;
    try{
      for(const segment of known){
        if(op.signal.aborted)return;const key=routeKey(segment,mode);
        if(!routeData.has(key)||routeData.get(key).error){
          try{routeData.set(key,{...await mapsRequest('route',{body:{origin:segment.from.place.location,destination:segment.to.place.location,mode},signal:op.signal}),queriedAt:new Date().toISOString()});}
          catch(error){if(op.signal.aborted)return;routeData.set(key,{error:error.message});failed++;if(/频繁|次数|限额/.test(error.message))break;}
        }
        done++;message(`正在计算道路线路 ${done}/${known.length}…`);
      }
      if(op.signal.aborted)return;drawLines();
      if(map&&lines.length)map.setFitView(lines,false,[45,45,45,45]);
      message(`已查询 ${done} 段${failed?'，其中 '+failed+' 段未完成':''}；${view.missing.length?'还有 '+view.missing.length+' 个地点待确认':'道路时间仅供出行参考'}`);
      if(showReport)report();
    }finally{if(version===calculationVersion)calculating=false;}
  }
  async function mount(){
    dispose();const host=document.querySelector('#live-map');if(!host)return;
    const op=new AbortController();mapAbort=op;
    try{
      config=await mapsRequest('config',{signal:op.signal});if(op.signal.aborted)return;
      if(!config.ready){host.querySelector('.map-placeholder p').textContent='地图服务尚未配置';message(config.message);return;}
      const t=currentTrip(),view=routeScope(t,mapScope,currentDay()),items=view.points.map(p=>p.item);
      const [AMap,center]=await Promise.all([loadAMap(config),resolveMapCenter(t.city,items,{signal:op.signal})]);if(op.signal.aborted||!host.isConnected)return;
      host.replaceChildren();map=new AMap.Map(host,{center,zoom:12,viewMode:'2D',resizeEnable:true});
      const markers=[];
      view.points.forEach(point=>{const item=point.item;if(!validPlace(item.place))return;const badge=document.createElement('div');badge.className='amap-stop-badge';badge.style.background=point.color;badge.textContent=point.label;const marker=new AMap.Marker({position:item.place.location,title:`第 ${point.dayIndex+1} 天 · ${point.itemIndex+1}. ${item.title}`,content:badge,anchor:'center'});marker.on('click',()=>toast(`第 ${point.dayIndex+1} 天 · ${point.itemIndex+1}. ${item.title}`));markers.push(marker);});
      if(markers.length){map.add(markers);map.setFitView(markers,false,[45,45,45,45]);}drawLines();
      message(`已确认 ${markers.length}/${view.points.length} 个高德点位；${view.missing.length?'请在行程中匹配剩余地点':'可查询道路线路与校验时间衔接'}`);

    }catch(error){if(op.signal.aborted)return;message(error.message||'地图连接暂不可用');if(host.isConnected){host.replaceChildren();const n=document.createElement('p');n.className='map-placeholder';n.textContent='地图暂不可用，下方仍可使用外部导航';host.append(n);}}
  }
  function search(id=null,keyword=''){
    cancelSearch();targetId=id;focused=null;
    openSheet('找一个想去的地方',`<p class="hint">填写城市搜索，或主动使用当前位置查找周边。定位只用于本次查询，会发送给旅策后端与高德，不保存到旅行或分享链接。</p><form data-form="maps-search"><div class="form-grid">${field('城市','city',currentTrip().city,{full:true,maxlength:30,required:false})}${field('地点或想做的事','keywords',keyword,{full:true,maxlength:60,placeholder:'例如：亲水公园、徒步步道、博物馆'})}<label class="field full">周边范围<select name="radius"><option value="5000">5 公里</option><option value="10000" selected>10 公里</option><option value="30000">30 公里</option><option value="50000">50 公里</option></select></label></div><div class="form-actions">${btn('使用当前位置','maps-locate','soft','pin')}${btn('改用城市搜索','maps-clear-location','text')}<button type="submit" class="btn primary">搜索地点</button></div><p id="maps-location-status" class="hint" role="status">当前按填写的城市搜索；周边范围仅在定位后生效。</p><p class="form-error" role="alert"></p></form><div id="maps-results" class="stack section-space" aria-live="polite"></div><p class="hint section-space">玩水优先搜索有管理设施的亲水景区。地点存在不代表允许下水；徒步路线也不等同于专业户外轨迹。</p>`);
  }
  async function locate(){
    const form=sheet.querySelector('[data-form="maps-search"]');if(!form)return;
    const node=form.querySelector('#maps-location-status'),button=form.querySelector('[data-action="maps-locate"]');
    if(!navigator.geolocation){node.textContent='当前浏览器不支持定位，请填写城市搜索';return;}
    const attempt=++locationAttempt;button.disabled=true;node.textContent='请在浏览器提示中决定是否允许定位…';
    try{
      const position=await new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:true,timeout:15000,maximumAge:0}));
      if(!sheet.open||!form.isConnected||attempt!==locationAttempt)return;
      focused=[position.coords.longitude,position.coords.latitude];node.textContent='已获取当前位置，本次搜索将查询附近地点；城市栏暂不参与筛选。';
    }catch{if(form.isConnected)node.textContent='定位未成功，可填写城市继续搜索；不会自动推测你的位置';}
    finally{if(form.isConnected)button.disabled=false;}
  }
  async function submit(form){
    searchAbort?.abort();const op=new AbortController();searchAbort=op;results=[];
    const error=form.querySelector('.form-error'),node=sheet.querySelector('#maps-results'),submit=form.querySelector('[type="submit"]');error.textContent='';node.textContent='正在查询高德地点…';submit.disabled=true;
    const data=new FormData(form),payload={keywords:String(data.get('keywords')||'').trim(),...(focused?{gps:focused,radius:Number(data.get('radius'))}:{city:String(data.get('city')||'').trim()})};
    try{
      const response=await mapsRequest('search',{body:payload,signal:op.signal});if(op.signal.aborted||!form.isConnected)return;
      results=(response.places||[]).filter(validPlace);
      node.innerHTML=results.length?results.map((p,i)=>`<article class="card flat"><span class="pill">高德地点${response.nearby&&p.distance!==null?' · 直线距离约 '+(p.distance/1000).toFixed(1)+' 公里':''}</span><h3 class="section-space">${e(p.name)}</h3><p>${e(p.city+' '+p.district+' '+p.address)}</p>${btn(targetId?'确认匹配这个地点':'选择并加入行程','maps-pick','soft full','plus',`data-index="${i}"`)}</article>`).join(''):'<p class="hint">没有找到地点，试试更具体的名称、其他城市或更大范围。</p>';
    }catch(err){if(!op.signal.aborted&&form.isConnected){node.textContent='';error.textContent=err.message||'地图查询失败，请稍后再试';}}
    finally{if(!op.signal.aborted&&form.isConnected)submit.disabled=false;}
  }
  return {panel,mount,dispose,search,setScope(value){mapScope=value;},handleSubmit(form){if(form.dataset.form!=='maps-search')return false;submit(form);return true;},actions:{
    'maps-search':()=>search(), 'maps-match':el=>{const item=currentTrip().days[currentDay()].items.find(x=>x.id===el.dataset.id);if(item)search(item.id,item.title);},
    'maps-pick':el=>{const p=results[Number(el.dataset.index)];if(!validPlace(p))return;const id=targetId;cancelSearch();focused=null;onPick(p,id);},
    'maps-locate':locate,'maps-clear-location':()=>{locationAttempt++;focused=null;const n=sheet.querySelector('#maps-location-status');if(n)n.textContent='已改用城市搜索，不使用当前位置';},
    'maps-scope':el=>{mapScope=el.dataset.scope;rerender();},'maps-mode':el=>{mode=el.dataset.mode;rerender();},'maps-calculate':()=>calculate(false),'maps-audit':report,'maps-recheck':()=>calculate(true),
    'maps-reload':mount
  }};
}
