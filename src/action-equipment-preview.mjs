import * as THREE from '../vendor/three-0.160.1/build/three.module.js';
import {equipmentStateAt} from './action-equipment.mjs';
/** Small authoring proxies. Never inserted into the saved character mesh. */
export function createEquipmentProxy(item){
 const root=new THREE.Group(),[w,h,d]=item.dimensions,material=new THREE.MeshStandardMaterial({color:item.kind==='item'?0x68bdb3:0x7d91a3,metalness:item.kind==='weapon'?.35:0,roughness:.6}),accent=new THREE.MeshStandardMaterial({color:0xeac58c,roughness:.65});
 const box=(size,position,mat=material)=>{const mesh=new THREE.Mesh(new THREE.BoxGeometry(...size),mat.clone());mesh.position.set(...position);root.add(mesh);return mesh;};
 const shaft=(radius,length,y,mat=material)=>{const mesh=new THREE.Mesh(new THREE.CylinderGeometry(radius,radius,length,8),mat.clone());mesh.position.y=y;root.add(mesh);return mesh;};
 if(item.category==='carry'){const sign=item.hand==='left'?-1:1;box([w,h,d],[sign*w*.5,0,0]);}
 else if(item.category==='pistol'||item.category==='rifle'){box([w,Math.max(h*.3,.015),d],[0,h*.35,d*.18]);box([w*.8,h*.65,Math.min(d*.25,.12)],[0,0,0],accent);if(item.category==='rifle')box([w,h*.5,d*.3],[0,h*.24,-d*.42],accent);}
 else if(item.category==='shield'){const mesh=new THREE.Mesh(new THREE.CylinderGeometry(w*.5,w*.5,d,16),material.clone());mesh.rotation.x=Math.PI/2;mesh.scale.z=h/w;root.add(mesh);box([w*.12,h*.32,d*.8],[0,0,-d*.8],accent);}
 else if(item.category==='bow'){const points=[];for(let i=0;i<=24;i++){const t=i/24;points.push(new THREE.Vector3(0,(t-.5)*h,Math.sin(t*Math.PI)*d));}root.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),24,Math.max(.008,w*.18),5,false),material.clone()));root.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([points[0],points.at(-1)]),new THREE.LineBasicMaterial({color:0xf1dbb7})));}
 else {shaft(Math.max(.008,Math.min(w,d)*.28),h*.28,0,accent);if(item.category==='axe'){shaft(Math.max(.009,d*.26),h*.8,h*.3);box([w,h*.22,d],[w*.28,h*.65,0]);}else if(item.category==='spear'){shaft(Math.max(.008,w*.3),h*.9,h*.25);const tip=new THREE.Mesh(new THREE.ConeGeometry(w,h*.12,6),material.clone());tip.position.y=h*.76;root.add(tip);}else{box([w,h*.72,d],[0,h*.5,0]);box([w*2.5,h*.04,d*1.6],[0,h*.12,0],accent);}}
 material.dispose();accent.dispose();root.name='Equipment preview · '+item.name;root.userData.equipmentPreview=true;return root;
}
export function addEquipmentHelpers(lab,group,worldToModel){
 if(!lab.document?.equipment)return;const equipment=lab.document.equipment;
 for(const item of equipment.items){const state=equipmentStateAt(equipment,item,lab.clip().id,lab.mode==='pose'?lab.time:0),socket=state==='held'?item.sockets.grip:state==='holstered'?item.sockets.holster:null,bone=socket&&lab.rig.bones.get(socket.joint);if(!bone)continue;
  const proxy=createEquipmentProxy(item),matrix=new THREE.Matrix4().copy(worldToModel).multiply(bone.matrixWorld).multiply(new THREE.Matrix4().compose(new THREE.Vector3(...socket.position),new THREE.Quaternion(...socket.rotation),new THREE.Vector3(1,1,1)));matrix.decompose(proxy.position,proxy.quaternion,proxy.scale);group.add(proxy);
  // An explicit second-hand marker makes imperfect predicted contacts reviewable.
  if(state==='held'&&item.sockets.support&&!document.querySelector('[data-action-panel=equipment]')?.hidden){const support=lab.rig.bones.get(item.sockets.support.joint);if(support){const position=new THREE.Vector3(...item.sockets.support.position).applyMatrix4(support.matrixWorld).applyMatrix4(worldToModel),dot=new THREE.Mesh(new THREE.SphereGeometry(Math.min(...item.dimensions)*.12+.004,8,6),new THREE.MeshBasicMaterial({color:0xf0c177,depthTest:false}));dot.position.copy(position);dot.renderOrder=115;group.add(dot);}}
 }
}
