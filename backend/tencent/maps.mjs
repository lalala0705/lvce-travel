import {createHash} from 'node:crypto';
const ORIGIN='https://lalala0705.github.io';
const REST='https://restapi.amap.com';
const JSON_HEADERS={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
class MapError extends Error {constructor(message,status=400){super(message);this.status=status;}}
const text=(v,max)=>typeof v==='string'?v.slice(0,max):'';
export function coordinate(value){
  if(!Array.isArray(value)||value.length!==2||!value.every(Number.isFinite)||Math.abs(value[0])>180||Math.abs(value[1])>90)throw new MapError('地点坐标无效');
  return value.map(n=>Number(n.toFixed(6)));
}
function location(value){if(typeof value!=='string'||!/^[-+]?\d+(?:\.\d+)?,[-+]?\d+(?:\.\d+)?$/.test(value))throw new MapError('高德未返回有效坐标',502);return coordinate(value.split(',').map(Number));}
function place(p){
  try{return {id:text(p.id,100),name:text(p.name,80),address:text(p.address,200),city:text(p.cityname,30),district:text(p.adname,50),location:location(p.location),distance:typeof p.distance==='string'&&/^\d+(\.\d+)?$/.test(p.distance)?Number(p.distance):null,source:'amap',coordinateSystem:'GCJ-02'};}catch{return null;}
}
export function createMaps({db,salt,jsKey='',webKey='',securityCode='',fetcher=fetch}){
  const ready=!!(jsKey&&webKey&&securityCode);
  function reserve(request,proxy=false){
    const now=Math.floor(Date.now()/1000),date=new Date(Date.now()+28800000).toISOString().slice(0,10);
    const ip=createHash('sha256').update(salt+':'+request.headers.get('CF-Connecting-IP')).digest('hex').slice(0,32);
    const names=[`maps:${proxy?'sdk':'rest'}:day:${date}`,`maps:${proxy?'sdk':'rest'}:ip:${Math.floor(now/3600)}:${ip}`];
    const limits=proxy?[2000,300]:[1000,60];
    db.exec('BEGIN IMMEDIATE');
    try{
      for(let i=0;i<names.length;i++){
        const row=db.prepare('SELECT amount FROM ai_quota WHERE name=?').get(names[i]);
        if(row&&row.amount>=limits[i])throw new MapError('地图查询较频繁，请稍后再试',429);
      }
      for(const name of names)db.prepare('INSERT INTO ai_quota(name,amount,expires_at) VALUES(?,1,?) ON CONFLICT(name) DO UPDATE SET amount=amount+1').run(name,now+172800);
      db.prepare('DELETE FROM ai_quota WHERE expires_at < ?').run(now);db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
  }
  async function bounded(response,max=1000000){
    const reader=response.body?.getReader();if(!reader)return '';
    let length=0,result='';const decoder=new TextDecoder();
    try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>max){await reader.cancel();throw new MapError('地图结果过大，请缩小查询范围',502);}result+=decoder.decode(value,{stream:true});}return result+decoder.decode();}finally{reader.releaseLock();}
  }
  async function upstream(path,params,request){
    reserve(request);
    const url=new URL(path,REST);url.search=new URLSearchParams({...params,key:webKey,output:'json'});
    const response=await fetcher(url.href,{redirect:'error',signal:AbortSignal.any([request.signal,AbortSignal.timeout(15000)])});
    if(!response.ok){await response.body?.cancel();throw new MapError('高德服务暂不可用',502);}
    let body;try{body=JSON.parse(await bounded(response));}catch(error){if(error instanceof MapError)throw error;throw new MapError('高德返回格式异常',502);}
    if(body.status!=='1')throw new MapError(['10001','10005','10006','10009','10012','10013'].includes(body.infocode)?'高德 Key 或白名单验证未通过，请联系管理员':'高德查询未完成，请稍后再试',502);
    return body;
  }
  async function input(request){
    if(!request.headers.get('Content-Type')?.startsWith('application/json'))throw new MapError('请使用 JSON 请求',415);
    const raw=await request.text();if(raw.length>8000)throw new MapError('查询内容过长',413);
    try{const value=JSON.parse(raw);if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value;}catch{throw new MapError('查询格式不正确');}
  }
  return {async fetch(request){
    const url=new URL(request.url),isProxy=url.pathname.startsWith('/_AMapService/');
    const origin=request.headers.get('Origin');let referred=false;
    try{referred=new URL(request.headers.get('Referer')).origin===ORIGIN;}catch{}
    const allowed=origin===ORIGIN||(!origin&&isProxy&&referred);
    const cors=allowed?{'Access-Control-Allow-Origin':ORIGIN,'Vary':'Origin'}:{};
    const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{...JSON_HEADERS,...cors}});
    try{
      if(!allowed)throw new MapError('地图请求来源未获允许',403);
      if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...cors,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Access-Control-Max-Age':'600'}});
      if(url.pathname==='/api/maps/config'&&request.method==='GET')return json({ready,jsKey:ready?jsKey:'',serviceHost:ready?'https://kuaitrip.cn/lvce-ai/_AMapService':'',message:ready?'高德地图已配置':'地图服务尚未配置，可继续手动规划和使用外部导航'});
      if(!ready)throw new MapError('地图服务尚未配置，可继续手动规划',503);
      if(isProxy&&request.method==='GET'){
        const path=url.pathname.slice('/_AMapService'.length);
        const paths=new Set(['/v4/map/styles','/v3/assistant/coordinate/convert','/v3/ip','/v3/place/text','/v3/place/around','/v3/config/district','/v3/geocode/geo']);
        if(!paths.has(path)||url.search.length>2500)throw new MapError('不支持此地图请求',404);
        if(url.searchParams.has('callback')&&!/^[\w$.]{1,150}$/.test(url.searchParams.get('callback')))throw new MapError('地图回调格式无效');
        reserve(request,true);
        const upstreamURL=new URL(path,path==='/v4/map/styles'?'https://webapi.amap.com':REST);
        upstreamURL.search=url.search;upstreamURL.searchParams.set('key',jsKey);upstreamURL.searchParams.set('jscode',securityCode);
        const result=await fetcher(upstreamURL.href,{redirect:'error',signal:AbortSignal.any([request.signal,AbortSignal.timeout(15000)])});
        if(!result.ok){await result.body?.cancel();throw new MapError('地图服务暂不可用',502);}
        let body=await bounded(result);for(const secret of [webKey,securityCode])body=body.replaceAll(secret,'[redacted]');
        const type=result.headers.get('Content-Type')||'application/json';
        if(!/^(application\/(json|javascript)|text\/javascript)/i.test(type))throw new MapError('地图返回格式异常',502);
        return new Response(body,{headers:{...JSON_HEADERS,...cors,'Content-Type':type}});
      }
      if(url.pathname==='/api/maps/search'&&request.method==='POST'){
        const raw=await input(request);
        if(typeof raw.keywords!=='string'||!raw.keywords.trim()||raw.keywords.length>60)throw new MapError('请输入 1–60 字的地点或活动名称');
        const keywords=raw.keywords.trim();let center=null;
        const radius=raw.radius??10000;if(!Number.isInteger(radius)||radius<1000||radius>50000)throw new MapError('周边范围为 1–50 公里');
        if(raw.gps!==undefined){
          const gps=coordinate(raw.gps);
          const converted=await upstream('/v3/assistant/coordinate/convert',{locations:gps.join(','),coordsys:'gps'},request);
          center=location(converted.locations);
        }else if(raw.location!==undefined)center=coordinate(raw.location);
        let data;
        if(center){
          data=await upstream('/v5/place/around',{keywords,location:center.join(','),radius:String(radius),sortrule:'distance',page_size:'10',page_num:'1'},request);
        }else{
          if(typeof raw.city!=='string'||!raw.city.trim()||raw.city.length>30)throw new MapError('请填写搜索城市，或主动选择使用当前位置');
          data=await upstream('/v5/place/text',{keywords,region:raw.city.trim(),city_limit:'true',page_size:'10',page_num:'1'},request);
        }
        return json({places:(Array.isArray(data.pois)?data.pois:[]).slice(0,10).map(place).filter(Boolean),source:'amap',coordinateSystem:'GCJ-02',nearby:!!center});
      }
      if(url.pathname==='/api/maps/route'&&request.method==='POST'){
        const raw=await input(request);if(!['walking','driving'].includes(raw.mode))throw new MapError('请选择步行或驾车');
        const originPoint=coordinate(raw.origin),destination=coordinate(raw.destination);
        const data=await upstream('/v5/direction/'+raw.mode,{origin:originPoint.join(','),destination:destination.join(','),show_fields:'cost,polyline'},request);
        const path=data.route?.paths?.[0];if(!path)throw new MapError('未找到此路段，请更换交通方式或使用外部导航',404);
        const distance=Number(path.distance),duration=Number(path.cost?.duration??path.duration);
        if(!Number.isFinite(distance)||distance<0)throw new MapError('路线距离无效',502);
        const polyline=[];
        for(const step of (Array.isArray(path.steps)?path.steps:[]).slice(0,1000))for(const pair of text(step.polyline,100000).split(';')){if(!pair)continue;try{polyline.push(location(pair));}catch{}if(polyline.length>=20000)break;}
        return json({distance,duration:Number.isFinite(duration)&&duration>=0?duration:null,polyline:polyline.slice(0,20000),mode:raw.mode,source:'amap',coordinateSystem:'GCJ-02'});
      }
      throw new MapError('未找到此地图接口',404);
    }catch(error){return json({message:error instanceof MapError?error.message:'地图连接暂不可用，请稍后再试'},error instanceof MapError?error.status:502);}
  }};
}
