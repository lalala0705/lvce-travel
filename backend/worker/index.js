import {validateAIRequest,createAIMessages,normalizeAIPlan} from '../../dist/ai-schema.js';

const PAGE_ORIGIN='https://lalala0705.github.io';
const PROVIDER='https://api.deepseek.com';
const MODEL='deepseek-flash';
const MAX_BODY=16000;
class ServiceError extends Error { constructor(message,status=400){super(message);this.status=status;} }
const json=(body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
function allowOrigin(request){return request.headers.get('Origin')===PAGE_ORIGIN;}
function cors(request){return allowOrigin(request)?{'Access-Control-Allow-Origin':PAGE_ORIGIN,'Vary':'Origin'}:{};}
function administrator(request,env){
  // The Sites dispatcher supplies these authenticated headers; no client credential is accepted.
  const identity=request.headers.get('oai-authenticated-user-id');
  const email=request.headers.get('oai-authenticated-user-email');
  return !!(identity&&email&&env.ADMIN_EMAIL&&email.toLowerCase()===env.ADMIN_EMAIL.toLowerCase());
}
async function smallJson(request,max=MAX_BODY){
  if(!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'))throw new ServiceError('请使用 JSON 请求',415);
  if(Number(request.headers.get('Content-Length')||0)>max)throw new ServiceError('请求内容过长',413);
  const text=await boundedText(request,max);
  try{return JSON.parse(text);}catch{throw new ServiceError('请求格式不正确');}
}
async function boundedText(message,limit){
  const reader=message.body?.getReader();if(!reader)return '';
  const decoder=new TextDecoder();let text='',length=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>limit){await reader.cancel();throw new ServiceError('返回内容过长，请缩短行程',502);}text+=decoder.decode(value,{stream:true});}return text+decoder.decode();}
  finally{reader.releaseLock();}
}
function bytesToBase64(bytes){let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s);}
function base64ToBytes(value){return Uint8Array.from(atob(value),x=>x.charCodeAt(0));}
async function encryptionKey(env){
  if(!env.ENCRYPTION_KEY)throw new ServiceError('AI 服务尚未完成初始化',503);
  return crypto.subtle.importKey('raw',base64ToBytes(env.ENCRYPTION_KEY),'AES-GCM',false,['encrypt','decrypt']);
}
export async function sealKey(value,env){
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},await encryptionKey(env),new TextEncoder().encode(value));
  return JSON.stringify({v:1,iv:bytesToBase64(iv),cipher:bytesToBase64(new Uint8Array(cipher))});
}
export async function unsealKey(value,env){
  const item=JSON.parse(value);if(item.v!==1)throw new Error('Invalid encrypted secret');
  const text=await crypto.subtle.decrypt({name:'AES-GCM',iv:base64ToBytes(item.iv)},await encryptionKey(env),base64ToBytes(item.cipher));
  return new TextDecoder().decode(text);
}
async function getSavedKey(env){return env.DB.prepare("SELECT value FROM ai_settings WHERE name = 'deepseek-key'").first('value');}
async function quota(env,request,requestId){
  const now=Math.floor(Date.now()/1000),date=new Date(Date.now()+8*3600000).toISOString().slice(0,10),hour=Math.floor(now/3600);
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${env.ENCRYPTION_KEY}:${request.headers.get('CF-Connecting-IP')||'unknown'}`));
  const ip=bytesToBase64(new Uint8Array(hash)).slice(0,24);
  const duplicate=await env.DB.prepare('INSERT OR IGNORE INTO ai_requests(id,created_at) VALUES(?,?) RETURNING id').bind(requestId,now).first();
  if(!duplicate)throw new ServiceError('这次生成已经提交，请勿重复发送',409);
  // D1 performs each UPSERT atomically. The global reservation happens before any paid call.
  const daily=Math.min(200,Math.max(1,Number(env.AI_DAILY_LIMIT)||20));
  const perHour=Math.min(20,Math.max(1,Number(env.AI_HOURLY_IP_LIMIT)||3));
  const sql='INSERT INTO ai_quota(name,amount,expires_at) VALUES(?,1,?) ON CONFLICT(name) DO UPDATE SET amount=amount+1 WHERE amount < ? RETURNING amount';
  const global=await env.DB.prepare(sql).bind(`global:${date}`,now+172800,daily).first();
  if(!global)throw new ServiceError('今天的 AI 试用次数已用完，请明天再试',429);
  const local=await env.DB.prepare(sql).bind(`ip:${hour}:${ip}`,now+7200,perHour).first();
  if(!local)throw new ServiceError('生成较频繁，请一小时后再试；已有计划仍可编辑',429);
  await env.DB.batch([env.DB.prepare('DELETE FROM ai_quota WHERE expires_at < ?').bind(now),env.DB.prepare('DELETE FROM ai_requests WHERE created_at < ?').bind(now-172800)]);
}
function upstreamError(status){
  if(status===401||status===403)return new ServiceError('AI 服务授权失效，请联系管理员更新配置',503);
  if(status===402)return new ServiceError('AI 服务余额不足，请联系管理员',503);
  if(status===429)return new ServiceError('AI 服务繁忙，请稍后重试',429);
  return new ServiceError('AI 服务暂未完成生成，请稍后重试',502);
}
const escapeHtml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function adminPage(configured,env){
  const nonce=bytesToBase64(crypto.getRandomValues(new Uint8Array(18)));
  const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>旅策 AI · 管理员配置</title><style>body{font:16px/1.8 system-ui,sans-serif;color:#21362d;background:#f3f7f2;margin:0;padding:24px}main{max-width:560px;margin:32px auto;padding:28px;border:1px solid #dce8df;background:#fff;border-radius:20px}h1{font-size:26px;color:#16745c}label{display:block;margin:22px 0 8px}input,button{font:inherit;width:100%;box-sizing:border-box;padding:13px;border-radius:10px}input{border:1px solid #cbd9ce}button{background:#16745c;color:#fff;border:0;margin:22px 0;cursor:pointer}button:disabled{opacity:.5}a{color:#16745c}.hint{font-size:14px;color:#6e8073}#status{white-space:pre-line;overflow-wrap:anywhere}strong{color:#16745c}</style><main><h1>旅策 AI 服务配置</h1><p>当前状态：<strong>${configured?'已配置 DeepSeek 密钥':'尚未配置密钥'}</strong></p><p class="hint">只有站点管理员登录后才能打开此页面。网页用户无需填写密钥。当前密钥不会回传到浏览器，将在后端加密保存；加密主密钥保存在后端环境变量中。</p><form id="setup"><label for="api-key">${configured?'替换 DeepSeek API Key':'DeepSeek API Key'}</label><input id="api-key" type="password" required autocomplete="off" spellcheck="false" maxlength="4096" placeholder="在这里粘贴自己的 API Key"><p class="hint">点击保存后，仅发送到此后端，并向 api.deepseek.com 验证授权；不会发到聊天或 GitHub。<a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noopener noreferrer">前往 DeepSeek 获取 Key</a></p><button type="submit">验证并保存密钥</button></form><p id="status" role="status" aria-live="polite"></p><p class="hint">模型：${MODEL}。全站每日最多 ${escapeHtml(env.AI_DAILY_LIMIT||'20')} 次，每个来源 IP 每小时最多 ${escapeHtml(env.AI_HOURLY_IP_LIMIT||'3')} 次，单次最多 7 天。额度按提交请求计数，失败不会自动重试。API 用量由你的 DeepSeek 账户计费。</p><p><a href="${PAGE_ORIGIN}/lvce-travel/">返回旅策，生成第一份 AI 行程</a></p></main><script nonce="${nonce}">const f=document.querySelector('#setup'),s=document.querySelector('#status'),k=document.querySelector('#api-key');f.addEventListener('submit',async event=>{event.preventDefault();if(!f.reportValidity())return;const b=f.querySelector('button');b.disabled=true;s.textContent='正在验证并保存…';try{const r=await fetch('/api/admin/key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:k.value}),redirect:'error'});const v=await r.json();if(!r.ok)throw new Error(v.message||'配置未保存');k.value='';s.textContent='已保存。现在可以回到旅策网页使用 AI 规划。';}catch(err){s.textContent=err.message||'保存失败，请检查网络';}finally{b.disabled=false;}});</script></html>`;
  return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':`default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'`,'X-Content-Type-Options':'nosniff'}});
}
export function createWorker(fetcher=fetch){return {async fetch(request,env){
  const url=new URL(request.url),path=url.pathname;
  const headers=cors(request);
  try{
    if(request.method==='OPTIONS'){
      if(!allowOrigin(request))return json({message:'来源未获允许'},403);
      return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Access-Control-Max-Age':'600'}});
    }
    if(path==='/'&&request.method==='GET')return Response.redirect(url.origin+'/admin',302);
    if(path==='/admin'&&request.method==='GET'){
      if(!request.headers.get('oai-authenticated-user-id'))return new Response('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>旅策 AI · 管理员登录</title><main style="font:16px/1.8 system-ui;max-width:520px;margin:60px auto;padding:24px"><h1>旅策 AI 管理员登录</h1><p>请使用创建此服务的 ChatGPT 账号登录后配置 DeepSeek。普通用户直接在旅策网页生成行程，无需登录此管理页。</p><a href="/signin-with-chatgpt?return_to=%2Fadmin" target="_top">使用 ChatGPT 登录管理页</a></main></html>',{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
      if(!administrator(request,env))throw new ServiceError('仅服务管理员可以配置密钥',403);
      if(!env.DB||!env.ENCRYPTION_KEY)throw new ServiceError('AI 服务尚未完成初始化',503);
      return adminPage(!!(await getSavedKey(env)),env);
    }
    if(path==='/api/status'&&request.method==='GET'){
      const ready=!!(env.DB&&env.ENCRYPTION_KEY&&await getSavedKey(env));
      return json({ready,model:MODEL,maxDays:7,message:ready?'DeepSeek AI 行程服务已就绪':'管理员尚未配置 AI 服务，暂时可以使用本地模板'},200,headers);
    }
    if(path==='/api/admin/key'&&request.method==='POST'){
      if(request.headers.get('Origin')!==url.origin||!administrator(request,env))throw new ServiceError('无权修改 AI 服务配置',403);
      if(!env.DB||!env.ENCRYPTION_KEY)throw new ServiceError('服务尚未完成初始化',503);
      const {key}=await smallJson(request,6000);
      if(typeof key!=='string'||key.trim().length<10||key.length>4096||/\s/.test(key.trim()))throw new ServiceError('请输入有效的 DeepSeek API Key');
      const checked=await fetcher(PROVIDER+'/models',{headers:{Authorization:'Bearer '+key.trim()},redirect:'error',signal:AbortSignal.timeout(15000)});
      if(!checked.ok){await checked.body?.cancel();throw new ServiceError('DeepSeek 未能验证此密钥，请核对 Key 与账户状态',400);}
      await checked.body?.cancel();
      await env.DB.prepare("INSERT INTO ai_settings(name,value,updated_at) VALUES('deepseek-key',?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(await sealKey(key.trim(),env),new Date().toISOString()).run();
      return json({saved:true,message:'密钥已加密保存'});
    }
    if(path==='/api/generate'&&request.method==='POST'){
      if(!allowOrigin(request))throw new ServiceError('来源未获允许',403);
      if(!env.DB||!env.ENCRYPTION_KEY)throw new ServiceError('AI 服务尚未配置，请联系管理员',503);
      const raw=await smallJson(request);let input;
      try{input=validateAIRequest(raw);}catch(err){throw new ServiceError(err.message);}
      if(typeof raw.requestId!=='string'||!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(raw.requestId))throw new ServiceError('请求标识不正确');
      const encrypted=await getSavedKey(env);
      if(!encrypted)throw new ServiceError('管理员尚未配置 DeepSeek，暂时可以使用本地模板',503);
      const key=await unsealKey(encrypted,env);
      await quota(env,request,raw.requestId);
      const controller=new AbortController();let timeout=false;
      const cancel=()=>controller.abort();
      if(request.signal.aborted)throw new ServiceError('生成已取消',499);
      request.signal.addEventListener('abort',cancel,{once:true});
      const timer=setTimeout(()=>{timeout=true;controller.abort();},90000);
      try{
        const response=await fetcher(PROVIDER+'/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},redirect:'error',signal:controller.signal,body:JSON.stringify({model:MODEL,messages:createAIMessages(input),stream:false,thinking:{type:'disabled'},response_format:{type:'json_object'},max_tokens:Math.min(12000,1200+input.count*1100)})});
        if(!response.ok){await response.body?.cancel();throw upstreamError(response.status);}
        const text=await boundedText(response,250000);let completion;
        try{completion=JSON.parse(text);}catch{throw new ServiceError('AI 服务返回格式异常，请稍后重试',502);}
        if(completion.choices?.[0]?.finish_reason==='length')throw new ServiceError('AI 行程尚未生成完整，请减少天数后重试',502);
        const content=completion.choices?.[0]?.message?.content;
        if(typeof content!=='string'||!content.trim())throw new ServiceError('AI 暂未返回行程，请稍后重试',502);
        const plan=normalizeAIPlan(content,input);
        return json({plan,model:MODEL},200,headers);
      }catch(err){if(timeout)throw new ServiceError('AI 生成超时，已有行程未修改，请稍后再试',504);if(request.signal.aborted)throw new ServiceError('生成已取消，未保存结果',499);if(err instanceof ServiceError)throw err;throw new ServiceError('AI 返回的行程未通过格式或时间检查，请稍后重试',502);}
      finally{clearTimeout(timer);request.signal.removeEventListener('abort',cancel);}
    }
    return json({message:'未找到此接口'},404,headers);
  }catch(err){return json({message:err instanceof ServiceError?err.message:'AI 服务暂不可用，请稍后再试'},err instanceof ServiceError?err.status:500,headers);}
}};}
export default createWorker();
