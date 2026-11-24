import {mapsRequest,loadAMap,validPlace,placeLink,resolveMapCenter} from './maps-api.js';
export function createMapFeature({sheet,e,btn,icon,openSheet,field,toast,currentTrip,currentDay,onPick}){
  let map=null,mapAbort=null,searchAbort=null,config=null,results=[],targetId=null,focused=null,routeLine=null,locationAttempt=0;
  const message=s=>{const n=document.querySelector('#live-map-status');if(n)n.textContent=s;};
  function dispose(){mapAbort?.abort();mapAbort=null;map?.destroy();map=null;routeLine=null;}
  function cancelSearch(){locationAttempt++;focused=null;searchAbort?.abort();searchAbort=null;results=[];}
  sheet.addEventListener('close',cancelSearch);
  function page(t,index,tabs){
    const items=t.days[index].items;
    return `<section class="map-page"><div class="page-head"><div><h1>沿着期待，慢慢走</h1><p class="muted">${e(t.city)} · 第 ${index+1} 天</p></div>${btn('搜索地点','maps-search','soft','pin')}</div>${tabs}<div class="layout"><div class="map-panel"><div class="card flat"><div id="live-map" class="live-map" aria-label="高德地图"><div class="map-placeholder">${icon('pin')}<p>正在准备地图…</p></div></div><div class="map-summary"><p id="live-map-status" role="status">正在检查地图服务…</p>${btn('重新加载地图','maps-reload','text')}</div></div><div class="note section-space"><p>搜索并确认具体地点后显示真实点位。路线需单独查询；未查询时不显示连线和距离。地图数据不代表开放状态或户外活动安全结论。</p></div></div><div class="spot-list">${items.length?items.map((x,i)=>`<div class="card flat"><div class="row"><span class="count-badge">${i+1}</span><div style="flex:1"><h3>${e(x.title)}</h3><p class="hint">${x.place&&validPlace(x.place)?e(x.place.address):'尚未匹配具体地图地点'}</p></div><a class="btn soft" href="${e(placeLink(t.city,x))}" target="_blank" rel="noopener noreferrer">高德打开</a></div><div class="form-actions">${btn(x.place?'重新匹配地点':'在地图上确认','maps-match','text','pin',`data-id="${e(x.id)}"`)}</div>${i>0&&validPlace(items[i-1].place)&&validPlace(x.place)?`<div class="route-actions"><span class="hint">从上一站出发</span>${btn('步行','maps-route','soft','',`data-index="${i}" data-mode="walking"`)}${btn('驾车','maps-route','soft','',`data-index="${i}" data-mode="driving"`)}<p class="hint" id="route-${i}" role="status"></p></div>`:''}</div>`).join(''):'<div class="empty"><strong>先找一个想去的地方</strong><p>搜索公园、步道、亲水景区，确认后加入行程。</p></div>'}</div></div></section>`;
  }
  async function mount(){
    dispose();const host=document.querySelector('#live-map');if(!host)return;
    const op=new AbortController();mapAbort=op;
    try{
      config=await mapsRequest('config',{signal:op.signal});if(op.signal.aborted)return;
      if(!config.ready){host.querySelector('.map-placeholder p').textContent='地图服务尚未配置';message(config.message);return;}
      const t=currentTrip(),items=t.days[currentDay()].items;
      const [AMap,center]=await Promise.all([loadAMap(config),resolveMapCenter(t.city,items,{signal:op.signal})]);if(op.signal.aborted||!host.isConnected)return;
      host.replaceChildren();map=new AMap.Map(host,{center,zoom:12,viewMode:'2D',resizeEnable:true});
      const markers=[];
      items.forEach((item,i)=>{if(!validPlace(item.place))return;const badge=document.createElement('div');badge.className='amap-stop-badge';badge.textContent=String(i+1);markers.push(new AMap.Marker({position:item.place.location,title:item.title,content:badge,anchor:'center'}));});
      if(markers.length){map.add(markers);map.setFitView(markers,false,[45,45,45,45]);}
      message(markers.length?`已确认 ${markers.length} 个高德点位；可查询相邻地点的步行或驾车路线`:'搜索并确认地点后，在这里显示真实点位');
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
  async function route(el){
    const i=Number(el.dataset.index),items=currentTrip().days[currentDay()].items,from=items[i-1]?.place,to=items[i]?.place;
    if(!validPlace(from)||!validPlace(to))return;
    const node=document.querySelector('#route-'+i),op=mapAbort;if(!op||node.dataset.loading)return;node.dataset.loading='true';const buttons=node.parentElement.querySelectorAll('[data-action="maps-route"]');buttons.forEach(b=>b.disabled=true);node.textContent='正在查询路线…';
    try{
      const data=await mapsRequest('route',{body:{origin:from.location,destination:to.location,mode:el.dataset.mode},signal:op.signal});if(op.signal.aborted||!node.isConnected)return;
      node.textContent=`${data.mode==='walking'?'步行':'驾车'}约 ${(data.distance/1000).toFixed(1)} 公里${data.duration===null?'':' · '+Math.ceil(data.duration/60)+' 分钟'}，仅供出行参考`;
      if(map&&globalThis.AMap){if(routeLine)map.remove(routeLine);routeLine=null;if(data.polyline.length>1){routeLine=new globalThis.AMap.Polyline({path:data.polyline,strokeColor:'#16745c',strokeWeight:5});map.add(routeLine);map.setFitView([routeLine]);}}
    }catch(error){if(!op.signal.aborted&&node.isConnected)node.textContent=error.message||'未能查询此路段';}
    finally{delete node.dataset.loading;buttons.forEach(b=>{if(b.isConnected)b.disabled=false;});}
  }
  return {page,mount,dispose,search,handleSubmit(form){if(form.dataset.form!=='maps-search')return false;submit(form);return true;},actions:{
    'maps-search':()=>search(), 'maps-match':el=>{const item=currentTrip().days[currentDay()].items.find(x=>x.id===el.dataset.id);if(item)search(item.id,item.title);},
    'maps-pick':el=>{const p=results[Number(el.dataset.index)];if(!validPlace(p))return;const id=targetId;cancelSearch();focused=null;onPick(p,id);},
    'maps-locate':locate,'maps-clear-location':()=>{locationAttempt++;focused=null;const n=sheet.querySelector('#maps-location-status');if(n)n.textContent='已改用城市搜索，不使用当前位置';},
    'maps-reload':mount,'maps-route':route
  }};
}
