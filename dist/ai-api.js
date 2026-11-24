import {validateAIRequest, normalizeAIPlan} from './ai-schema.js';
// Verified Tencent Cloud backend; provider credentials remain on the server.
export const AI_BASE='https://kuaitrip.cn/lvce-ai';
export const AI_ADMIN_URL='';
export async function getAIStatus(fetcher=fetch,base=AI_BASE) {
  if(!base)return {ready:false,model:'DeepSeek',message:'AI 后端正在迁移部署，本地模板仍可使用',maxDays:7};
  const res=await fetcher(base+'/api/status',{credentials:'omit',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!res.ok)throw new Error('AI 服务暂不可用');
  const body=await res.json();
  if(typeof body.ready!=='boolean')throw new Error('AI 服务返回了无效状态');
  return {ready:body.ready,model:typeof body.model==='string'?body.model:'DeepSeek',message:typeof body.message==='string'?body.message:'',maxDays:7,features:{chat:body.features?.chat===true}};
}
export async function requestAIPlan(input,{signal,fetcher=fetch,base=AI_BASE}={}) {
  if(!base)throw new Error('AI 后端正在迁移部署，请稍后再试');
  const payload=validateAIRequest(input);
  const controller=new AbortController();let timedOut=false;
  const cancel=()=>controller.abort();
  if(signal?.aborted)throw new DOMException('已取消生成','AbortError');
  signal?.addEventListener('abort',cancel,{once:true});
  const timer=setTimeout(()=>{timedOut=true;controller.abort();},110000);
  try {
    const res=await fetcher(base+'/api/generate',{method:'POST',mode:'cors',credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,requestId:crypto.randomUUID()})});
    let body;try{body=await res.json();}catch{throw new Error('AI 服务返回异常，请稍后重试');}
    if(!res.ok)throw new Error(typeof body.message==='string'?body.message:'AI 生成未完成，请稍后重试');
    if(controller.signal.aborted)throw new DOMException('已取消生成','AbortError');
    // The server returns cents; reconstruct the strict provider schema to validate again.
    const plan=body.plan;
    if(!plan||!Array.isArray(plan.days))throw new Error('AI 结果格式不正确');
    const normalized=normalizeAIPlan({...plan,days:plan.days.map(d=>({...d,items:Array.isArray(d.items)?d.items.map(i=>({...i,costYuan:i.cost/100})):null}))},payload);
    return {...normalized,model:typeof body.model==='string'?body.model:'DeepSeek',generatedAt:new Date().toISOString()};
  }catch(err){
    if(timedOut)throw new Error('生成等待超时，未修改已有行程；请稍后再试');
    if(signal?.aborted)throw new DOMException('已取消生成','AbortError');
    if(err instanceof TypeError)throw new Error('无法连接 AI 服务，请检查网络后重试');
    throw err;
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
}
