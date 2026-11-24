import {readFile,mkdir,writeFile,copyFile} from 'node:fs/promises';
const schema=await readFile(new URL('../dist/ai-schema.js',import.meta.url),'utf8');
const worker=await readFile(new URL('./worker/index.js',import.meta.url),'utf8');
const output=`// Generated from shared schema and worker source. No credentials in this bundle.\n${schema.replaceAll('export function ','function ')}\n${worker.replace(/^import .*ai-schema.js';\n/m,'')}`;
await mkdir(new URL('./dist/server/',import.meta.url),{recursive:true});
await mkdir(new URL('./dist/.openai/',import.meta.url),{recursive:true});
await writeFile(new URL('./dist/server/index.js',import.meta.url),output);
await copyFile(new URL('./.openai/hosting.json',import.meta.url),new URL('./dist/.openai/hosting.json',import.meta.url));
console.log('AI Worker built at backend/dist/server/index.js');
