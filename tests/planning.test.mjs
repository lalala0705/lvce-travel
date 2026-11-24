import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {makeDemo,makeTrip,localDate} from '../dist/domain.js';
import {routeScope,routeKey,checkRoute} from '../dist/route-check.js';
import {daySignature,safeDayContext,applyDayRevision,summarizeRevision} from '../dist/revision.js';
import {validateChatRequest,createChatMessages,normalizeChatResult} from '../dist/chat-schema.js';
import {createService} from '../backend/tencent/server.mjs';
const place=(id,x=113.3)=>({id,name:id,address:'测试地址',city:'广州',district:'天河区',location:[x,23.1],source:'amap',coordinateSystem:'GCJ-02'});
const conditions={city:'广州',date:localDate(7),count:1,people:2,budgetCents:200000,pace:'慢逛休闲',preferences:['自然风光']};
const input={mode:'new',message:'周末想去公园',conditions,history:[],intent:'talk'};
const reply=()=>({kind:'advice',reply:'可以先说说想走多久。',conditions});
const request=(body=input)=>new Request('https://kuaitrip.cn/api/chat',{method:'POST',headers:{Origin:'https://lalala0705.github.io','Content-Type':'application/json','CF-Connecting-IP':'192.0.2.1'},body:JSON.stringify({...body,requestId:body.requestId||crypto.randomUUID()})});
async function fixture(fetcher,extra={}){const directory=mkdtempSync(tmpdir()+'/lvce-chat-');const service=await createService({directory,apiKey:'test-only-fake-deepseek-key',fetcher,...extra});return {...service,close(){service.close();rmSync(directory,{recursive:true,force:true});}};}
const model=value=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]}));

