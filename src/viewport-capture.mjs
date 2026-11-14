import {localFiles,saveLocalCapture} from './local-files.mjs';
import * as THREE from '../vendor/three-0.160.1/build/three.module.js';
import {check} from './core.mjs';
import {applyPose,sampleClip} from './action-geometry.mjs';
import {inPlacePreview} from './action-motion-check.mjs';
import {containDialogFocus} from './dialog-focus.mjs';
import {GifWriter} from './viewport-gif.mjs';
import {studioEnvironment} from './viewer-studio.mjs';
const filename=value=>(value||'3D Lab').replace(/[<>:"/\\|?*\u0000-\u001f]/g,'-').slice(0,100);
const save=async(blob,name)=>{const path=await saveLocalCapture(blob,name);if(path)return path;const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);};
const next=()=>new Promise(resolve=>setTimeout(resolve,0));

/** A separate camera, skeleton and small renderer leave the editor untouched. */
function snapshot(viewer,action){
 const source=viewer.object;check(source,'Choose a model first.');const clone=source.clone(true),original=[],copies=[];source.traverse(n=>original.push(n));clone.traverse(n=>copies.push(n));const nodes=new Map(original.map((n,i)=>[n,copies[i]])),skeletons=new Map();
 for(const node of original)if(node.isSkinnedMesh){if(!skeletons.has(node.skeleton)){const s=node.skeleton.clone();s.bones=node.skeleton.bones.map(b=>{check(nodes.has(b),'Capture needs the complete skeleton in this scene.');return nodes.get(b);});skeletons.set(node.skeleton,s);}nodes.get(node).skeleton=skeletons.get(node.skeleton);}
 const scene=new THREE.Scene(),root=new THREE.Group();root.position.copy(viewer.root.position);root.quaternion.copy(viewer.root.quaternion);root.scale.copy(viewer.root.scale);root.add(clone);scene.add(root);
 for(const child of viewer.scene.children)if(child.isLight)scene.add(child.clone());
 const grid=viewer.grid.clone();scene.add(grid);
 const camera=viewer.camera.clone(),target=viewer.controls.target.clone();let rig=null;
 if(action?.active&&action.rig&&nodes.has(action.rig.root))rig={root:nodes.get(action.rig.root),bones:new Map([...action.rig.bones].map(([id,b])=>[id,nodes.get(b)])),rest:action.rig.rest,skeleton:skeletons.get(action.rig.skeleton)||{update(){}}};
 return {scene,camera,target,grid,rig,doc:action?.active?structuredClone(action.document):null,clip:action?.active?structuredClone(action.clip()):null,dispose:()=>{for(const skeleton of skeletons.values())skeleton.dispose();}};
}

export function initViewportCapture({viewer,getBuilder=()=>null,getShape=()=>null,getAction=()=>null,buttons}){
 let dialog=null,cancelled=false,running=false;
 const open=kind=>{
  if(dialog)return;const action=getAction(),owner=action?.active?action:getBuilder()?.active?getBuilder():getShape()?.active?getShape():null;
  const active=document.activeElement;dialog=document.createElement('dialog');dialog.className='viewport-capture-dialog';dialog.id='viewport-capture';dialog.setAttribute('aria-labelledby','capture-title');
  const gif=kind==='gif',keyed=action?.active&&!action.skeletonCandidate&&Object.values(action.clip().tracks).some(k=>k.length),title=document.getElementById('viewport-title')?.textContent||'3D Lab';
  dialog.innerHTML=`<div class="viewport-help-heading"><div><span class="eyebrow">SHARE YOUR MODEL</span><h2 id="capture-title">${gif?'Create an animated GIF':'Save a screenshot'}</h2></div><button id="capture-close" aria-label="Close capture">×</button></div><p class="helper">Capture the model using your current camera and display style. ${localFiles()?'Files save to your shared assets / 3d / captures folder.':'Files save to your downloads.'}</p>
<label class="field">File name<input id="capture-name" maxlength="100"></label>
<div class="capture-pair"><label class="field">Size · longest edge<select id="capture-size">${(gif?[384,512,768]:[768,1024,2048]).map(n=>`<option value="${n}" ${n===(gif?512:1024)?'selected':''}>${n} px</option>`).join('')}</select></label><label class="field">Background<select id="capture-bg"><option value="dark">Dark</option><option value="transparent" ${gif?'':'selected'}>Transparent</option><option value="white">White</option></select></label></div>
<label class="consent"><input id="capture-grid" type="checkbox">Include ground grid</label>
${gif?`<label class="field">Motion<select id="capture-motion">${keyed?'<option value="action">Selected action</option>':''}<option value="turntable">Turntable · one full rotation</option></select></label><label class="consent" id="capture-inplace-row"><input id="capture-inplace" type="checkbox" checked>Keep action in place</label><div class="capture-pair"><label class="field">Start · seconds<input id="capture-from" type="number" min="0" step=".1" value="0"></label><label class="field">Length · seconds<input id="capture-duration" type="number" min=".5" max="30" step=".1" value="${keyed?Math.min(6,action.clip().duration):3}"></label></div><div class="capture-pair"><label class="field">Frame rate<select id="capture-fps"><option>10</option><option selected>15</option><option>20</option></select></label><label class="consent"><input id="capture-loop" type="checkbox" checked>Repeat GIF</label></div><p class="helper">GIF uses 256 colours and hard transparency edges. Length: 0.5–30 seconds; choose a shorter range or smaller size for a lighter file.</p>`:''}
<canvas id="capture-preview" aria-label="Capture preview" hidden></canvas><progress id="capture-progress" max="1" value="0" hidden></progress><p id="capture-status" class="helper" role="status"></p><div class="capture-actions"><button id="capture-cancel" hidden>Cancel export</button><button id="capture-start" class="primary">${gif?'Create GIF ↓':'Save PNG ↓'}</button></div>`;
  (document.fullscreenElement||document.body).append(dialog);const release=containDialogFocus(dialog),$=id=>dialog.querySelector('#'+id);$('capture-name').value=title;
  const close=()=>{if(running){cancelled=true;$('capture-status').textContent='Cancelling…';return;}release();dialog.close();dialog.remove();dialog=null;active?.focus?.();};
  $('capture-close').onclick=close;dialog.oncancel=e=>{e.preventDefault();close();};$('capture-cancel').onclick=()=>{cancelled=true;};
  const motionChange=()=>{const isAction=$('capture-motion').value==='action';$('capture-from').disabled=!isAction;$('capture-inplace-row').hidden=!isAction;};if(gif){$('capture-motion').onchange=motionChange;motionChange();}
  $('capture-start').onclick=async()=>{
   let shot=null,renderer=null,studio=null;try{
    check(!viewer.contextIsLost,'Restore the 3D preview before capturing.');check(!owner?.busy&&!owner?.hasPending,'Finish the current operation or gesture before capturing.');
    shot=snapshot(viewer,action);const size=Number($('capture-size').value),aspect=viewer.camera.isPerspectiveCamera?viewer.camera.aspect:(viewer.camera.right-viewer.camera.left)/(viewer.camera.top-viewer.camera.bottom),width=Math.max(1,Math.round(aspect>=1?size:size*aspect)),height=Math.max(1,Math.round(aspect>=1?size/aspect:size));
    const fps=gif?Number($('capture-fps').value):1,seconds=gif?Number($('capture-duration').value):1,from=gif?Number($('capture-from').value):0,isAction=gif&&$('capture-motion').value==='action',frames=gif?Math.max(2,Math.round(seconds*fps)):1;
    check(!gif||(Number.isFinite(seconds)&&seconds>=.5&&seconds<=30),'Choose a GIF length from 0.5 to 30 seconds.');check(width*height*frames<=80_000_000,'This GIF is too large. Choose a shorter range, fewer frames or a smaller size.');
    check(!isAction||(shot.rig&&Number.isFinite(from)&&from>=0&&from+seconds<=shot.clip.duration+1e-7),'Choose a range inside the selected action.');
    running=true;cancelled=false;for(const node of dialog.querySelectorAll('input,select,button'))node.disabled=true;$('capture-cancel').hidden=false;$('capture-cancel').disabled=false;$('capture-progress').hidden=false;
    renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,preserveDrawingBuffer:true});renderer.setPixelRatio(1);renderer.setSize(width,height,false);renderer.outputColorSpace=viewer.renderer.outputColorSpace;renderer.toneMapping=viewer.renderer.toneMapping;renderer.toneMappingExposure=viewer.renderer.toneMappingExposure;renderer.clippingPlanes=viewer.renderer.clippingPlanes.map(p=>p.clone());renderer.localClippingEnabled=viewer.renderer.localClippingEnabled;
    studio=studioEnvironment(renderer);shot.scene.environment=studio.texture;
    const transparent=$('capture-bg').value==='transparent';renderer.setClearColor($('capture-bg').value==='white'?0xffffff:0x111720,transparent?0:1);shot.grid.visible=$('capture-grid').checked;
    const canvas=$('capture-preview');canvas.width=width;canvas.height=height;canvas.hidden=false;const ctx=canvas.getContext('2d',{willReadFrequently:gif}),offset=shot.camera.position.clone().sub(shot.target),encoder=gif?new GifWriter(width,height,{loop:$('capture-loop').checked,transparent}):null;
    for(let i=0;i<frames;i++){
     check(!cancelled,'Capture cancelled.');check(!renderer.getContext().isContextLost(),'Capture stopped after graphics context loss. Try a smaller size.');
     if(isAction){const time=from+seconds*(shot.clip.loop?i/frames:i/Math.max(1,frames-1));let poses=sampleClip(shot.clip,time);if($('capture-inplace').checked)poses=inPlacePreview(shot.doc,shot.clip,poses);applyPose(shot.rig,shot.doc,poses);}
     else if(gif){shot.camera.position.copy(offset).applyAxisAngle(new THREE.Vector3(0,1,0),i/frames*Math.PI*2).add(shot.target);shot.camera.lookAt(shot.target);}
     renderer.render(shot.scene,shot.camera);ctx.clearRect(0,0,width,height);ctx.drawImage(renderer.domElement,0,0);
     if(gif)encoder.add(ctx.getImageData(0,0,width,height).data,Math.round((i+1)*100/fps)-Math.round(i*100/fps));
     $('capture-progress').value=(i+1)/frames;$('capture-status').textContent=gif?`Creating frame ${i+1} of ${frames} · ${width} × ${height}`:`Saving ${width} × ${height} PNG…`;await next();
    }
    check(!cancelled,'Capture cancelled.');const blob=gif?encoder.finish():await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));check(blob,'Could not create the capture.');const savedPath=await save(blob,filename($('capture-name').value)+(gif?'.gif':'.png'));$('capture-status').textContent=`${gif?'GIF':'PNG'} saved${savedPath?' to '+savedPath:''} · ${width} × ${height}${gif?' · '+frames+' frames':''} · ${(blob.size/1024/1024).toFixed(2)} MiB.`;
   }catch(error){$('capture-status').textContent=error.message;}finally{studio?.dispose();renderer?.dispose();renderer?.forceContextLoss();shot?.dispose();running=false;for(const node of dialog.querySelectorAll('input,select,button'))node.disabled=false;$('capture-cancel').hidden=true;if(gif)motionChange();}
  };
  dialog.showModal();
 };
 buttons.png.onclick=()=>open('png');buttons.gif.onclick=()=>open('gif');
 return {destroy(){cancelled=true;if(!running&&dialog){dialog.close();dialog.remove();dialog=null;}buttons.png.onclick=buttons.gif.onclick=null;}};
}
