import assert from 'node:assert/strict';
import {createActionDocument,createJoint,normalizeActionDocument,parseActionDocument,stringifyActionDocument} from '../src/action-document.mjs';
import {validateMotion,retargetMotion} from '../src/action-motion.mjs';
import {sampleClip} from '../src/action-geometry.mjs';
import * as THREE from '../vendor/three-0.160.1/build/three.module.js';
let passed=0;
const test=(name,fn)=>{fn();console.log('PASS',name);passed++;};
function fixture(seconds=6.017,count=5){
 const doc=createActionDocument('Long action'),positions=[],joints=[];
 for(let i=0;i<count;i++){const position=[i*.01,i?1:0,0],j=createJoint(position,i?doc.joints[0].id:null,'Joint'+i);doc.joints.push(j);positions.push(position);joints.push({name:j.name,parent:i?0:-1,position});}
 const times=Array.from({length:Math.floor(seconds*30)+1},(_,i)=>i/30);if(Math.abs(times.at(-1)-seconds)>1e-7)times.push(seconds);
 const frames=times.map(time=>({time,positions:positions.map(p=>[p[0],p[1],p[2]+time*.2]),rotations:joints.map(()=>[0,0,0,1])}));
 return {doc,motion:{format:'capp.motion.v1',fps:30,durationSeconds:seconds,joints,frames}};
}
test('segmented motion preserves exact fractional duration and end pose through saving',()=>{
 const {doc,motion}=fixture();const {clip}=retargetMotion(doc,motion);assert.equal(clip.duration,6.017);const root=doc.joints[0].id;assert.equal(clip.tracks[root].at(-1).time,6.017);assert.ok(Math.abs(clip.tracks[root].at(-1).position[2]-6.017*.2)<1e-8);
 clip.provenance={model:'unimate',prompt:'Walk forward.\nKeep a relaxed pace.',seed:42};doc.clips=[clip];const reopened=parseActionDocument(stringifyActionDocument(doc));assert.equal(reopened.clips[0].duration,6.017);assert.equal(reopened.clips[0].tracks[root].at(-1).time,6.017);assert.equal(reopened.clips[0].provenance.prompt,clip.provenance.prompt);
});
test('partial, unordered and mismatched timing cannot silently change an action',()=>{
 for(const change of [m=>delete m.frames[1].time,m=>m.frames[1].time=0,m=>m.frames[1].time=NaN,m=>m.durationSeconds=8,m=>m.frames.at(-1).time=121]){const {motion}=fixture();change(motion);assert.throws(()=>validateMotion(motion));}
});
test('smooth source stays continuous through segment-sized boundaries, including quaternion sign changes',()=>{
 const {doc,motion}=fixture(),axis=new THREE.Vector3(0,1,0),rotation=t=>new THREE.Quaternion().setFromAxisAngle(axis,t*.3);
 for(const [i,frame]of motion.frames.entries())frame.rotations=motion.joints.map(()=>rotation(frame.time).toArray().map(v=>i%2?-v:v));
 const {clip}=retargetMotion(doc,motion),root=doc.joints[0].id;doc.clips=[clip];
 const reopened=parseActionDocument(stringifyActionDocument(doc)).clips[0];
 // Check both ends of the documented 12-frame overlaps. This is a frontend
 // interpolation test; it does not assume or simulate neural overlap blending.
 for(const frame of [48,60,96,108,144,156])for(const offset of [-.25,0,.25]){
  const time=(frame+offset)/30,pose=sampleClip(reopened,time)[root];
  assert.ok(Math.abs(pose.position[2]-time*.2)<1e-8,'Root travel must not reset at a join');
  assert.ok(new THREE.Quaternion(...pose.rotation).angleTo(rotation(time))<1e-6,'Quaternion sign changes must not cause a spin');
 }
});
test('source discontinuities are retained, so frame interpolation is not segment blending',()=>{
 const {doc,motion}=fixture();for(const frame of motion.frames)if(frame.time>=2)for(const position of frame.positions)position[2]+=.25;
 const {clip}=retargetMotion(doc,motion),keys=clip.tracks[doc.joints[0].id];
 assert.ok(keys[60].position[2]-keys[59].position[2]>.25);
 assert.equal(keys[60].time,2);assert.equal(clip.duration,6.017);
});
test('mixed rotation frames are rejected before retargeting',()=>{const {motion}=fixture();delete motion.frames[2].rotations;assert.throws(()=>validateMotion(motion),/rotation/);});
test('full minute and maximum engine rig stay within editable key budget',()=>{
 const {doc,motion}=fixture(60,70),start=performance.now(),{clip}=retargetMotion(doc,motion);assert.equal(clip.duration,60);assert.equal(Object.values(clip.tracks).reduce((n,k)=>n+k.length,0),126070);doc.clips=[clip];normalizeActionDocument(doc);console.log('Retargeted 126,070 keys in',Math.round(performance.now()-start),'ms');
});
test('prompt provenance permits line breaks but rejects control characters',()=>{const {doc}=fixture();doc.clips[0].provenance={model:'unimate',prompt:'Walk\u0000forward',seed:0};assert.throws(()=>normalizeActionDocument(doc),/prompt/);});
console.log(`${passed} long-motion timing checks passed.`);
