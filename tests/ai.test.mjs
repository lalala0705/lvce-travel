import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {validateAIRequest,createAIMessages,normalizeAIPlan} from '../dist/ai-schema.js';
import {getAIStatus,requestAIPlan} from '../dist/ai-api.js';
import {createWorker,sealKey,unsealKey} from '../backend/worker/index.js';

const input={city:'苏州',date:'2027-04-05',count:1,budgetCents:200000,people:2,pace:'慢逛休闲',preferences:['自然风光'],notes:'想看园林'};
const sample=()=>({title:'苏州园林慢游',summary:'留一点时间给园林。',warnings:['开放时间需自行确认'],days:[{title:'园林与街巷',items:[{time:'09:00',title:'拙政园',type:'景点',duration:120,costYuan:80,note:'先确认预约规则'},{time:'12:00',title:'平江路午餐',type:'餐饮',duration:60,costYuan:50,note:'慢慢吃'}]}]});
const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const fakeKey='test-only-not-a-real-provider-key';
const baseEnv=()=>({ADMIN_EMAIL:'owner@example.invalid',ENCRYPTION_KEY:btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))),AI_DAILY_LIMIT:'20',AI_HOURLY_IP_LIMIT:'3'});
function database(){
  const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../backend/drizzle/0000_ai.sql',import.meta.url),'utf8'));
  const statement=(sql,values=[])=>({bind(...v){return statement(sql,v);},async first(column){const r=db.prepare(sql).get(...values);return column?r?.[column]??null:r??null;},async run(){return db.prepare(sql).run(...values);}});
  return {prepare:sql=>statement(sql),async batch(queries){db.exec('BEGIN');try{const result=[];for(const q of queries)result.push(await q.run());db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}},close:()=>db.close()};
}
const origin='https://lalala0705.github.io';
function api(body,{path='/api/generate',headers={}}={}){return new Request('https://service.example'+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...headers},body:JSON.stringify(body)});}
async function configuredEnv(){const env={...baseEnv(),DB:database()};await env.DB.prepare("INSERT INTO ai_settings(name,value,updated_at) VALUES('deepseek-key',?,?)").bind(await sealKey(fakeKey,env),'now').run();return env;}

