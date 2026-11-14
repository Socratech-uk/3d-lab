import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const playwrightPath=process.env.PLAYWRIGHT_PATH || path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || '', 'playwright/index.mjs');
const {chromium}=await import(pathToFileURL(playwrightPath).href);
const chromiumPath=process.env.CHROMIUM_PATH || '/tmp/chromium';
const source=`
import { ShapeCanvas } from './src/shape-canvas.mjs';
import { createDefaultShapeRecipe,moveShapePoint,setShapePairLinked,getShapePoint } from './src/authoring/src/model-format/sol-shape-profile.js';
import { normalizeShapeSketch } from './src/shape-document.mjs';
let part={id:'test',type:'profile',profile:createDefaultShapeRecipe('hull')}, selected=null, snapshot=null, draws=[],closed=0,deletes=0,inserts=0,gestures=[];
window.errors=[];
const canvas=new ShapeCanvas(document.querySelector('canvas'),{
 onError:error=>window.errors.push(error.message),onSelect:value=>{selected=value;render();},
 onGesture:event=>{
   gestures.push(event);if(event.phase==='begin')snapshot=structuredClone(part);
   if(event.phase==='update'){
     if(event.selection.edge){
       part=structuredClone(snapshot);const indices=[event.selection.index,event.selection.nextIndex];
       if(part.type==='profile'){
         const channel=event.selection.channel,sign=channel==='lower'||channel==='near'?-1:1,half=(canvas.state.view==='top'?part.profile.depth:part.profile.height)/2;
         const targets=indices.map(index=>({index,point:getShapePoint(snapshot.profile,index,channel)}));
         targets.sort((a,b)=>event.delta.x>0?b.index-a.index:a.index-b.index);
         for(const {index,point} of targets)part.profile=moveShapePoint(part.profile,index,channel,{t:point.t+event.delta.x/part.profile.length,reach:point.reach+event.delta.y*sign/half});
       }else{
         part.sketch.points=part.sketch.points.map((point,index)=>indices.includes(index)?{x:point.x+event.delta.x,y:point.y+event.delta.y}:point);
         part.sketch=normalizeShapeSketch(part.sketch,part.type);
       }
     }else{const profile=part.profile;part={...part,profile:moveShapePoint(profile,event.selection.index,event.selection.channel,{t:event.point.x/profile.length+.5,reach:Math.abs(event.point.y)*2/(canvas.state.view==='top'?profile.depth:profile.height)})};}
     render();
   }
   if(event.phase==='end'&&event.cancelled){part=snapshot;render();}
 },
 onDrawPoint:point=>{draws.push(point);render();},onClose:()=>closed++,onDelete:()=>deletes++,onInsert:()=>inserts++
});
function render(){canvas.setState({part,selected,drawPoints:draws});}
render();
window.editor={canvas,render,diagnostics:()=>({state:canvas.getState(),part,gestures,draws,closed,deletes,inserts}),independent:()=>{part.profile=setShapePairLinked(part.profile,2,'outline',false);render();},sketch:()=>{part={id:'sketch',type:'extrude',sketch:{points:[{x:-1,y:-1},{x:1,y:-1},{x:1,y:1},{x:-1,y:1}],closed:true}};selected=null;draws=[];render();canvas.setState({tool:'draw'});},top:()=>canvas.setState({view:'top'}),side:()=>canvas.setState({view:'side'}),tool:value=>canvas.setState({tool:value})};`;
const bundle=await build({stdin:{contents:source,resolveDir:root,sourcefile:'shape-canvas-harness.mjs'},bundle:true,write:false,format:'iife'});
const html=`<!doctype html><style>html,body{margin:0;background:#0b1018}canvas{display:block;width:800px;height:500px}input{margin:10px}</style><canvas></canvas><input aria-label="Text field"><script>${bundle.outputFiles[0].text}</script>`;
const browser=await chromium.launch({executablePath:chromiumPath,headless:true,args:['--no-sandbox','--disable-dev-shm-usage'],env:{...process.env,LD_LIBRARY_PATH:path.dirname(chromiumPath)}});
const page=await browser.newPage({viewport:{width:900,height:650}}),errors=[];
page.on('pageerror',error=>errors.push(error.message));
await page.route('**/*',route=>route.fulfill({status:200,contentType:'text/html',body:html}));
const state=()=>page.evaluate(()=>window.editor.diagnostics());
const test=async(name,fn)=>{await fn();console.log('PASS',name);};
try{
 await page.goto('https://shape-canvas.test/');await page.waitForFunction(()=>window.editor);
 await test('profile handles and curve editor initialise with top/side channel identity',async()=>{let s=await state();assert.equal(s.state.handles.length,14);assert.equal(s.state.handles[0].channel,'upper');await page.evaluate(()=>window.editor.top());s=await state();assert.equal(s.state.handles[0].channel,'far');await page.evaluate(()=>window.editor.side());});
 await test('hover visibly tracks a profile point and direct dragging respects linked pair delta',async()=>{const before=await state(),handle=before.state.handles.find(p=>p.index===2&&p.channel==='upper');await page.mouse.move(handle.screen.x,handle.screen.y);assert.equal((await state()).state.hover.kind,'point');await page.keyboard.down('Alt');await page.mouse.down();await page.mouse.move(handle.screen.x+10,handle.screen.y-18,{steps:5});await page.mouse.up();await page.keyboard.up('Alt');const after=await state(),upper=after.part.profile.stations[2].upper-before.part.profile.stations[2].upper,lower=after.part.profile.stations[2].lower-before.part.profile.stations[2].lower;assert.ok(upper>.05);assert.ok(Math.abs(upper-lower)<1e-10);assert.equal(after.state.dragging,null);assert.equal(after.gestures.at(-1).phase,'end');});
 await test('Escape during a captured point drag restores the original recipe',async()=>{const before=await state(),handle=before.state.handles.find(p=>p.index===2&&p.channel==='upper');await page.mouse.move(handle.screen.x,handle.screen.y);await page.mouse.down();await page.mouse.move(handle.screen.x+20,handle.screen.y-20,{steps:3});await page.keyboard.press('Escape');await page.mouse.up();const after=await state();assert.deepEqual(after.part,before.part);assert.equal(after.gestures.at(-1).cancelled,true);});
 await test('unlinked peer stays fixed when its paired upper point moves',async()=>{await page.evaluate(()=>window.editor.independent());const before=await state(),handle=before.state.handles.find(p=>p.index===2&&p.channel==='upper');await page.mouse.move(handle.screen.x,handle.screen.y);await page.keyboard.down('Alt');await page.mouse.down();await page.mouse.move(handle.screen.x,handle.screen.y-16,{steps:3});await page.mouse.up();await page.keyboard.up('Alt');const after=await state();assert.ok(after.part.profile.stations[2].upper>before.part.profile.stations[2].upper);assert.equal(after.part.profile.stations[2].lower,before.part.profile.stations[2].lower);});
 await test('profile edge pull identifies the station span, moves both ends and permits double-click insertion',async()=>{
  const before=await state(),edge=before.state.edges.find(edge=>edge.index===2&&edge.channel==='upper');
  await page.mouse.move(edge.screen.x,edge.screen.y);await page.keyboard.down('Alt');await page.mouse.down();await page.mouse.move(edge.screen.x+8,edge.screen.y-14,{steps:4});await page.mouse.up();await page.keyboard.up('Alt');
  let after=await state();assert.equal(after.state.selected.edge,true);assert.equal(after.state.selected.nextIndex,3);assert.equal(after.gestures.at(-1).selection.index,2);assert.ok(after.gestures.at(-1).delta.y>0);
  for(const index of [2,3]){assert.ok(after.part.profile.stations[index].upper>before.part.profile.stations[index].upper);assert.ok(after.part.profile.stations[index].points.upper.t>before.part.profile.stations[index].points?.upper?.t||after.part.profile.stations[index].points.upper.t>before.part.profile.stations[index].t);}
  for(let i=1;i<after.part.profile.stations.length;i++){const a=after.part.profile.stations[i-1].points?.upper?.t??after.part.profile.stations[i-1].t,b=after.part.profile.stations[i].points?.upper?.t??after.part.profile.stations[i].t;assert.ok(b>a);}
  const upper=after.part.profile.stations[2].upper;await page.keyboard.press('ArrowUp');after=await state();assert.ok(after.part.profile.stations[2].upper>upper);assert.ok(Math.abs(after.gestures.at(-1).delta.y-.1)<1e-10);
  const moved=after.state.edges.find(edge=>edge.index===2&&edge.channel==='upper');await page.mouse.dblclick(moved.screen.x,moved.screen.y);assert.equal((await state()).inserts,1);
  const cancelBefore=await state(),cancelEdge=cancelBefore.state.edges.find(edge=>edge.index===2&&edge.channel==='upper');await page.mouse.move(cancelEdge.screen.x,cancelEdge.screen.y);await page.mouse.down();await page.mouse.move(cancelEdge.screen.x+9,cancelEdge.screen.y-13,{steps:3});await page.keyboard.press('Escape');await page.mouse.up();assert.deepEqual((await state()).part,cancelBefore.part);
  const handle=(await state()).state.handles.find(point=>point.index===2&&point.channel==='upper');await page.mouse.click(handle.screen.x,handle.screen.y);
 });
 await test('pan and scroll change only viewport and never commit point gestures',async()=>{const before=await state();await page.mouse.move(400,350);await page.mouse.down({button:'right'});await page.mouse.move(450,380,{steps:4});await page.mouse.up({button:'right'});await page.mouse.wheel(0,-80);const after=await state();assert.equal(after.gestures.length,before.gestures.length);assert.deepEqual(after.part,before.part);assert.notDeepEqual(after.state.camera,before.state.camera);});
 await test('focused arrow nudge and Delete work while a text field keeps its own keys',async()=>{await page.locator('canvas').focus();const before=await state();await page.keyboard.press('ArrowUp');assert.ok((await state()).part.profile.stations[2].upper>before.part.profile.stations[2].upper);await page.keyboard.press('Delete');assert.equal((await state()).deletes,1);await page.locator('input').focus();await page.keyboard.press('ArrowUp');await page.keyboard.press('Delete');assert.equal((await state()).deletes,1);});
 await test('sketch edge pull moves two adjacent points and cancelling a later pull restores the polygon',async()=>{
  await page.evaluate(()=>{window.editor.sketch();window.editor.tool('select');});let before=await state(),edge=before.state.edges.find(edge=>edge.index===0);
  await page.mouse.move(edge.screen.x,edge.screen.y);await page.keyboard.down('Alt');await page.mouse.down();await page.mouse.move(edge.screen.x,edge.screen.y+20,{steps:4});await page.mouse.up();await page.keyboard.up('Alt');
  let after=await state();assert.equal(after.state.selected.edge,true);assert.equal(after.state.selected.nextIndex,1);assert.ok(after.part.sketch.points[0].y<before.part.sketch.points[0].y);assert.equal(after.part.sketch.points[0].y,after.part.sketch.points[1].y);assert.deepEqual(after.part.sketch.points.slice(2),before.part.sketch.points.slice(2));
  before=after;edge=after.state.edges.find(edge=>edge.index===1);await page.mouse.move(edge.screen.x,edge.screen.y);await page.mouse.down();await page.mouse.move(edge.screen.x-18,edge.screen.y,{steps:3});await page.keyboard.press('Escape');await page.mouse.up();after=await state();assert.deepEqual(after.part,before.part);assert.equal(after.gestures.at(-1).cancelled,true);assert.deepEqual(after.gestures.at(-1).delta,{x:0,y:0});
 });
 await test('draw points snap to the visible grid and first-point click closes',async()=>{await page.evaluate(()=>window.editor.sketch());await page.mouse.click(280,220);await page.mouse.click(510,220);await page.mouse.click(500,350);let s=await state();assert.equal(s.draws.length,3);for(const p of s.draws){assert.ok(Math.abs(p.x*10-Math.round(p.x*10))<1e-8);assert.ok(Math.abs(p.y*10-Math.round(p.y*10))<1e-8);}const first=s.state.drawing[0].screen;await page.mouse.move(first.x,first.y);assert.equal((await state()).state.hover.kind,'close');await page.mouse.click(first.x,first.y);assert.equal((await state()).closed,1);});
 assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>window.errors),[]);
 console.log('9 ShapeCanvas browser checks passed.');
}finally{await browser.close();}
