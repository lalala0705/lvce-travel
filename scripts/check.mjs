import {readFile,stat} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
for(const path of ['dist/index.html','dist/styles.css','dist/app.js','dist/domain.js','dist/icon.svg','dist/manifest.webmanifest']){if(!(await stat(path)).size)throw new Error(`Empty asset: ${path}`);}
for(const path of ['dist/app.js','dist/domain.js','scripts/serve.mjs'])execFileSync(process.execPath,['--check',path],{stdio:'inherit'});
JSON.parse(await readFile('dist/manifest.webmanifest','utf8'));
console.log('Buildless static application verified. Deploy directory: dist/');
