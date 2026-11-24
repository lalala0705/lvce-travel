import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {createService} from '../backend/tencent/server.mjs';
import {makeTrip,validTrip,parseBackup,encodeShare,decodeShare} from '../dist/domain.js';
import {validPlace,placeLink,mapsRequest} from '../dist/maps-api.js';
const origin='https://lalala0705.github.io';
const credentials={jsKey:'a'.repeat(32),webKey:'b'.repeat(32),securityCode:'c'.repeat(32)};
const example={id:'B123',name:'亲水公园',address:'公园路 1 号',city:'广州市',district:'天河区',location:[113.3,23.1],distance:300,source:'amap',coordinateSystem:'GCJ-02'};
const providerPlace={id:example.id,name:example.name,address:example.address,cityname:example.city,adname:example.district,location:example.location.join(','),distance:'300',key:'do not pass through'};
const request=(path,body,headers={})=>new Request('https://kuaitrip.cn'+path,{method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json','CF-Connecting-IP':'192.0.2.1',...headers},...(body?{body:JSON.stringify(body)}:{})});
async function fixture(fetcher,maps=credentials){const directory=mkdtempSync(tmpdir()+'/lvce-map-');const service=await createService({directory,maps,fetcher});return {...service,directory,close(){service.close();rmSync(directory,{recursive:true,force:true});}};}
const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});

