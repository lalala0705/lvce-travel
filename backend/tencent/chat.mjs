import {quota,getSavedKey,unsealKey} from '../worker/index.js';
import {validateChatRequest,createChatMessages,normalizeChatResult} from '../../dist/chat-schema.js';
const ORIGIN='https://lalala0705.github.io';
export function createChat({env,mapService,fetcher=fetch}){
  return {async fetch(request){
    const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(request.headers.get('Origin')===ORIGIN?{'Access-Control-Allow-Origin':ORIGIN,'Vary':'Origin'}:{})};
    const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers});
    let timer;const controller=new AbortController();const cancel=()=>controller.abort();
    try{
      if(request.headers.get('Origin')!==ORIGIN)return json({message:'来源未获允许'},403);
      if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type'}});
      if(request.method!=='POST')return json({message:'不支持此操作'},405);
      if(!request.headers.get('Content-Type')?.startsWith('application/json'))return json({message:'请使用 JSON 请求'},415);
      const text=await request.text();if(text.length>20000)return json({message:'对话内容过长，请开启新对话'},413);
      let raw,input;try{raw=JSON.parse(text);input=validateChatRequest(raw);}catch(error){return json({message:error instanceof SyntaxError?'消息格式不正确':error.message},400);}
      if(typeof raw.requestId!=='string'||!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(raw.requestId))return json({message:'请求标识不正确'},400);
      const encrypted=await getSavedKey(env);if(!encrypted)return json({message:'AI 服务尚未配置'},503);
      const key=await unsealKey(encrypted,env);
      await quota(env,request,raw.requestId);
      if(request.signal.aborted)return json({message:'对话已取消'},499);
      request.signal.addEventListener('abort',cancel,{once:true});timer=setTimeout(cancel,90000);
      const response=await fetcher('https://api.deepseek.com/chat/completions',{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({model:'deepseek-flash',messages:createChatMessages(input),stream:false,thinking:{type:'disabled'},response_format:{type:'json_object'},max_tokens:Math.min(12000,1800+(input.conditions.count||1)*1100)})});
      if(!response.ok){await response.body?.cancel();return json({message:[401,403].includes(response.status)?'AI 服务授权失效，请联系管理员':response.status===402?'AI 服务余额不足':'AI 服务暂不可用，请稍后再试'},503);}
      const reader=response.body.getReader();let size=0,body='',decoder=new TextDecoder();
      try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>300000){await reader.cancel();throw Error();}body+=decoder.decode(value,{stream:true});}body+=decoder.decode();}finally{reader.releaseLock();}
      const completion=JSON.parse(body);if(completion.choices?.[0]?.finish_reason==='length')throw Error();
      const result=normalizeChatResult(completion.choices?.[0]?.message?.content,input);
      if(result.kind==='search'){
        const lookup=await mapService.fetch(new Request('https://internal/api/maps/search',{method:'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json','CF-Connecting-IP':request.headers.get('CF-Connecting-IP')||'unknown'},body:JSON.stringify(result.search),signal:controller.signal}));
        const places=await lookup.json();result.candidates=lookup.ok?places.places:[];
        result.searchMessage=lookup.ok?(result.candidates.length?'以下是高德返回的真实地点，请选择或继续描述要求':'未找到匹配地点，可换一个关键词或城市'):places.message||'地图查询暂不可用';
      }
      return json({...result,model:'deepseek-flash'});
    }catch(error){
      if(error?.status)return json({message:error.message},error.status);
      return json({message:controller.signal.aborted?'对话超时或已取消，已有行程未修改':'AI 回复暂未通过检查，请稍后再试'},controller.signal.aborted?504:502);
    }finally{clearTimeout(timer);request.signal.removeEventListener('abort',cancel);}
  }};
}