test('request whitelisting excludes member names, bills, keys and arbitrary fields',()=>{
  const p=validateAIRequest({...input,names:['私密姓名'],expenses:[123],key:'secret'});
  assert.equal(JSON.stringify(p).includes('私密姓名'),false);assert.deepEqual(Object.keys(p).sort(),['budgetCents','city','count','date','notes','pace','people','preferences'].sort());
  assert.equal(createAIMessages(p)[1].content.includes('私密姓名'),false);
});
test('AI input validation bounds request cost and accepts real calendar dates only',()=>{
  for(const bad of [{count:8},{count:0},{people:13},{budgetCents:1e9},{date:'2027-02-30'},{notes:'x'.repeat(2001)},{pace:'任意内容'}])assert.throws(()=>validateAIRequest({...input,...bad}));
});
test('AI JSON normalization handles code fences, uses integer cents and drops injected fields',()=>{
  const source={...sample(),apiKey:'secret',expenses:[1]};source.days[0].items[0].id='untrusted-id';
  const plan=normalizeAIPlan('```json\n'+JSON.stringify(source)+'\n```',input);
  assert.equal(plan.days[0].items[0].cost,8000);assert.equal('apiKey' in plan,false);assert.equal('id' in plan.days[0].items[0],false);
});
test('invalid AI plans are rejected atomically, including partial days and overlapping times',()=>{
  assert.throws(()=>normalizeAIPlan({...sample(),days:[]},input));
  const overlapping=sample();overlapping.days[0].items[1].time='10:00';assert.throws(()=>normalizeAIPlan(overlapping,input),/重叠/);
  const overnight=sample();overnight.days[0].items[1].time='23:50';assert.throws(()=>normalizeAIPlan(overnight,input),/跨日/);
  const broken=sample();broken.days[0].items[0].costYuan=0.001;assert.throws(()=>normalizeAIPlan(broken,input),/费用/);
});
test('provider secrets are encrypted at rest and a different master key cannot decrypt',async()=>{
  const env=baseEnv(),cipher=await sealKey(fakeKey,env);assert.equal(cipher.includes(fakeKey),false);assert.equal(await unsealKey(cipher,env),fakeKey);await assert.rejects(()=>unsealKey(cipher,baseEnv()));
});
test('anonymous and cross-origin callers cannot configure provider credentials',async()=>{
  let calls=0;const worker=createWorker(async()=>{calls++;return response({});}),env={...baseEnv(),DB:database()};
  const r=await worker.fetch(api({key:fakeKey},{path:'/api/admin/key'}),env);assert.equal(r.status,403);assert.equal(calls,0);env.DB.close();
});
test('only the authenticated owner can save a verified key; API never echoes it',async()=>{
  const env={...baseEnv(),DB:database()};let calls=0;
  const worker=createWorker(async(url,options)=>{assert.equal(url,'https://api.deepseek.com/models');assert.equal(options.headers.Authorization,'Bearer '+fakeKey);calls++;return response({data:[]});});
  const r=await worker.fetch(api({key:fakeKey},{path:'/api/admin/key',headers:{Origin:'https://service.example','oai-authenticated-user-id':'owner-site-user','oai-authenticated-user-email':env.ADMIN_EMAIL}}),env);
  assert.equal(r.status,200);assert.equal((await r.text()).includes(fakeKey),false);assert.equal(calls,1);
  const status=await worker.fetch(new Request('https://service.example/api/status'),env);assert.equal((await status.json()).ready,true);
  const wrong=await worker.fetch(api({key:fakeKey},{path:'/api/admin/key',headers:{Origin:'https://service.example','oai-authenticated-user-id':'other-user','oai-authenticated-user-email':'other@example.invalid'}}),env);assert.equal(wrong.status,403);
  const page=await worker.fetch(new Request('https://service.example/admin',{headers:{'oai-authenticated-user-id':'owner-site-user','oai-authenticated-user-email':env.ADMIN_EMAIL}}),env);assert.equal((await page.text()).includes(fakeKey),false);env.DB.close();
});
test('unconfigured service fails clearly without any model call',async()=>{
  let calls=0;const worker=createWorker(async()=>{calls++;return response({});}),env={...baseEnv(),DB:database()};
  const r=await worker.fetch(api({...input,requestId:crypto.randomUUID()}),env);assert.equal(r.status,503);assert.equal(calls,0);assert.match((await r.json()).message,/未配置/);env.DB.close();
});
test('valid generation uses only fixed DeepSeek URL, normalized plan and exact CORS origin',async()=>{
  const env=await configuredEnv();let calls=0;
  const worker=createWorker(async(url,options)=>{calls++;assert.equal(url,'https://api.deepseek.com/chat/completions');const request=JSON.parse(options.body);assert.equal(request.model,'deepseek-flash');assert.equal(request.response_format.type,'json_object');assert.equal(options.redirect,'error');assert.equal(JSON.stringify(request).includes('private-name'),false);return response({choices:[{finish_reason:'stop',message:{content:JSON.stringify(sample())}}]});});
  const r=await worker.fetch(api({...input,requestId:crypto.randomUUID(),members:['private-name']}),env);assert.equal(r.status,200);assert.equal(r.headers.get('Access-Control-Allow-Origin'),origin);const body=await r.json();assert.equal(body.plan.days[0].items[0].cost,8000);assert.equal(JSON.stringify(body).includes(fakeKey),false);assert.equal(calls,1);env.DB.close();
});
test('origin checks, input checks, duplicate prevention and atomic quotas bound paid calls',async()=>{
  const env=await configuredEnv();env.AI_DAILY_LIMIT='2';env.AI_HOURLY_IP_LIMIT='20';let calls=0;
  const worker=createWorker(async()=>{calls++;return response({choices:[{finish_reason:'stop',message:{content:JSON.stringify(sample())}}]});});
  const id=crypto.randomUUID();assert.equal((await worker.fetch(api({...input,requestId:id},{headers:{Origin:'https://evil.example'}}),env)).status,403);
  assert.equal((await worker.fetch(api({...input,count:50,requestId:id}),env)).status,400);
  assert.equal((await worker.fetch(api({...input,requestId:id}),env)).status,200);
  assert.equal((await worker.fetch(api({...input,requestId:id}),env)).status,409);
  assert.equal((await worker.fetch(api({...input,requestId:crypto.randomUUID()}),env)).status,200);
  assert.equal((await worker.fetch(api({...input,requestId:crypto.randomUUID()}),env)).status,429);assert.equal(calls,2);env.DB.close();
});
test('upstream errors, secret-bearing provider bodies and truncated JSON are not exposed or retried',async()=>{
  for(const [status,content] of [[401,{message:fakeKey}],[200,{choices:[{finish_reason:'length',message:{content:'{'}}]}]]){
    const env=await configuredEnv();let calls=0;const w=createWorker(async()=>{calls++;return response(content,status);});
    const r=await w.fetch(api({...input,requestId:crypto.randomUUID()}),env);assert.ok(r.status>=400);assert.equal((await r.text()).includes(fakeKey),false);assert.equal(calls,1);env.DB.close();
  }
});
test('frontend sends no provider key or names and validates normalized server results',async()=>{
  const plan=normalizeAIPlan(sample(),input);let sent;
  const r=await requestAIPlan({...input,members:['private-name'],key:fakeKey},{fetcher:async(url,options)=>{sent=JSON.parse(options.body);assert.equal(options.credentials,'omit');assert.equal(options.headers.Authorization,undefined);return response({plan,model:'test-model'});}});
  assert.equal(r.title,sample().title);assert.equal(JSON.stringify(sent).includes(fakeKey),false);assert.equal(JSON.stringify(sent).includes('private-name'),false);
});
test('frontend cancellation aborts the request and never retries',async()=>{
  const controller=new AbortController();let calls=0;
  const promise=requestAIPlan(input,{signal:controller.signal,fetcher:async(url,opts)=>{calls++;return new Promise((resolve,reject)=>opts.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true}));}});
  controller.abort();await assert.rejects(promise,err=>err.name==='AbortError');assert.equal(calls,1);
});
test('public service status contains no credential',async()=>{
  const result=await getAIStatus(async()=>response({ready:false,model:'deepseek-flash',message:'未配置'}));assert.equal(result.ready,false);assert.equal('key' in result,false);
});
