import {makeTrip,localDate,dayDate,uid,validTrip,money,toCents} from './domain.js?v=0.4.1';
import {getAIStatus,requestAIPlan} from './ai-api.js?v=0.4.0';
import {requestChat} from './chat-api.js';
import {validateAIRequest} from './ai-schema.js';
import {validPlace,needsPlace,placeStatus} from './place-schema.js?v=0.4.1';
import {matchPlanPlaces,matchingSummary} from './place-matching.js?v=0.4.1';
import {daySignature,safeDayContext,applyDayRevision,summarizeRevision} from './revision.js?v=0.4.1';

export function createConversation({e,btn,icon,toast,currentTrip,currentDay,rerender,addTrip,replaceTrip,choosePlace}){
  let mode='new',session=null,status=null,checking=false,operation=null,draft=null;
  function fresh(kind){const t=currentTrip();return {mode:kind,tripId:t.id,day:currentDay(),names:t.members.map(m=>m.name),conditions:{city:kind==='adjust'?t.city:'',date:kind==='adjust'?dayDate(t.date,currentDay()):localDate(7),count:kind==='adjust'?1:Math.min(t.days.length,7),people:t.members.length,budgetCents:Math.min(t.budget,100000000),pace:t.pace,preferences:t.preferences},history:[],candidates:[],knownPlaces:[],seed:'',searchMessage:''};}
  function ensure(){if(!session||(mode==='adjust'&&session.tripId!==currentTrip().id))session=fresh(mode);return session;}
  function suspend(){if(operation){operation.abort();operation=null;ensure().history.push({role:'assistant',content:'已取消本次请求，已有行程未修改。'});}}
  function start(kind='new',seed=''){suspend();mode=kind;session=fresh(kind);session.seed=seed;draft=null;}
  function conditionFields(s){
    const t=currentTrip(),c=s.conditions;
    if(mode==='adjust')return `<label class="field">调整哪一天<select name="targetDay">${t.days.map((d,i)=>`<option value="${i}" ${s.day===i?'selected':''}>第 ${i+1} 天 · ${e(d.title)}</option>`).join('')}</select></label><p class="hint">只替换选中的一天，其他日期、成员、账单和清单保留。请说明已经完成的活动，AI 不会自动猜测你的旅行进度。</p>`;
    return `<details class="chat-conditions"><summary>出行条件 · ${e(c.city||'城市待确认')} · ${e(c.date)} · ${c.count} 天 · ${c.people} 人</summary><div class="form-grid section-space"><label class="field">城市或出发城市<input name="city" value="${e(c.city)}" maxlength="30" placeholder="还没想好目的地也可以先聊"></label><label class="field">出发日期<input type="date" name="date" value="${e(c.date)}" min="${localDate()}"></label><label class="field">天数<input type="number" name="count" value="${c.count}" min="1" max="7"></label><label class="field">人均预算（元）<input type="number" name="budget" value="${c.budgetCents/100}" min="0.01" max="1000000" step="0.01"></label><label class="field full">同行人（只保存在本机）<input name="members" value="${e(s.names.join('，'))}" maxlength="200"></label><label class="field full">节奏<select name="pace"><option ${c.pace==='慢逛休闲'?'selected':''}>慢逛休闲</option><option ${c.pace==='紧凑打卡'?'selected':''}>紧凑打卡</option></select></label></div></details>`;
  }
  function preview(){
    if(!draft)return '';const p=draft.plan,matched=matchingSummary(p),total=p.days.flatMap(d=>d.items).reduce((sum,x)=>sum+x.cost,0);let change='';
    if(draft.mode==='adjust'){const diff=summarizeRevision(currentTrip().days[draft.day],p.days[0]);change=`<div class="note"><div><strong>第 ${draft.day+1} 天调整预览</strong><p>新增 ${diff.added.length} 项 · 移除 ${diff.removed.length} 项 · 时间调整 ${diff.rescheduled.length} 项</p>${diff.removed.length?`<p class="hint">将移除：${e(diff.removed.join('、'))}</p>`:''}<p class="hint">确认后只替换这一天，实际账单和清单不变。</p></div></div>`;}
    return `<section class="chat-draft card flat" id="chat-draft"><span class="pill">AI 草稿 · 尚未应用</span><h2 class="section-space">${e(p.title)}</h2><p>${e(p.summary)}</p><p class="hint">已列项目人均预计 ${money(total)} · 人均预算 ${money(draft.conditions.budgetCents)}</p>${total>draft.conditions.budgetCents?'<p class="amber">预计费用已超过预算，请继续沟通或编辑后再保存。</p>':''}${change}<div class="note"><div><strong>高德匹配 ${matched.matched}/${matched.total}</strong><p class="hint">${matched.pending?'还有 '+matched.pending+' 个地点待确认，未确认的地点不会在地图上标点。':'实际地点已具备地图坐标。'}${matched.activities?'交通与休息项不单独虚构位置。':''}</p></div></div><div class="ai-draft-days">${p.days.map((d,i)=>`<details ${i===0?'open':''}><summary>${draft.mode==='adjust'?'第 '+(draft.day+1)+' 天':'第 '+(i+1)+' 天'} · ${e(d.title)}</summary>${d.items.map((x,j)=>`<div class="ai-draft-item"><strong class="green">${e(x.time)}</strong><div><h3>${e(x.title)}</h3><p class="hint">${x.duration} 分钟 · 预计 ${money(x.cost)} / 人</p><p>${e(x.note)}</p><span class="pill place-${placeStatus(x).kind}">${e(placeStatus(x).label)}</span>${validPlace(x.place)?`<p class="hint">高德：${e(x.place.name)} · ${e(x.place.address)}</p>`:''}${needsPlace(x)?btn(validPlace(x.place)?'核对/更换位置':'确认高德位置','chat-match-place','text','pin',`data-day="${i}" data-item="${j}"`):''}</div></div>`).join('')}</details>`).join('')}</div>${p.warnings.length?`<ul class="hint">${p.warnings.map(x=>`<li>${e(x)}</li>`).join('')}</ul>`:''}<p class="hint">地点匹配和道路时间仍需在行程地图中确认；不代表天气、开放或安全状态已核实。</p><div class="form-actions">${btn('放弃草稿','chat-discard','secondary')}${btn(draft.mode==='adjust'?'确认应用到第 '+(draft.day+1)+' 天':'保存为新旅行','chat-apply','primary','save')}</div></section>`;
  }
  function page(){
    const s=ensure(),canTalk=status?.ready&&status.features?.chat;
    return `<section id="conversation-page"><div class="page-head"><div><h1>问 AI</h1><p class="muted">从找灵感，到旅途中改计划，在这里接着聊</p></div>${btn('新对话','chat-reset','secondary','plus')}</div><div class="segmented">${btn('规划新旅行','chat-mode',mode==='new'?'primary':'secondary','',`data-mode="new"`)}${btn('调整当前旅行','chat-mode',mode==='adjust'?'primary':'secondary','',`data-mode="adjust"`)}</div><div class="chat-welcome card flat section-space"><strong>${mode==='new'?'还没想好去哪儿？说说想做什么。':'旅行中有变化？告诉我想保留和调整的安排。'}</strong><p class="hint">${mode==='new'?'例如：周末想在广州附近玩水，带孩子，开车一小时以内。':'例如：上午已经逛完，下午下雨，想换成室内活动。'}</p><div class="choices">${(mode==='new'?['附近玩水','轻松徒步','带娃半日游']:['下午改室内','今天少走路','晚一点出门']).map(text=>btn(text,'chat-prompt','soft','',`data-prompt="${e(text)}"`)).join('')}</div></div><div class="chat-transcript" aria-live="polite">${s.history.map(x=>`<article class="chat-bubble ${x.role}"><span class="hint">${x.role==='user'?'你':'旅策 AI'}</span><p>${e(x.content)}</p></article>`).join('')}</div>${s.searchMessage?`<p class="hint section-space">${e(s.searchMessage)}</p>`:''}${s.candidates.length?`<div class="favorite-grid section-space">${s.candidates.slice(0,3).map((p,i)=>`<article class="card flat"><span class="pill">高德真实地点</span><h3 class="section-space">${e(p.name)}</h3><p class="hint">${e(p.city+' '+p.address)}</p>${btn('围绕这里继续规划','chat-place','soft full','pin',`data-index="${i}"`)}</article>`).join('')}</div>`:''}${preview()}<form data-form="conversation" class="card flat section-space"><fieldset ${operation?'disabled':''}>${conditionFields(s)}<label class="field section-space">${mode==='adjust'?'这次想怎么调整？':'想去哪儿，或想做什么？'}<textarea name="message" rows="3" maxlength="1200" placeholder="一句话描述你的想法…">${e(s.seed)}</textarea></label></fieldset><p class="hint">发送本次消息、必要对话和出行条件；调整时包含当天地点名称和时间。不发送成员姓名、账单、已有私人备注或你的精确定位。请勿在消息中填写密钥等敏感信息。</p><p class="form-error" role="alert"></p><div class="form-actions">${operation?btn('取消请求','chat-cancel','secondary'):`<button type="submit" class="btn secondary" data-intent="talk" ${!canTalk?'disabled':''}>发送</button><button type="submit" class="btn primary" data-intent="generate" ${!status?.ready?'disabled':''}>${mode==='adjust'?'生成调整草稿':'生成行程草稿'}</button>`}</div><p class="hint" id="chat-status" role="status">${operation?'AI 正在整理，请稍等…':checking?'正在连接 AI 服务…':!status?.ready?'AI 暂不可用，请稍后重试':!canTalk?'对话服务待管理员更新；当前可以按出行条件生成草稿':'DeepSeek 已连接；AI 建议不替代实际开放、安全与道路核实'}</p>${btn('刷新服务状态','chat-refresh','text')}</form></section>`;
  }
  async function mount(force=false){if(checking||operation||(status&&!force))return;checking=true;try{status=await getAIStatus();}catch{status={ready:false};}finally{checking=false;if(document.querySelector('#conversation-page'))rerender();}}
  async function submit(form,intent){
    if(operation)return;const s=ensure(),data=new FormData(form),error=form.querySelector('.form-error');error.textContent='';
    let input,signature,targetDay=s.day,targetId=currentTrip().id;
    try{
      if(!status?.ready)throw Error('AI 服务尚未连接');
      let text=String(data.get('message')||'').trim();if(!text&&intent!=='generate')throw Error('先说说你的想法吧');if(!text)text=mode==='adjust'?'按目前条件调整当天行程，保持顺路并留出交通休息时间':'请按目前条件生成完整行程草稿';
      if(mode==='adjust'){
        targetDay=Number(data.get('targetDay'));if(!Number.isInteger(targetDay)||!currentTrip().days[targetDay])throw Error('请选择要调整的日期');s.day=targetDay;
        const t=currentTrip();s.conditions={city:t.city,date:dayDate(t.date,targetDay),count:1,people:t.members.length,budgetCents:Math.min(t.budget,100000000),pace:t.pace,preferences:t.preferences};signature=daySignature(t.days[targetDay]);
      }else{
        s.names=String(data.get('members')||'').split(/[,，、\n]/).map(x=>x.trim()).filter(Boolean);
        s.conditions={...s.conditions,city:String(data.get('city')||'').trim(),date:String(data.get('date')||''),count:Number(data.get('count')),people:s.names.length,budgetCents:toCents(data.get('budget')),pace:String(data.get('pace'))};
        if(s.conditions.date<localDate())throw Error('新旅行日期不能早于今天');
        makeTrip({city:s.conditions.city||'待定',date:s.conditions.date,count:s.conditions.count,names:s.names,budget:s.conditions.budgetCents});
      }
      input={mode,message:text,conditions:s.conditions,history:s.history.slice(-6).map(x=>({role:x.role,content:x.content.slice(0,700)})),...(mode==='adjust'?{current:safeDayContext(currentTrip(),targetDay)}:{}),intent};
      s.history.push({role:'user',content:text});s.seed='';s.searchMessage='';s.candidates=[];draft=null;
      const op=new AbortController();operation=op;rerender();
      try{
        let response;
        if(status.features?.chat)response=await requestChat(input,{signal:op.signal});
        else{
          if(intent!=='generate')throw Error('对话服务尚待更新');
          const base=validateAIRequest({...s.conditions,notes:mode==='adjust'?(text+'；原行程（不含私人备注）：'+JSON.stringify(input.current)).slice(0,2000):text});
          response={kind:'plan',reply:'草稿已生成，确认后再保存。',conditions:s.conditions,plan:await requestAIPlan(base,{signal:op.signal}),candidates:[]};
        }
        if(op.signal.aborted||operation!==op)return;
        s.conditions=response.conditions;s.history.push({role:'assistant',content:response.reply});s.candidates=response.candidates||[];for(const place of s.candidates)if(!s.knownPlaces.some(x=>x.id===place.id))s.knownPlaces.push(place);s.knownPlaces=s.knownPlaces.slice(-20);s.searchMessage=response.searchMessage||'';
        if(mode==='new'){s.names=Array.from({length:s.conditions.people},(_,i)=>s.names[i]||(i===0?'我':'同行者'+(i+1)));}
        if(response.plan){
          const known=s.knownPlaces;response.plan.days.forEach(d=>d.items.forEach(x=>{const p=known.find(p=>p.name===x.title);if(p)x.place=p;}));
          if(mode==='adjust')for(const item of response.plan.days[0].items){const old=currentTrip().days[targetDay]?.items.find(x=>x.title===item.title);if(old&&validPlace(old.place)&&!validPlace(item.place))item.place=old.place;}
          const matchedPlan=await matchPlanPlaces(response.plan,s.conditions.city,{signal:op.signal,onProgress:progress=>{const node=document.querySelector('#chat-status');if(node)node.textContent=`AI 草稿已生成，正在匹配高德 ${progress.done}/${progress.total} · ${progress.title||'整理结果'}`;}});
          if(op.signal.aborted||operation!==op)return;
          draft={mode,plan:matchedPlan,conditions:{...s.conditions},names:[...s.names],tripId:targetId,day:targetDay,signature};
        }
      }catch(err){if(!op.signal.aborted&&operation===op)s.history.push({role:'assistant',content:err.message||'本次对话未完成，已有行程未修改。'});}
      finally{if(operation===op){operation=null;rerender();document.querySelector('#chat-draft')?.scrollIntoView({behavior:'smooth',block:'start'});}}
    }catch(err){error.textContent=err.message||'请检查出行条件';}
  }
  function apply(){
    if(!draft)return;
    try{
      if(draft.mode==='adjust'){
        if(currentTrip().id!==draft.tripId)throw Error('当前旅行已切换，请返回原旅行后重新调整');
        const updated=applyDayRevision(currentTrip(),draft.day,draft.plan,draft.signature);replaceTrip(updated,draft.day);draft=null;
      }else{
        const c=draft.conditions;if(c.date<localDate())throw Error('新旅行日期不能早于今天，请继续问 AI 修改日期');const t=makeTrip({city:c.city,date:c.date,count:c.count,names:draft.names,budget:c.budgetCents,pace:c.pace,preferences:c.preferences});
        t.title=draft.plan.title;t.days=draft.plan.days.map(d=>({...d,id:uid(),items:d.items.map(x=>({...x,id:uid()}))}));t.generation={kind:'ai',provider:'DeepSeek',model:'deepseek-flash',generatedAt:new Date().toISOString(),summary:draft.plan.summary,warnings:draft.plan.warnings};
        if(!validTrip(t))throw Error('草稿格式无法保存');addTrip(t);draft=null;
      }
    }catch(error){toast(error.message);}
  }
  return {page,mount,start,suspend,handleSubmit(form,intent){if(form.dataset.form!=='conversation')return false;submit(form,intent);return true;},actions:{
    'chat-mode':el=>{start(el.dataset.mode);rerender();},'chat-reset':()=>{start(mode);rerender();},'chat-prompt':el=>{ensure().seed=el.dataset.prompt;rerender();document.querySelector('[name="message"]')?.focus();},
    'chat-place':el=>{const s=ensure(),p=s.candidates[Number(el.dataset.index)];if(!validPlace(p))return;s.seed=`我选「${p.name}」（${p.city} ${p.address}），请围绕这里继续安排，先确认还缺哪些条件。`;if(mode==='new')s.conditions.city=p.city||s.conditions.city;rerender();},
    'chat-match-place':el=>{const active=draft,item=active?.plan.days[Number(el.dataset.day)]?.items[Number(el.dataset.item)];if(!item)return;choosePlace({title:item.title,city:active.conditions.city,candidates:item.placeMatch?.candidates,onChoose:place=>{if(draft!==active)return;item.place=place;item.placeMatch={status:'matched',query:item.title.slice(0,60),message:'用户已确认高德地点',candidates:[]};rerender();}});},
    'chat-cancel':()=>{suspend();rerender();},'chat-discard':()=>{draft=null;rerender();},'chat-apply':apply,'chat-refresh':()=>mount(true)
  }};
}