test('overall routes keep day labels and cross-day legs while unmatched stops remain unknown',()=>{
  const trip=makeTrip({count:2});trip.days[0].items=trip.days[0].items.slice(0,2);trip.days[1].items=trip.days[1].items.slice(0,1);
  trip.days[0].items[0].place=place('a');trip.days[0].items[1].place=place('b',113.31);
  const view=routeScope(trip,'all');assert.deepEqual(view.points.map(p=>p.label),['1-1','1-2','2-1']);assert.equal(view.segments.length,2);assert.equal(view.segments[1].crossDay,true);assert.equal(view.missing.length,1);
  const check=checkRoute(trip,{scope:'all'});assert.equal(check.complete,false);assert.ok(check.issues.some(x=>x.kind==='missing-place'));
});
test('route checks detect time overlap and insufficient actual transfer time without mutating trip',()=>{
  const trip=makeTrip({count:1}),items=trip.days[0].items;items[0].place=place('a');items[1].place=place('b',113.31);items[2].place=place('c',113.32);
  items[1].time='10:00';items[2].time='12:00';const before=JSON.stringify(trip);
  const view=routeScope(trip),routes=new Map(view.segments.map(s=>[routeKey(s,'driving'),{distance:2000,duration:7200,polyline:[]}]))
  const check=checkRoute(trip,{routes});assert.ok(check.issues.some(x=>x.kind==='overlap'));assert.ok(check.issues.some(x=>x.kind==='travel-gap'));assert.equal(JSON.stringify(trip),before);
  routes.set(routeKey(view.segments[0],'driving'),{error:'查询失败'});assert.equal(checkRoute(trip,{routes}).complete,false);
});
test('day revisions preserve other days, bills, checklist and known POIs; stale revisions cannot apply',()=>{
  const trip=makeDemo(),before=structuredClone(trip);trip.days[0].items[0].place=place('a');trip.days[0].items[0].note='私人备注不发送模型';
  const signature=daySignature(trip.days[0]),plan={days:[{title:'轻松的一天',items:[{...trip.days[0].items[0],time:'10:00',note:'模型备注'}]}]};
  const updated=applyDayRevision(trip,0,plan,signature);assert.equal(updated.days[1],trip.days[1]);assert.equal(updated.expenses,trip.expenses);assert.equal(updated.checklist,trip.checklist);assert.equal(updated.members,trip.members);assert.equal(updated.days[0].items[0].note,'私人备注不发送模型');assert.deepEqual(updated.days[0].items[0].place,place('a'));
  assert.equal(summarizeRevision(trip.days[0],updated.days[0]).removed.length,2);trip.days[0].items[0].time='08:00';assert.throws(()=>applyDayRevision(trip,0,plan,signature),/被修改/);assert.deepEqual(trip.expenses,before.expenses);
});
test('chat context excludes names, expenses, keys, POI coordinates and private notes',()=>{
  const trip=makeDemo();trip.days[0].items[0].note='私密备注';trip.days[0].items[0].place=place('private-coordinate');
  const current=safeDayContext(trip,0),normalized=validateChatRequest({...input,mode:'adjust',current:{...current,names:['姓名'],key:'secret',items:current.items.map(x=>({...x,note:'私密备注',place:place('bad')}))},names:['姓名'],expenses:trip.expenses,key:'secret'});
  const text=JSON.stringify(createChatMessages(normalized));for(const privateValue of ['私密备注','secret','姓名','private-coordinate'])assert.equal(text.includes(privateValue),false);
  assert.equal(JSON.stringify(normalized).includes('expenses'),false);
});
test('chat plan output is validated and cannot change adjustment scope or expose arbitrary fields',()=>{
  const current={title:'一天',items:[]},adjust={...input,mode:'adjust',current};
  const raw={kind:'plan',reply:'已调整',conditions:{...conditions,city:'北京',count:7},plan:{title:'广州公园',summary:'轻松逛逛',warnings:[],days:[{title:'公园',items:[{title:'越秀公园',time:'10:00',duration:90,type:'景点',costYuan:0,note:'确认开放'}]}]},key:'should-drop'};
  const result=normalizeChatResult(raw,adjust);assert.equal(result.conditions.city,'广州');assert.equal(result.conditions.count,1);assert.equal(result.plan.days.length,1);assert.equal('key' in result,false);
  raw.plan.days[0].items.push({title:'重叠',time:'10:30',duration:60,type:'景点',costYuan:0,note:''});assert.throws(()=>normalizeChatResult(raw,adjust),/重叠/);
});
test('new chat endpoint preserves origin checks and shares duplicate prevention',async()=>{
  let calls=0;const service=await fixture(async(url,options)=>{calls++;assert.equal(url,'https://api.deepseek.com/chat/completions');assert.equal(options.redirect,'error');assert.equal(JSON.parse(options.body).model,'deepseek-flash');return model(reply());});
  try{const id=crypto.randomUUID(),first=await service.fetch(request({...input,requestId:id}));assert.equal(first.status,200);assert.equal((await first.json()).kind,'advice');assert.equal((await service.fetch(request({...input,requestId:id}))).status,409);assert.equal(calls,1);const evil=new Request('https://kuaitrip.cn/api/chat',{method:'POST',headers:{Origin:'https://evil.invalid'},body:'{}'});assert.equal((await service.fetch(evil)).status,403);}finally{service.close();}
});
test('unlimited AI removes daily and hourly counts but still rejects duplicate request IDs',async()=>{
  let calls=0;const service=await fixture(async()=>{calls++;return model(reply());},{unlimitedAI:true});
  try{for(let i=0;i<21;i++)assert.equal((await service.fetch(request())).status,200);const id=crypto.randomUUID();assert.equal((await service.fetch(request({...input,requestId:id}))).status,200);assert.equal((await service.fetch(request({...input,requestId:id}))).status,409);assert.equal(calls,22);}finally{service.close();}
});
test('chat discovery candidates come only from actual map search and provider failures are not echoed',async()=>{
  const credentials={jsKey:'a'.repeat(32),webKey:'b'.repeat(32),securityCode:'c'.repeat(32)};
  const service=await fixture(async(url)=>url.startsWith('https://api.deepseek.com')?model({kind:'search',reply:'可以查询公园。',conditions,search:{city:'广州',keywords:'公园'},candidates:[{name:'模型编造'}]}):new Response(JSON.stringify({status:'1',pois:[{id:'B1',name:'越秀公园',address:'公园路',cityname:'广州市',adname:'越秀区',location:'113.26,23.14'}]})),{maps:credentials});
  try{const r=await service.fetch(request());assert.equal(r.status,200);const body=await r.json();assert.equal(body.candidates[0].name,'越秀公园');assert.equal(JSON.stringify(body).includes('模型编造'),false);assert.equal(JSON.stringify(body).includes(credentials.webKey),false);}finally{service.close();}
  const failed=await fixture(async()=>new Response('upstream-secret',{status:401}));try{const r=await failed.fetch(request());assert.equal(r.status,503);assert.equal((await r.text()).includes('upstream-secret'),false);}finally{failed.close();}
});
