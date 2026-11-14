import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const esbuild = process.env.ESBUILD_PATH ? await import(pathToFileURL(process.env.ESBUILD_PATH).href) : await import('esbuild');
const vendor = { name:'local-vendor', setup(build) { build.onResolve({filter:/^three(?:\/|$)/}, args=>({path:args.path==='three'?path.join(root,'vendor/three-0.160.1/build/three.module.js'):path.join(root,'vendor/three-0.160.1/examples/jsm',args.path.replace(/^three\/addons\//,''))})); } };
const worker = await esbuild.build({entryPoints:[path.join(root,'src/skeleton-proxy-worker.mjs')],bundle:true,write:false,format:'iife',platform:'browser',target:['chrome109'],minify:true,legalComments:'inline',plugins:[vendor]});
const bundle = await esbuild.build({ entryPoints:[path.join(root,'src/app.mjs')], bundle:true, write:false, format:'iife', platform:'browser', target:['chrome109'], minify:true, legalComments:'inline',
 plugins:[vendor,{name:'inline-worker',setup(build){build.onResolve({filter:/\?worker-inline$/},()=>({path:'prediction-worker',namespace:'inline-worker'}));build.onLoad({filter:/.*/,namespace:'inline-worker'},()=>({contents:'export default '+JSON.stringify(worker.outputFiles[0].text),loader:'js'}));}}] });
const script = bundle.outputFiles[0].text.replace(/<\/script/gi,'<\\/script'), css = (await Promise.all(['style.css','project-workspace.css','shape.css','action.css','action-assets.css','action-sandbox.css','viewport-workspace.css','action-equipment.css','action-rig-library.css','action-flow.css','action-studio.css','workspace-layout.css'].map(file=>fs.readFile(path.join(root,'src',file),'utf8')))).join('\n');
let html = await fs.readFile(path.join(root,'src/index.template.html'),'utf8');
html = html.replace('/*__STYLE__*/',css).replace('/*__SCRIPT__*/',() => script);
await fs.writeFile(path.join(root,'index.html'),html,'utf8');
console.log(`Built index.html: ${Buffer.byteLength(html)} bytes; runtime uses no external scripts.`);
