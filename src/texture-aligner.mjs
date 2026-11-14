import * as THREE from 'three';
import {textureImage} from './builder-materials.mjs';
import {defaultAlignment,alignment,projectionFrame} from './texture-alignment.mjs';
const el=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
/** A disposable orthographic authoring preview. It never edits or exports a mesh. */
export function alignTexture(object,references,{direction='front',settings={},crop=true}={}){
 return new Promise((resolve,reject)=>{
  const dialog=el('dialog');dialog.className='texture-aligner';dialog.setAttribute('aria-label','Align source textures');
  const header=el('header'),heading=el('h2','Align source textures'),intro=el('p','Drag the image to match the model. Scroll scales the image; arrow keys nudge it. Shift makes larger adjustments. Alt-drag or right-drag pans the preview. Width and height can be adjusted separately.');header.append(heading,intro);
  const main=el('div');main.className='texture-aligner-body';const canvas=el('canvas');canvas.tabIndex=0;canvas.setAttribute('aria-label','Drag image alignment preview');const side=el('aside'),status=el('p');status.setAttribute('role','status');
  const select=el('select');select.setAttribute('aria-label','Alignment view');for(const key of Object.keys(references))select.append(new Option(key[0].toUpperCase()+key.slice(1),key));select.value=Object.hasOwn(references,direction)?direction:select.options[0].value;side.append(select);
  const values=structuredClone(settings),inputs={},fields=[['scale','Image scale'],['widthScale','Image width'],['heightScale','Image height'],['offsetX','Horizontal offset'],['offsetY','Vertical offset']];
  const current=()=>values[select.value]||=defaultAlignment();
  for(const [key,name]of fields){const label=el('label',name),input=el('input');input.type='number';input.step='.001';input.min=key.startsWith('offset')?'-10':'.01';input.max=key.startsWith('offset')?'10':'100';input.setAttribute('aria-label',name);inputs[key]=input;input.oninput=()=>{const n=Number(input.value);if(!Number.isFinite(n)||n<Number(input.min)||n>Number(input.max))return;current()[key]=n;draw();};label.append(input);side.append(label);}
  const flipLabel=el('label'),flip=el('input');flip.type='checkbox';flipLabel.append(flip,' Flip horizontally');flip.onchange=()=>{current().flipX=flip.checked;draw();};side.append(flipLabel);
  const opacityLabel=el('label','Image visibility'),opacity=el('input');opacity.type='range';opacity.min='0';opacity.max='1';opacity.step='.01';opacity.value='.65';opacity.oninput=()=>draw();opacityLabel.append(opacity);side.append(opacityLabel);
  const actions=el('footer');let finished=false,renderer,scene,camera,image,frame,units=1,zoom=1,pan={x:0,y:0},panMode=false,drag,serial=0,observer;
  const button=(name,fn)=>{const b=el('button',name);b.type='button';b.onclick=fn;return b;};
  const finish=(value,error)=>{if(finished)return;finished=true;++serial;observer?.disconnect();for(const n of scene?.children||[])n.material?.dispose();renderer?.dispose();renderer?.forceContextLoss();dialog.close();dialog.remove();if(error)reject(error);else resolve(value);};
  const sync=()=>{const a=current();for(const [key]of fields)inputs[key].value=Number(a[key]).toFixed(3);flip.checked=!!a.flipX;};
  side.append(button('Reset this view',()=>{values[select.value]=defaultAlignment();sync();draw();}),button('Pan preview',e=>{panMode=!panMode;status.textContent=panMode?'Drag to pan the preview.':'Drag to move the image.';}),button('Fit preview',()=>{zoom=1;pan={x:0,y:0};draw();}),button('Zoom preview in',()=>{zoom=Math.min(16,zoom*1.4);draw();}),button('Zoom preview out',()=>{zoom=Math.max(.25,zoom/1.4);draw();}),status);
  actions.append(button('Cancel',()=>finish(null)),button('Use alignment',()=>{try{const proposed={...current()};for(const [key]of fields)proposed[key]=Number(inputs[key].value);values[select.value]=alignment(proposed);for(const key of Object.keys(values))values[key]=alignment(values[key]);finish({settings:values,direction:select.value});}catch(error){status.textContent=error.message;}}));main.append(canvas,side);dialog.append(header,main,actions);document.body.append(dialog);dialog.showModal();
  dialog.addEventListener('cancel',e=>{e.preventDefault();finish(null);});
  try{
   renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,preserveDrawingBuffer:true});renderer.setPixelRatio(1);scene=new THREE.Scene();camera=new THREE.OrthographicCamera();
   object.updateMatrixWorld(true);const box=new THREE.Box3();object.traverseVisible(n=>{if(n.isMesh&&!n.userData.cappReferenceProjection){const b=new THREE.Box3().setFromBufferAttribute(n.geometry.attributes.position).applyMatrix4(n.matrixWorld);box.union(b);}});const minimum=box.min.toArray(),maximum=box.max.toArray();
   function drawNow(){
    if(finished||!image)return;const bounds=canvas.getBoundingClientRect(),w=Math.max(1,Math.round(bounds.width)),h=Math.max(1,Math.round(bounds.height));if(!w||!h)return;
    canvas.width=w;canvas.height=h;renderer.setSize(w,h,false);const cropBox=crop?image.crop:[0,0,image.canvas.width,image.canvas.height];frame=projectionFrame(minimum,maximum,select.value,cropBox[2],cropBox[3],current());
    units=Math.max(frame.width/w,frame.height/h)*1.15/zoom;camera.left=frame.centreX+pan.x-w*units/2;camera.right=frame.centreX+pan.x+w*units/2;camera.bottom=frame.centreY+pan.y-h*units/2;camera.top=frame.centreY+pan.y+h*units/2;const span=box.getSize(new THREE.Vector3()).length();camera.near=.001;camera.far=span*8+10;camera.position.set(0,0,span*3+2);camera.updateProjectionMatrix();camera.updateMatrixWorld();
    renderer.render(scene,camera);const ctx=canvas.getContext('2d');ctx.fillStyle='#0c141e';ctx.fillRect(0,0,w,h);ctx.drawImage(renderer.domElement,0,0);ctx.globalAlpha=Number(opacity.value);
    const iw=frame.imageWidth/units,ih=frame.imageHeight/units,cx=w/2+frame.offsetX*iw-pan.x/units,cy=h/2-frame.offsetY*ih+pan.y/units;ctx.save();ctx.translate(cx,cy);if(frame.flipX)ctx.scale(-1,1);ctx.drawImage(image.canvas,...cropBox,-iw/2,-ih/2,iw,ih);ctx.restore();ctx.globalAlpha=1;ctx.strokeStyle='#95dcda';ctx.strokeRect(cx-iw/2,cy-ih/2,iw,ih);status.textContent=select.value+' · '+Math.round(zoom*100)+'% preview zoom · '+(panMode?'drag pans preview':'drag moves image');
   }
   draw=drawNow;
   const load=async()=>{const token=++serial;status.textContent='Loading reference…';const next=await textureImage(references[select.value].blob);if(finished||token!==serial)return;image=next;for(const n of [...scene.children]){scene.remove(n);n.material.dispose();}const axes=projectionFrame(minimum,maximum,select.value,1,1).axes,rows=Array.from({length:3},()=>[0,0,0]);for(let i=0;i<3;i++)rows[i][axes[i*2]]=axes[i*2+1];const projection=new THREE.Matrix4().set(...rows[0],0,...rows[1],0,...rows[2],0,0,0,0,1);object.traverseVisible(n=>{if(!n.isMesh||n.userData.cappReferenceProjection)return;const mesh=new THREE.Mesh(n.geometry,new THREE.MeshNormalMaterial({side:THREE.DoubleSide}));mesh.matrixAutoUpdate=false;mesh.matrix.multiplyMatrices(projection,n.matrixWorld);scene.add(mesh);});draw();};
   select.onchange=()=>{zoom=1;pan={x:0,y:0};image=null;sync();void load().catch(e=>status.textContent=e.message);};
   canvas.onpointerdown=e=>{if(e.button!==0&&e.button!==2)return;canvas.focus();canvas.setPointerCapture(e.pointerId);drag={x:e.clientX,y:e.clientY,pan:panMode||e.altKey||e.button===2};};canvas.oncontextmenu=e=>e.preventDefault();canvas.onpointerup=()=>drag=null;canvas.onpointercancel=()=>drag=null;
   canvas.onpointermove=e=>{if(!drag||!frame)return;if(drag.pan){pan.x-=(e.clientX-drag.x)*units;pan.y+=(e.clientY-drag.y)*units;drag={x:e.clientX,y:e.clientY,pan:true};draw();return;}const a=current();a.offsetX=Math.max(-10,Math.min(10,a.offsetX+(e.clientX-drag.x)*units/frame.imageWidth));a.offsetY=Math.max(-10,Math.min(10,a.offsetY-(e.clientY-drag.y)*units/frame.imageHeight));drag={x:e.clientX,y:e.clientY};sync();draw();};
   canvas.addEventListener('wheel',e=>{if(e.ctrlKey||e.metaKey)return;e.preventDefault();current().scale=Math.max(.01,Math.min(100,current().scale*Math.exp(-e.deltaY*(e.shiftKey?.002:.0005))));sync();draw();},{passive:false});
   canvas.onkeydown=e=>{const delta=e.shiftKey?.01:.001,a=current();if(e.key==='ArrowLeft')a.offsetX-=delta;else if(e.key==='ArrowRight')a.offsetX+=delta;else if(e.key==='ArrowUp')a.offsetY+=delta;else if(e.key==='ArrowDown')a.offsetY-=delta;else return;e.preventDefault();a.offsetX=Math.max(-10,Math.min(10,a.offsetX));a.offsetY=Math.max(-10,Math.min(10,a.offsetY));sync();draw();};
   observer=new ResizeObserver(()=>draw());observer.observe(canvas);sync();void load().catch(error=>status.textContent=error.message);
  }catch(error){finish(null,error);}
  function draw(){}
 });
}
