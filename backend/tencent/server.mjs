import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync,writeFileSync,existsSync,chmodSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createWorker,sealKey} from '../worker/index.js';

export async function createService({directory,apiKey='',fetcher=fetch}={}){
  mkdirSync(directory,{recursive:true,mode:0o700});
  const saltPath=directory+'/master-key';
  if(!existsSync(saltPath))writeFileSync(saltPath,randomBytes(32).toString('base64'),{mode:0o600,flag:'wx'});
  const db=new DatabaseSync(directory+'/quota.sqlite');
  chmodSync(directory+'/quota.sqlite',0o600);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  const schema=readFileSync(new URL('../drizzle/0000_ai.sql',import.meta.url),'utf8').replaceAll('CREATE TABLE ','CREATE TABLE IF NOT EXISTS ');
  db.exec(schema);
  const statement=(sql,values=[])=>({bind(...v){return statement(sql,v);},async first(column){const row=db.prepare(sql).get(...values);return column?row?.[column]??null:row??null;},runSync(){return db.prepare(sql).run(...values);},async run(){return this.runSync();}});
  const DB={prepare:sql=>statement(sql),async batch(queries){db.exec('BEGIN');try{const result=[];for(const query of queries)result.push(query.runSync());db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}};
  const env={DB,ENCRYPTION_KEY:readFileSync(saltPath,'utf8').trim(),AI_DAILY_LIMIT:'20',AI_HOURLY_IP_LIMIT:'3'};
  // The deployment environment is the sole key authority. No public administration routes exist.
  db.prepare("DELETE FROM ai_settings WHERE name='deepseek-key'").run();
  if(apiKey){
    if(apiKey.length<10||apiKey.length>4096||/\s/.test(apiKey))throw new Error('Invalid DEEPSEEK_API_KEY');
    await DB.prepare("INSERT INTO ai_settings(name,value,updated_at) VALUES('deepseek-key',?,?)").bind(await sealKey(apiKey,env),new Date().toISOString()).run();
  }
  const worker=createWorker(fetcher);
  return {close:()=>db.close(),async fetch(request){
    const path=new URL(request.url).pathname;
    if(!['/api/status','/api/generate'].includes(path))return new Response(JSON.stringify({message:'未找到此接口'}),{status:404,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
    return worker.fetch(request,env);
  }};
}

export function createHTTPServer(service){
  const server=http.createServer(async(req,res)=>{
    const controller=new AbortController();
    res.on('close',()=>{if(!res.writableEnded)controller.abort();});
    try{
      const headers=new Headers();
      // This port is reachable only through the host's Nginx. Nginx overwrites X-Real-IP.
      for(const name of ['content-type','origin','content-length'])if(req.headers[name])headers.set(name,req.headers[name]);
      headers.set('CF-Connecting-IP',String(req.headers['x-real-ip']||req.socket.remoteAddress));
      const body=[];let size=0;
      for await(const chunk of req){size+=chunk.length;if(size>16000){res.writeHead(413,{'Content-Type':'application/json'});res.end('{"message":"请求内容过长"}');return;}body.push(chunk);}
      const request=new Request(new URL(req.url,'http://localhost'),{method:req.method,headers,signal:controller.signal,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(body)}:{})});
      const result=await service.fetch(request);
      res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()));
    }catch{if(!res.destroyed&&!res.headersSent){res.writeHead(500,{'Content-Type':'application/json'});res.end('{"message":"AI 服务暂不可用"}');}}
  });
  server.requestTimeout=20000;server.headersTimeout=15000;server.timeout=115000;
  return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const service=await createService({directory:process.env.DATA_DIR||'/data',apiKey:process.env.DEEPSEEK_API_KEY||''});
  const server=createHTTPServer(service);
  server.listen(Number(process.env.PORT||8787),'0.0.0.0',()=>console.log('Lvce AI listening on port 8787'));
  for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>server.close(()=>{service.close();process.exit(0);}));
}
