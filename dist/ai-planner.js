import {makeTrip,localDate,uid,validTrip,money,toCents} from './domain.js';
import {validateAIRequest} from './ai-schema.js';
import {getAIStatus,requestAIPlan} from './ai-api.js';

export function createAIPlanner({sheet,openSheet,btn,icon,e,field,select,toast,currentTrip,addTrip,hasRoom}) {
  let status=null,checking=false,operation=null,draft=null,lastInput=null;
  function serviceCopy(){return status?.ready?'DeepSeek 已就绪 · 生成后先预览，再决定是否保存':checking?'正在检查 AI 服务…':status?.message||'暂时无法连接 AI 服务，请稍后刷新';}
  function updateStatus(){
    const message=sheet.querySelector('#ai-service-message');if(message)message.textContent=serviceCopy();
    const submit=sheet.querySelector('[data-form="ai-trip"] button[type="submit"]');if(submit)submit.disabled=!status?.ready||checking||!!operation;
  }
  async function checkStatus(){if(checking)return;checking=true;updateStatus();try{status=await getAIStatus();}catch{status={ready:false,message:'AI 服务暂时无法连接；本地模板仍可使用。'};}finally{checking=false;updateStatus();}}
  function planner(){
    if(operation)return;
    const current=currentTrip(),p=lastInput||{city:current.city,date:current.date<localDate()?localDate(7):current.date,count:Math.min(current.days.length,7),names:current.members.map(m=>m.name),budgetCents:current.budget,pace:current.pace,preferences:current.preferences,notes:''};
    openSheet('让 AI 安排这次出发',`<p class="hint" style="margin-bottom:18px">按你的预算和节奏，生成一份可以继续调整的计划。只发送目的地、日期、人数、预算和要求，不发送成员姓名、已有账单和私人行程。</p><div class="ai-service-note"><span id="ai-service-message" role="status">${e(serviceCopy())}</span>${btn('刷新状态','ai-refresh','text','')}</div><form data-form="ai-trip"><div class="form-grid">${field('目的地','city',p.city,{full:true,maxlength:30})}${field('出发日期','date',p.date,{type:'date',min:localDate(),max:'2099-12-31'})}${field('天数（1–7 天）','count',p.count,{type:'number',min:1,max:7})}${field('同行人（只保存在本机）','members',p.names.join('，'),{full:true,maxlength:200})}${field('人均总预算（元）','budget',p.budgetCents/100,{type:'number',min:.01,max:1000000,step:'.01'})}${select('旅行节奏','pace',['慢逛休闲','紧凑打卡'],p.pace)}<div class="field full"><span>想体验什么？</span><div class="choices">${['自然风光','当地美食','人文古迹','博物馆','亲子乐园'].map(x=>`<label class="choice"><input type="checkbox" name="pref" value="${x}" ${p.preferences.includes(x)?'checked':''}>${x}</label>`).join('')}</div></div><label class="field full">补充要求（可选）<textarea name="notes" maxlength="2000" placeholder="例如：带一位长辈，少走台阶；每天 10 点后出门；想看日落。请勿填写敏感个人信息。">${e(p.notes)}</textarea></label></div><p class="hint section-space">AI 不会实时核实天气和营业时间。每次提交会消耗服务试用次数及管理员的 API 用量，不自动重试。</p><p class="form-error" role="alert"></p><div class="form-actions">${btn('取消','close')}<button class="btn primary" type="submit" ${status?.ready&&!checking?'':'disabled'}>${icon('sparkles')}AI 生成行程</button></div></form><p class="hint section-space">服务尚未配置？${btn('查看服务说明','ai-service','text')}</p>`);
    checkStatus();
  }
  async function generate(base,input){
    if(operation)return;
    const op={controller:new AbortController()};operation=op;draft=null;
    openSheet('正在为你安排旅程',`<div class="ai-working" aria-busy="true"><span class="ai-spinner" aria-hidden="true"></span><h3>${e(input.city)} · ${input.count} 天的旅行灵感</h3><p class="muted">正在整理地点、用餐与每天的节奏。<br>通常需要几十秒，请稍等一下。</p></div><div class="note">${icon('info')}<p>已有旅行不会被修改。生成后先预览，只有点击「保存为新旅行」才会加入你的计划。</p></div><div class="form-actions">${btn('取消生成','ai-cancel','secondary full')}</div><p class="hint section-space">取消不会保存结果；已发送给模型的请求可能仍产生用量。</p>`);
    try{
      const plan=await requestAIPlan(input,{signal:op.controller.signal});
      if(op.controller.signal.aborted||operation!==op)return;
      const t={...base,title:plan.title,days:plan.days.map(d=>({id:uid(),title:d.title,items:d.items.map(x=>({...x,id:uid()}))})),generation:{kind:'ai',provider:'DeepSeek',model:plan.model,generatedAt:plan.generatedAt,summary:plan.summary,warnings:plan.warnings}};
      if(!validTrip(t))throw new Error('AI 结果暂时无法保存，请稍后重试');
      operation=null;draft=t;preview();
    }catch(err){
      if(op.controller.signal.aborted||operation!==op)return;
      operation=null;openSheet('这次规划暂未完成',`<div class="note">${icon('info')}<div><strong>${e(err.message||'AI 服务暂不可用')}</strong><p class="hint">已有旅行、账单和清单都没有改变。没有自动重试或改用模板冒充 AI 结果。</p></div></div><div class="form-actions">${btn('关闭','close')}${btn('返回修改条件','ai-start','primary')}</div>`);
    }finally{if(operation===op)operation=null;}
  }
  function preview(){
    if(!draft)return;
    const t=draft,g=t.generation,total=t.days.flatMap(d=>d.items).reduce((sum,i)=>sum+i.cost,0);
    openSheet('先看看，这份旅行合不合心意',`<div class="ai-draft-header"><span class="pill">AI 草稿 · 尚未保存</span><h3>${e(t.title)}</h3><p class="muted">${e(g.summary||'按你的出行条件安排的旅行建议。')}</p><p class="hint">${t.days.length} 天 · ${t.members.length} 人 · 已列项目人均预计 ${money(total)}</p></div>${total>t.budget?`<div class="note"><strong class="amber">已列项目预计费用超过人均预算 ${money(total-t.budget)}，保存前请核对。</strong></div>`:''}<div class="ai-draft-days">${t.days.map((d,i)=>`<details ${i===0?'open':''}><summary>第 ${i+1} 天 · ${e(d.title)} <span class="count-badge">${d.items.length} 项</span></summary>${d.items.map(x=>`<div class="ai-draft-item"><strong class="green">${e(x.time)}</strong><div><h3>${e(x.title)}</h3><p>${e(x.note)}</p><span class="hint">${e(x.type)} · ${x.duration} 分钟 · 预计 ${money(x.cost)} / 人</span></div></div>`).join('')}</details>`).join('')}</div>${g.warnings.length?`<div class="note section-space"><div><strong>出发前，再核对一下</strong><ul>${g.warnings.map(x=>`<li>${e(x)}</li>`).join('')}</ul></div></div>`:''}<p class="hint section-space">DeepSeek AI 建议，未实时核实门票、天气和营业时间。预估可能不包含住宿或往返大交通；保存后可继续编辑。</p><div class="form-actions">${btn('放弃草稿','close')}${btn('保存为新旅行','ai-save','primary','save')}</div>`);
  }
  function service(){openSheet('AI 行程服务',`<div class="note">${icon('sparkles')}<div><strong>DeepSeek 统一后端</strong><p id="ai-service-message" class="hint">${e(serviceCopy())}</p></div></div><div class="dialog-copy section-space"><p>用户无需提供 API Key。行程条件通过旅策后端提交给 DeepSeek，成员姓名和账单保留在本机。</p><p>单次最多 7 天；全站每日试用次数与访问频率由服务端限制。管理员配置后，回到这里刷新状态即可使用。</p></div><div class="form-actions">${btn('刷新状态','ai-refresh','soft')}${btn('知道了','close','primary')}</div><p class="hint section-space">管理员在独立后端的部署平台配置密钥，普通用户无需填写。</p>`);checkStatus();}
  sheet.addEventListener('close',()=>{operation?.controller.abort();operation=null;draft=null;});
  return {
    actions:{'ai-start':planner,'ai-refresh':checkStatus,'ai-service':service,'ai-cancel':()=>{operation?.controller.abort();operation=null;sheet.close();toast('已取消生成，已有旅行未修改');},'ai-save':()=>{if(!draft)return;if(!hasRoom()){toast('最多保存 30 份旅行，请先整理已有计划');return;}const t=draft;draft=null;addTrip(t);sheet.close();}},
    handleSubmit(form){
      if(form.dataset.form!=='ai-trip')return false;
      const error=form.querySelector('.form-error');
      try{
        if(operation)return true;
        if(!hasRoom())throw new Error('最多保存 30 份旅行');
        if(!status?.ready)throw new Error('AI 服务尚未就绪，请刷新状态或联系管理员');
        const data=new FormData(form),v=n=>String(data.get(n)||'').trim();
        if(v('date')<localDate())throw new Error('出发日期不能早于今天');
        const names=v('members').split(/[,，、\n]/).map(x=>x.trim()).filter(Boolean);
        const base=makeTrip({city:v('city'),date:v('date'),count:Number(v('count')),names,budget:toCents(v('budget')),pace:v('pace'),preferences:data.getAll('pref')});
        const input=validateAIRequest({city:base.city,date:base.date,count:base.days.length,people:base.members.length,budgetCents:base.budget,pace:base.pace,preferences:base.preferences,notes:v('notes')});
        lastInput={...input,names};generate(base,input);
      }catch(err){error.textContent=err.message||'请检查出行条件';}
      return true;
    }
  };
}
