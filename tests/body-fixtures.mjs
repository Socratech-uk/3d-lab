import * as THREE from '../vendor/three-0.160.1/build/three.module.js';
import {createActionDocument,createJoint} from '../src/action-document.mjs';
import {addTemplate,autoBind} from '../src/action-geometry.mjs';
export function bodyFixture(kind='humanoid',{generic=false,helpers=0}={}){
 const base=new THREE.Group(),mesh=new THREE.Mesh(new THREE.BoxGeometry(1,2,kind==='humanoid'?.4:2,4,4,4),new THREE.MeshStandardMaterial());mesh.geometry.translate(0,1,0);mesh.userData.actionMeshId='body';base.add(mesh);
 const doc=createActionDocument('Body mapping fixture');addTemplate(doc,base,kind);const ids=Object.fromEntries(doc.joints.map(j=>[j.name,j.id]));
 for(let i=0;i<helpers;i++){const targets=doc.joints.filter(j=>j.parent&&!j.name.startsWith('Helper')),child=targets[i%targets.length],parent=doc.joints.find(j=>j.id===child.parent),joint=createJoint(child.position.map((v,k)=>(v+parent.position[k])/2),parent.id,'Helper'+i);child.parent=joint.id;doc.joints.push(joint);}
 autoBind(base,doc);if(generic)doc.joints.forEach((j,i)=>j.name='Joint'+i);return {base,doc,ids};
}
export function skeletonReply(doc){const ordered=[],todo=[...doc.joints];while(todo.length){const i=todo.findIndex(j=>!j.parent||ordered.some(p=>p.id===j.parent));if(i<0)throw Error('Fixture cycle');ordered.push(...todo.splice(i,1));}return {format:'capp.skeleton.v1',joints:ordered.map(j=>({name:j.name,parent:ordered.findIndex(p=>p.id===j.parent),position:j.position}))};}
export function flatMotion(joints){return {format:'capp.motion.v1',fps:30,durationSeconds:1,joints:joints.map(j=>({name:j.name,parent:joints.findIndex(p=>p.id===j.parent),position:j.position})),frames:Array.from({length:31},(_,i)=>({time:i/30,positions:joints.map(j=>[j.position[0],j.position[1],j.position[2]+i/30]),rotations:joints.map(()=>[0,0,0,1])})),rotationSpace:'world-rest-delta'};}
