import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {TexturePaint} from './texture-paint.mjs';
import {disposeComponent} from './builder-objects.mjs';
const el=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
const button=(text,fn)=>{const b=el('button',text);b.type='button';b.onclick=fn;return b;};

export async function touchUpTexture(bytes,{title='Model',onSave}={}){
  const dialog=el('dialog');dialog.className='texture-aligner texture-painter';dialog.setAttribute('aria-label','Touch up texture');
  const header=el('header'),heading=el('h2','Touch up texture · '+title),intro=el('p','Paint on the model. Alt-drag to orbit, right-drag to pan, scroll to zoom. Choose Focus and click a detail to zoom. Erase removes your paint and reveals the base texture.');header.append(heading,intro);
  const main=el('div');main.className='texture-aligner-body';const stage=el('div');stage.className='texture-paint-stage';const side=el('aside'),status=el('p');status.setAttribute('role','status');status.textContent='Loading model…';
  const mode=el('select');mode.setAttribute('aria-label','Texture brush tool');for(const [name,value]of [['Paint','paint'],['Erase paint','erase'],['Pick colour','sample'],['Focus detail','focus'],['Orbit','orbit']])mode.append(new Option(name,value));side.append(mode);
  const field=(name,type,value,min,max,step)=>{const label=el('label',name),input=el('input');input.type=type;input.setAttribute('aria-label',name);if(min!==undefined){input.min=min;input.max=max;input.step=step;}input.value=value;if(type==='range'){const output=el('span',input.value);output.className='texture-range-value';output.setAttribute('aria-hidden','true');input.addEventListener('input',()=>output.textContent=input.value);label.append(output);}label.append(input);side.append(label);return input;};
  const colour=field('Brush colour','color','#d8d4ca'),radius=field('Brush radius · % of model size','range','.3','.05','3','.05'),flow=field('Brush strength','range','.6','.05','1','.05'),softness=field('Soft edge','range','.5','0','1','.05'),opacity=field('Paint layer opacity','range','1','0','1','.01');
  const showLabel=el('label'),show=el('input');show.type='checkbox';show.checked=true;showLabel.append(show,' Show paint layer');side.append(showLabel);
  const help=el('p','Colour touch-ups use the existing UV layout. Shared or mirrored UVs share paint. Apply a unique, un-tiled texture first when separate surfaces need different colours.');help.className='texture-paint-help';
  const footer=el('footer'),close=button('Close',()=>finish(null)),download=button('Export GLB',()=>run(async()=>{const output=await paint.save(),url=URL.createObjectURL(new Blob([output],{type:'model/gltf-binary'})),a=el('a');a.href=url;a.download=title.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'-')+' texture.glb';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);status.textContent='GLB exported with an editable paint layer.';})),save=button('Save asset',()=>run(async()=>{const output=await paint.save();if(onSave)await onSave(output);finish(output,true);}));
  footer.append(close,download,save);main.append(stage,side);dialog.append(header,main,footer);document.body.append(dialog);dialog.showModal();
  let paint,gltf,renderer,controls,camera,scene,observer,depthTarget,depthMaterial,closed=false,busy=false,ready=false,current,modelHeight=1,brushPointer=null,depthPixels,depthMatrix,depthWidth=768,depthHeight=768,strokeChanged=false;
  const circle=el('span');circle.className='texture-brush-cursor';circle.hidden=true;stage.append(circle);
  let resolve;const completion=new Promise(r=>resolve=r);
  function sync(){save.disabled=download.disabled=!ready||busy||brushPointer!==null;close.disabled=busy;for(const input of side.querySelectorAll('input,select,button'))input.disabled=!ready||busy||brushPointer!==null;}
  function finish(value,saved=false){if(closed||(busy&&!saved))return;if(paint?.dirty&&!saved&&!confirm('Close without saving these texture changes? Export GLB or Save asset to keep them.'))return;closed=true;observer?.disconnect();controls?.dispose();paint?.dispose();disposeComponent(gltf?.scene);depthTarget?.dispose();depthMaterial?.dispose();renderer?.dispose();renderer?.forceContextLoss();dialog.close();dialog.remove();resolve(value);}
  async function run(fn){if(busy||!ready||brushPointer!==null)return;busy=true;sync();try{await fn();}catch(e){status.textContent=e.message;}finally{busy=false;sync();}}
  const draw=()=>{if(!closed&&renderer&&scene&&camera)renderer.render(scene,camera);};
  const undo=button('Undo stroke',()=>{paint.undo();draw();}),redo=button('Redo stroke',()=>{paint.undo(true);draw();});side.append(undo,redo);
  function fit(direction=[0,0,1]){if(!gltf)return;const b=new THREE.Box3().setFromObject(gltf.scene),c=b.getCenter(new THREE.Vector3());controls.target.copy(c);camera.position.copy(c).add(new THREE.Vector3(...direction).normalize().multiplyScalar(modelHeight*3));camera.zoom=1;camera.lookAt(c);camera.updateProjectionMatrix();controls.update();draw();}
  side.append(button('Fit model',()=>fit()),...Object.entries({Front:[0,0,1],Left:[-1,0,0],Right:[1,0,0],Back:[0,0,-1]}).map(([name,direction])=>button(name,()=>{const distance=camera.position.distanceTo(controls.target);camera.position.copy(controls.target).add(new THREE.Vector3(...direction).multiplyScalar(distance));camera.lookAt(controls.target);controls.update();draw();})),help,status);
  show.onchange=()=>{for(const s of paint.states.values())paint.update(s,show.checked);draw();};
  opacity.oninput=()=>{if(!current)return;current.opacity=Number(opacity.value);current.changed=paint.dirty=true;paint.update(current,show.checked);draw();};
  dialog.addEventListener('cancel',e=>{e.preventDefault();finish(null);});
  dialog.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'&&!e.target.matches('input,select')&&ready&&!busy&&brushPointer===null){e.preventDefault();paint.undo(e.shiftKey);draw();}});
  sync();
  try{
    renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(2,devicePixelRatio));renderer.setClearColor(0x15212f);stage.prepend(renderer.domElement);renderer.domElement.setAttribute('aria-label','Texture paint viewport');renderer.domElement.tabIndex=0;
    scene=new THREE.Scene();camera=new THREE.OrthographicCamera();scene.add(new THREE.HemisphereLight(0xffffff,0x536274,2));const light=new THREE.DirectionalLight(0xffffff,2);light.position.set(3,5,4);scene.add(light);
    const manager=new THREE.LoadingManager();let failed=false;manager.onError=()=>failed=true;gltf=await new GLTFLoader(manager).parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');if(closed){disposeComponent(gltf.scene);return completion;}if(failed)throw Error('An embedded texture could not be loaded.');
    scene.add(gltf.scene);gltf.scene.updateMatrixWorld(true);modelHeight=new THREE.Box3().setFromObject(gltf.scene).getSize(new THREE.Vector3()).length();
    controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=false;controls.addEventListener('change',draw);
    camera.near=.001;camera.far=modelHeight*20;const resize=()=>{const r=stage.getBoundingClientRect();renderer.setSize(Math.max(1,r.width),Math.max(1,r.height),false);camera.top=modelHeight*.55;camera.bottom=-camera.top;camera.left=camera.bottom*r.width/Math.max(1,r.height);camera.right=-camera.left;camera.updateProjectionMatrix();draw();};observer=new ResizeObserver(resize);observer.observe(stage);resize();fit();
    paint=new TexturePaint(bytes,gltf);await paint.prepare(text=>status.textContent=text);if(closed){paint.dispose();return completion;}current=await paint.state(paint.parts.flatMap(p=>p.materials).find(Boolean).image);opacity.value=current.opacity;paint.update(current);draw();
    depthTarget=new THREE.WebGLRenderTarget(depthWidth,depthHeight);depthMaterial=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking,side:THREE.DoubleSide});depthPixels=new Uint8Array(depthWidth*depthHeight*4);
    const pick=e=>{const r=renderer.domElement.getBoundingClientRect(),ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((e.clientX-r.left)/r.width*2-1,1-(e.clientY-r.top)/r.height*2),camera);return ray.intersectObject(gltf.scene,true)[0];};
    const snapshotDepth=()=>{scene.overrideMaterial=depthMaterial;renderer.setClearColor(0xffffff,1);renderer.setRenderTarget(depthTarget);renderer.render(scene,camera);renderer.readRenderTargetPixels(depthTarget,0,0,depthWidth,depthHeight,depthPixels);renderer.setRenderTarget(null);scene.overrideMaterial=null;renderer.setClearColor(0x15212f,1);depthMatrix=new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);};
    const visible=xyz=>{const p=new THREE.Vector3(...xyz).applyMatrix4(depthMatrix),x=Math.round((p.x*.5+.5)*(depthWidth-1)),y=Math.round((p.y*.5+.5)*(depthHeight-1));if(x<0||x>=depthWidth||y<0||y>=depthHeight)return false;const at=(y*depthWidth+x)*4;const z=(depthPixels[at]/16777216+depthPixels[at+1]/65536+depthPixels[at+2]/256+depthPixels[at+3])/256;return p.z*.5+.5<=z+.00015;};
    const stamp=e=>{const hit=pick(e);if(!hit)return;const target=paint.target(hit);if(target?.image!==current.image)return;const hex=colour.value,c=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));const direction=camera.position.clone().sub(controls.target).normalize();if(paint.paintAt(current,hit.point,modelHeight*Number(radius.value)/100,{colour:c,flow:Number(flow.value),softness:Number(softness.value),erase:mode.value==='erase',visible,cameraDirection:direction}))strokeChanged=true;paint.update(current,show.checked);draw();};
    renderer.domElement.addEventListener('pointerdown',async e=>{
      if(!ready||busy||e.button!==0||e.altKey||mode.value==='orbit')return;e.preventDefault();e.stopImmediatePropagation();renderer.domElement.focus();const hit=pick(e),target=hit&&paint.target(hit);if(!target){status.textContent='Choose a surface with a base-colour texture.';return;}
      brushPointer=e.pointerId;controls.enabled=false;renderer.domElement.setPointerCapture(e.pointerId);sync();
      try{current=await paint.state(target.image);if(brushPointer!==e.pointerId)return;opacity.value=current.opacity;
        if(mode.value==='focus'){const delta=hit.point.clone().sub(controls.target);controls.target.copy(hit.point);camera.position.add(delta);camera.zoom=Math.min(40,camera.zoom*2.5);camera.updateProjectionMatrix();controls.update();end();return;}
        if(mode.value==='sample'){colour.value=paint.sample(current,paint.uv(target,hit));status.textContent='Colour sampled. Choose Paint to apply it.';end();return;}
        if(!show.checked){show.checked=true;paint.update(current);}
        snapshotDepth();paint.begin(current);strokeChanged=false;stamp(e);
      }catch(error){status.textContent=error.message;end(true);}
    },true);
    let last=0;renderer.domElement.addEventListener('pointermove',e=>{const r=stage.getBoundingClientRect(),pixels=modelHeight*Number(radius.value)/100*r.height/(camera.top-camera.bottom)*camera.zoom;circle.hidden=mode.value==='orbit'||mode.value==='sample'||mode.value==='focus'||e.altKey;circle.style.cssText=`left:${e.clientX-r.left}px;top:${e.clientY-r.top}px;width:${pixels*2}px;height:${pixels*2}px`;if(brushPointer===e.pointerId&&paint.stroke&&performance.now()-last>35){last=performance.now();try{stamp(e);}catch(error){status.textContent=error.message;end(true);}}});
    function end(cancel=false){if(brushPointer===null)return;paint.end(cancel);brushPointer=null;controls.enabled=true;sync();draw();if(strokeChanged&&!cancel)status.textContent='Paint layer changed · save or export to keep it.';}
    renderer.domElement.addEventListener('pointerup',()=>end());renderer.domElement.addEventListener('pointercancel',()=>end(true));renderer.domElement.addEventListener('lostpointercapture',()=>end(true));renderer.domElement.addEventListener('pointerleave',()=>circle.hidden=true);
    renderer.domElement.addEventListener('wheel',e=>{if(e.ctrlKey||e.metaKey)e.stopImmediatePropagation();},{capture:true,passive:true});

    ready=true;status.textContent='Ready · paint on the model or pick a colour.';sync();draw();
  }catch(error){status.textContent=error.message;close.disabled=false;}
  return completion;
}
