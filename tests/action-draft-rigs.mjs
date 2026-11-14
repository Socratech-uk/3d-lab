import assert from 'node:assert/strict';
import fs from 'node:fs';
import {BODY_ROLES,FACINGS,bodyMapReport,bodySignature,suggestBodySetup,turnPosition,motionRigStatus} from '../src/action-anatomy.mjs';
import {createActionDocument,createJoint,normalizeActionDocument,stringifyActionDocument,parseActionDocument} from '../src/action-document.mjs';
import {retargetMotion} from '../src/action-motion.mjs';
import {flatMotion,bodyFixture} from './body-fixtures.mjs';
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/draft-rigs-20261018.json',import.meta.url))),hound=fixture.rigs.find(r=>r.expectedKind==='quadruped');
let passed=0;const test=(name,fn)=>{fn();passed++;console.log('PASS '+name);};
for(const rig of fixture.rigs)test('supplied draft: '+rig.title,()=>{
 const before=JSON.stringify(rig),result=suggestBodySetup(rig.joints),report=bodyMapReport(rig.joints,result.map,{requireReview:false});
 assert.equal(result.map.kind,rig.expectedKind);assert.equal(report.ok,true);assert.equal(result.map.signature,undefined);assert.match(bodyMapReport(rig.joints,result.map).issues.join(' '),/Review/);
 if(rig.bodyMap){const expected=structuredClone(rig.bodyMap.roles);for(const [role,name]of Object.entries(rig.improvedRolesByName||{}))expected[role]=rig.joints.find(j=>j.name===name).id;assert.deepEqual(result.map.roles,expected);assert.deepEqual(bodyMapReport(rig.joints,rig.bodyMap).issues,[]);}
 assert.equal(JSON.stringify(rig),before);
});
test('real HOUND labels the low head, foreleg pivots and paw joints while keeping all detail',()=>{
 const {map,detected}=suggestBodySetup(hound.joints),names=Object.fromEntries(hound.joints.map(j=>[j.id,j.name])),roles=Object.fromEntries(Object.entries(map.roles).map(([role,id])=>[role,names[id]]));
 assert.equal(detected,true);assert.equal(map.facing,'+Z');assert.deepEqual(roles,{Hips:'Joint1',Chest:'Joint3',Head:'Joint15',Spine:'Joint2',Neck:'Joint14',LeftFrontFoot:'Joint7',LeftFrontUpper:'Joint5',LeftFrontLower:'Joint6',LeftBackFoot:'Joint19',LeftBackUpper:'Joint16',LeftBackLower:'Joint17',RightFrontFoot:'Joint12',RightFrontUpper:'Joint10',RightFrontLower:'Joint11',RightBackFoot:'Joint23',RightBackUpper:'Joint20',RightBackLower:'Joint21'});
 assert.equal(bodyMapReport(hound.joints,map,{requireReview:false}).helpers,7);assert.equal(hound.joints.length,24);
});
for(const facing of Object.keys(FACINGS))test('real HOUND: '+facing+' facing survives scale/translation and shuffled joint storage',()=>{
 const joints=structuredClone(hound.joints).reverse();joints.forEach(j=>j.position=turnPosition(j.position,FACINGS[facing]).map((v,k)=>v*.025+[10,-4,7][k]));const before=JSON.stringify(joints),result=suggestBodySetup(joints);
 assert.equal(result.detected,true);assert.equal(result.map.kind,'quadruped');assert.equal(result.map.facing,facing);assert.deepEqual(result.map.roles,suggestBodySetup(hound.joints).map.roles);assert.equal(JSON.stringify(joints),before);
});
test('an inverted quadruped cannot pass the relaxed head-height rule',()=>{
 const {map}=suggestBodySetup(hound.joints),joints=structuredClone(hound.joints);joints.forEach(j=>j.position[1]*=-1);assert.match(bodyMapReport(joints,map,{requireReview:false}).issues.join(' '),/paws must be below/);
});
test('a tail many body lengths long cannot invalidate body-scale tolerances',()=>{
 const joints=structuredClone(hound.joints),{map}=suggestBodySetup(joints),hips=joints.find(j=>j.id===map.roles.Hips),tail=createJoint([hips.position[0],hips.position[1],hips.position[2]-.2],hips.id,'Tail'),tip=createJoint([hips.position[0],hips.position[1],hips.position[2]-100],tail.id,'TailTip');joints.push(tail,tip);const result=suggestBodySetup(joints);
 assert.equal(result.detected,true);assert.deepEqual(bodyMapReport(joints,result.map,{requireReview:false}).issues,[]);assert.equal(result.map.roles.Head,map.roles.Head);
});
test('long horizontal upper limbs are kept instead of skipping ahead to the elbow',()=>{
 const {doc,ids}=bodyFixture('quadruped');doc.joints.forEach((j,i)=>j.name='Joint'+i);for(const side of ['Left','Right']){const a=doc.joints.find(j=>j.id===ids[side+'FrontUpper']),b=doc.joints.find(j=>j.id===ids[side+'FrontLower']);b.position=[a.position[0]+(side==='Left'?.6:-.6),a.position[1],a.position[2]];}const upper=doc.joints.find(j=>j.id===ids.LeftFrontUpper);
 const result=suggestBodySetup(doc.joints,{kind:'quadruped',facing:'+Z'});assert.equal(result.map.roles.LeftFrontUpper,upper.id);
});
test('reviewed real HOUND sends 17 roles and root travel moves its retained wrapper once',()=>{
 const doc=createActionDocument('HOUND regression');doc.joints=structuredClone(hound.joints);const {map}=suggestBodySetup(doc.joints);doc.bodyMap={...map,signature:bodySignature(doc.joints,map)};const before=JSON.stringify(doc.joints),status=motionRigStatus(doc);assert.deepEqual(status.issues,[]);assert.equal(status.joints.length,17);assert.match(motionRigStatus(doc,'momask').issues.join(' '),/human body map/);
 const {clip,mapped}=retargetMotion(doc,flatMotion(status.joints));assert.equal(mapped,17);const wrapper=doc.joints.find(j=>!j.parent);assert.ok(clip.tracks[wrapper.id].at(-1).position[2]>.99);assert.deepEqual(clip.tracks[map.roles.Hips].at(-1).position,[0,0,0]);assert.equal(JSON.stringify(doc.joints),before);
});
test('review/save normalization preserves already-unit rest and action quaternions exactly',()=>{
 const doc=createActionDocument('Stable rotations');doc.joints=[createJoint([0,0,0],null,'Hips')];const q=[Math.sin(.1234),Math.sin(.4321),Math.sin(.21),Math.cos(.31)],length=Math.hypot(...q);doc.joints[0].rotation=q.map(v=>v/length);const id=doc.joints[0].id,sourceRotation=[-.5331838454164602,.3795765687522826,.029672773556215472,.755484044802166];doc.clips[0].tracks[id]=[{time:0,position:[0,0,0],rotation:sourceRotation,interpolation:'LINEAR'}];
 const first=normalizeActionDocument(doc),serialized=stringifyActionDocument(first);assert.deepEqual(first.clips[0].tracks[id][0].rotation,sourceRotation);for(let i=0;i<10;i++)assert.equal(stringifyActionDocument(parseActionDocument(serialized)),serialized);assert.deepEqual(normalizeActionDocument(first),first);
 const scaled=structuredClone(first);scaled.clips[0].tracks[id][0].rotation=[0,0,0,2];assert.deepEqual(normalizeActionDocument(scaled).clips[0].tracks[id][0].rotation,[0,0,0,1]);scaled.clips[0].tracks[id][0].rotation=[0,0,0,0];assert.throws(()=>normalizeActionDocument(scaled),/empty quaternion/);
});
console.log(passed+' supplied-draft rig checks passed.');
