import {AI_BASE} from './ai-api.js';
import {validateChatRequest,normalizeChatResult} from './chat-schema.js';
import {validPlace} from './place-schema.js';
export async function requestChat(input,{signal,fetcher=fetch}={}){
  const payload=validateChatRequest(input);
  let response;try{response=await fetcher(AI_BASE+'/api/chat',{method:'POST',credentials:'omit',redirect:'error',mode:'cors',cache:'no-store',referrerPolicy:'no-referrer',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(110000)]):AbortSignal.timeout(110000),headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,requestId:crypto.randomUUID()})});}catch(error){if(signal?.aborted)throw error;throw new Error('无法连接 AI 对话服务，请稍后再试');}
  let value;try{value=await response.json();}catch{throw new Error('对话服务暂未就绪，请稍后再试');}
  if(!response.ok)throw new Error(response.status===404?'对话服务需要管理员更新，现有行程未修改':value.message||'AI 对话暂未完成');
  if(value.plan&&(!Array.isArray(value.plan.days)||!value.plan.days.every(d=>d&&Array.isArray(d.items))))throw new Error('AI 草稿格式不正确，已有行程未修改');
  // Server plans use cents. Convert back to the strict provider schema for an independent check.
  const checked=normalizeChatResult({...value,...(value.plan?{plan:{...value.plan,days:value.plan.days.map(d=>({...d,items:d.items.map(i=>({...i,costYuan:i.cost/100}))}))}}:{})},payload);
  return {...checked,candidates:Array.isArray(value.candidates)?value.candidates.filter(validPlace).slice(0,10):[],searchMessage:typeof value.searchMessage==='string'?value.searchMessage.slice(0,300):'',model:'deepseek-flash'};
}
