import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {createService,createHTTPServer} from '../backend/tencent/server.mjs';
const input={city:'苏州',date:'2027-04-05',count:1,budgetCents:200000,people:2,pace:'慢逛休闲',preferences:[],notes:''};
const sample={title:'苏州',summary:'慢游',warnings:[],days:[{title:'园林',items:[{time:'09:00',title:'拙政园',type:'景点',duration:120,costYuan:80,note:'确认预约'}]}]};
const api=(ip)=>new Request('http://localhost/api/generate',{method:'POST',headers:{Origin:'https://lalala0705.github.io','Content-Type':'application/json','CF-Connecting-IP':ip},body:JSON.stringify({...input,requestId:crypto.randomUUID()})});
test('Tencent standalone has no admin route and no Sites identity dependency',async()=>{
  const directory=mkdtempSync(tmpdir()+'/lvce-test-');let calls=0;
  const service=await createService({directory,fetcher:async()=>{calls++;throw Error('no provider call');}});
  try{
    assert.equal((await (await service.fetch(new Request('http://localhost/api/status'))).json()).ready,false);
    for(const path of ['/admin','/api/admin/key','/signin-with-chatgpt'])assert.equal((await service.fetch(new Request('http://localhost'+path,{headers:{'oai-authenticated-user-id':'spoofed'}}))).status,404);
    assert.equal((await service.fetch(api('1.2.3.4'))).status,503);assert.equal(calls,0);
  }finally{service.close();rmSync(directory,{recursive:true,force:true});}
});
test('Tencent SQLite quota survives process restarts and separates IPs',async()=>{
  const directory=mkdtempSync(tmpdir()+'/lvce-test-');let calls=0;
  const options={directory,apiKey:'test-only-fake-provider-key',fetcher:async()=>{calls++;return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(sample)}}]}));}};
  let service=await createService(options);
  try{
    assert.equal((await service.fetch(api('1.2.3.4'))).status,200);
    service.close();service=await createService(options);
    assert.equal((await service.fetch(api('1.2.3.4'))).status,200);
    assert.equal((await service.fetch(api('1.2.3.4'))).status,200);
    assert.equal((await service.fetch(api('1.2.3.4'))).status,429);
    assert.equal((await service.fetch(api('5.6.7.8'))).status,200);
    assert.equal(calls,4);
  }finally{service.close();rmSync(directory,{recursive:true,force:true});}
});
test('HTTP adapter rejects oversized requests and does not trust spoofed platform identity',async()=>{
  const directory=mkdtempSync(tmpdir()+'/lvce-test-');const service=await createService({directory});
  const server=createHTTPServer(service);await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+server.address().port;
  try{
    assert.equal((await fetch(base+'/api/status')).status,200);
    assert.equal((await fetch(base+'/admin',{headers:{'oai-authenticated-user-id':'fake'}})).status,404);
    assert.equal((await fetch(base+'/api/generate',{method:'POST',body:'x'.repeat(16001)})).status,413);
  }finally{await new Promise(r=>server.close(r));service.close();rmSync(directory,{recursive:true,force:true});}
});
