import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
const root=resolve('dist');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
const server=http.createServer(async(req,res)=>{try{
  const p=decodeURIComponent(new URL(req.url,'http://localhost').pathname),file=resolve(root,'.'+p+(p.endsWith('/')?'index.html':''));
  if(file!==root&&!file.startsWith(root+sep)){res.writeHead(403);res.end();return;}
  if(!(await stat(file)).isFile())throw new Error('not found');
  res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':'no-cache','Referrer-Policy':'strict-origin-when-cross-origin'});res.end(await readFile(file));
}catch{res.writeHead(404);res.end('Not found');}});
const option=(name,fallback)=>{const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:fallback;};
const port=Number(option('--port',process.env.PORT||3000)),host=option('--host','0.0.0.0');
server.listen(port,host,()=>console.log(`旅策 preview: http://${host}:${port}`));