test('map status never returns server credentials and is disabled until all three are configured',async()=>{
  for(const maps of [{},credentials]){
    const service=await fixture(()=>assert.fail('configuration must not query provider'),maps);
    try{const r=await service.fetch(request('/api/maps/config')),body=await r.text();assert.equal(r.status,200);assert.equal(JSON.parse(body).ready,!!maps.jsKey);for(const secret of [credentials.webKey,credentials.securityCode])assert.equal(body.includes(secret),false);}finally{service.close();}
  }
});
test('city POI search strictly uses the server key and a fixed AMap endpoint',async()=>{
  let calls=0;const service=await fixture(async(url)=>{calls++;const u=new URL(url);assert.equal(u.origin,'https://restapi.amap.com');assert.equal(u.pathname,'/v5/place/text');assert.equal(u.searchParams.get('key'),credentials.webKey);assert.equal(u.searchParams.get('city_limit'),'true');assert.equal(u.searchParams.has('callback'),false);return json({status:'1',pois:[providerPlace,{location:'invalid'}]});});
  try{
    const r=await service.fetch(request('/api/maps/search',{city:'广州',keywords:'公园',key:'untrusted',url:'https://evil.invalid',callback:'evil'}));const body=await r.json();assert.equal(r.status,200);assert.deepEqual(body.places,[example]);assert.equal(calls,1);assert.equal(r.headers.get('Access-Control-Allow-Origin'),origin);
    assert.equal((await service.fetch(request('/api/maps/search',{city:'广州',keywords:'公园'},{Origin:'https://evil.invalid'}))).status,403);assert.equal(calls,1);
  }finally{service.close();}
});
test('nearby GPS lookup converts WGS-84 before GCJ-02 POI search, never silently uses IP location',async()=>{
  const calls=[];const service=await fixture(async(url)=>{const u=new URL(url);calls.push(u);return u.pathname.includes('convert')?json({status:'1',locations:'113.306,23.106'}):json({status:'1',pois:[providerPlace]});});
  try{
    const r=await service.fetch(request('/api/maps/search',{keywords:'步道',gps:[113.3,23.1],radius:5000}));assert.equal(r.status,200);assert.equal((await r.json()).nearby,true);assert.equal(calls.length,2);assert.equal(calls[0].searchParams.get('coordsys'),'gps');assert.equal(calls[1].searchParams.get('location'),'113.306,23.106');
    assert.equal((await service.fetch(request('/api/maps/search',{keywords:'公园'}))).status,400);assert.equal(calls.length,2);
    assert.equal((await service.fetch(request('/api/maps/search',{keywords:'公园',gps:[999,0]}))).status,400);assert.equal(calls.length,2);
  }finally{service.close();}
});
test('route lookup returns real distance and bounded road geometry instead of straight lines',async()=>{
  const service=await fixture(async(url)=>{const u=new URL(url);assert.equal(u.pathname,'/v5/direction/walking');assert.equal(u.searchParams.get('show_fields'),'cost,polyline');return json({status:'1',route:{paths:[{distance:'1200',cost:{duration:'900'},steps:[{polyline:'113.3,23.1;113.31,23.11'}]}]}});});
  try{const r=await service.fetch(request('/api/maps/route',{origin:[113.3,23.1],destination:[113.31,23.11],mode:'walking'}));const body=await r.json();assert.equal(body.distance,1200);assert.equal(body.duration,900);assert.deepEqual(body.polyline,[[113.3,23.1],[113.31,23.11]]);assert.equal((await service.fetch(request('/api/maps/route',{origin:[0,0],destination:[0,0],mode:'flying'}))).status,400);}finally{service.close();}
});
test('SDK proxy rejects arbitrary targets and injected keys, keeps security code private',async()=>{
  let calls=0;const service=await fixture(async(url)=>{calls++;const u=new URL(url);assert.equal(u.origin,'https://webapi.amap.com');assert.equal(u.pathname,'/v4/map/styles');assert.equal(u.searchParams.get('key'),credentials.jsKey);assert.equal(u.searchParams.get('jscode'),credentials.securityCode);return json({status:'1',accidentallyReflected:credentials.securityCode});});
  try{
    const r=await service.fetch(request('/_AMapService/v4/map/styles?key=wrong&jscode=wrong'));assert.equal(r.status,200);assert.equal((await r.text()).includes(credentials.securityCode),false);
    assert.equal((await service.fetch(request('/_AMapService/https://evil.invalid'))).status,404);
    assert.equal((await service.fetch(request('/_AMapService/v4/map/styles?callback=alert(1)'))).status,400);
    assert.equal(calls,1);
    const scriptRequest=new Request('https://kuaitrip.cn/_AMapService/v4/map/styles',{headers:{Referer:origin+'/lvce-travel/'}});assert.equal((await service.fetch(scriptRequest)).status,200);
  }finally{service.close();}
});
test('map quotas are persisted separately from AI and provider error bodies are redacted',async()=>{
  let calls=0;const service=await fixture(async()=>{calls++;return json({status:'0',infocode:'10001',info:credentials.webKey});});
  try{
    const r=await service.fetch(request('/api/maps/search',{city:'广州',keywords:'公园'}));assert.equal(r.status,502);assert.equal((await r.text()).includes(credentials.webKey),false);
    const db=new DatabaseSync(service.directory+'/quota.sqlite');db.prepare("UPDATE ai_quota SET amount=60 WHERE name LIKE 'maps:rest:ip:%'").run();db.close();
    const limited=await service.fetch(request('/api/maps/search',{city:'广州',keywords:'公园'}));assert.equal(limited.status,429);assert.equal(calls,1);
  }finally{service.close();}
});
test('POI backup retains validated coordinates while share strips all POI/location metadata',()=>{
  const trip=makeTrip();trip.days[0].items[0].place=example;assert.equal(validTrip(trip),true);
  assert.deepEqual(parseBackup(JSON.stringify({version:1,trips:[trip],activeId:trip.id})).trips[0].days[0].items[0].place,example);
  const shared=decodeShare(encodeShare(trip));assert.equal('place' in shared.days[0].items[0],false);assert.equal(JSON.stringify(shared).includes('113.3'),false);
  trip.days[0].items[0].place={...example,location:[Infinity,0]};assert.equal(validTrip(trip),false);assert.equal(validPlace(trip.days[0].items[0].place),false);
  assert.match(placeLink('广州',{title:'公园',place:example}),/position=113.3,23.1/);
});
test('frontend map searches omit credentials and report errors without changing trips',async()=>{
  const data=await mapsRequest('search',{body:{city:'广州',keywords:'公园'},fetcher:async(url,options)=>{assert.match(url,/kuaitrip.cn\/lvce-ai\/api\/maps\/search$/);assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.deepEqual(JSON.parse(options.body),{city:'广州',keywords:'公园'});return json({places:[example]});}});assert.equal(data.places.length,1);
  await assert.rejects(()=>mapsRequest('search',{body:{city:'广州',keywords:'公园'},fetcher:async()=>new Response('{}',{status:404})}),/正在准备/);
});
