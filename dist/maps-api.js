import {validPlace} from './place-schema.js';
export {validPlace} from './place-schema.js';
import {AI_BASE} from './ai-api.js';
export async function mapsRequest(path,{body,signal,fetcher=fetch}={}){
  let response;try{response=await fetcher(AI_BASE+'/api/maps/'+path,{method:body?'POST':'GET',mode:'cors',credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'strict-origin-when-cross-origin',headers:body?{'Content-Type':'application/json'}:{},...(body?{body:JSON.stringify(body)}:{}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(40000)]):AbortSignal.timeout(40000)});}catch(error){if(signal?.aborted)throw error;throw new Error('暂时无法连接地图服务，可继续使用外部导航');}
  let value;try{value=await response.json();}catch{throw new Error('地图服务暂未就绪，可继续使用外部导航');}
  if(!response.ok)throw new Error(response.status===404?'地图服务正在准备，可继续手动规划':value.message||'地图查询暂未完成');
  return value;
}
let loading;
export function loadAMap(config){
  if(!config.ready||!config.jsKey||config.serviceHost!=='https://kuaitrip.cn/lvce-ai/_AMapService')return Promise.reject(new Error('地图服务尚未配置'));
  if(globalThis.AMap)return Promise.resolve(globalThis.AMap);
  if(loading)return loading;
  loading=new Promise((resolve,reject)=>{
    globalThis._AMapSecurityConfig={serviceHost:config.serviceHost};
    const script=document.createElement('script');script.src='https://webapi.amap.com/maps?v=2.0&key='+encodeURIComponent(config.jsKey);script.async=true;
    const fail=()=>{clearTimeout(timer);script.remove();loading=null;reject(new Error('地图加载失败，请检查网络或使用外部导航'));};
    const timer=setTimeout(fail,20000);
    script.onerror=fail;script.onload=()=>{clearTimeout(timer);if(globalThis.AMap)resolve(globalThis.AMap);else fail();};
    document.head.append(script);
  });
  return loading;
}

export function placeLink(city,item){return item.place&&validPlace(item.place)?`https://uri.amap.com/marker?position=${item.place.location.join(',')}&name=${encodeURIComponent(item.place.name)}&src=lvce&coordinate=gaode&callnative=0`:`https://uri.amap.com/search?keyword=${encodeURIComponent(city+' '+item.title)}&callnative=0`;}
