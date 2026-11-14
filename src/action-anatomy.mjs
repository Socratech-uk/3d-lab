import {check} from './core.mjs';
import {jointKey} from './action-joint-names.mjs';

// A body map references existing joints. It never renames/reorders bones or edits skin indices.
const role=(name,label,parent,required=true)=>({name,label,parent,required});
const trunk=[role('Hips','Pelvis / body root',null),role('Spine','Lower spine','Hips'),role('Chest','Chest','Spine',false),role('Neck','Neck base','Chest',false),role('Head','Head','Neck')];
export const BODY_ROLES=Object.freeze({
 humanoid:[...trunk,...['Left','Right'].flatMap(s=>[
  role(s+'Shoulder',s+' collarbone','Chest',false),role(s+'Arm',s+' upper arm',s+'Shoulder'),role(s+'ForeArm',s+' elbow',s+'Arm'),role(s+'Hand',s+' wrist / hand',s+'ForeArm'),
  role(s+'UpLeg',s+' hip / thigh','Hips'),role(s+'Leg',s+' knee',s+'UpLeg'),role(s+'Foot',s+' ankle / foot',s+'Leg'),role(s+'ToeBase',s+' toes',s+'Foot',false)])],
 quadruped:[...trunk,role('Tail','Tail base','Hips',false),role('TailTip','Tail tip','Tail',false),...['Left','Right'].flatMap(s=>['Front','Back'].flatMap(end=>[
  role(s+end+'Upper',s+' '+end.toLowerCase()+' upper leg',end==='Front'?'Chest':'Hips'),role(s+end+'Lower',s+' '+end.toLowerCase()+' knee / elbow',s+end+'Upper'),role(s+end+'Foot',s+' '+end.toLowerCase()+' paw / hoof',s+end+'Lower')]))]
});
export const FACINGS={'+Z':0,'-Z':Math.PI,'+X':Math.PI/2,'-X':-Math.PI/2};
export const genericJoint=name=>/^(?:joint|bone|node)[\s_.-]*\d*$/i.test(name?.trim()||'');
export const bodyKind=joints=>suggestBodySetup(joints).map.kind;
export function turnPosition(p,yaw){const c=Math.cos(yaw),s=Math.sin(yaw);return [c*p[0]+s*p[2],p[1],-s*p[0]+c*p[2]];}
const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
const cleanObject=o=>o&&typeof o==='object'&&!Array.isArray(o);
export function normalizeBodyMap(value,joints){
 check(cleanObject(value)&&value.version===1&&Object.hasOwn(BODY_ROLES,value.kind),'Unsupported body map.');
 check(Object.hasOwn(FACINGS,value.facing)&&cleanObject(value.roles),'Choose a body facing and joint roles.');
 const allowed=new Set(BODY_ROLES[value.kind].map(r=>r.name)),ids=new Set(joints.map(j=>j.id)),used=new Set(),roles={};
 check(Object.keys(value.roles).length<=BODY_ROLES[value.kind].length,'Too many body roles.');
 for(const [role,id]of Object.entries(value.roles)){check(allowed.has(role)&&typeof id==='string'&&ids.has(id),'Body map refers to an unknown role or joint.');check(!used.has(id),'Each body role needs a different joint.');used.add(id);roles[role]=id;}
 check(value.signature===undefined||typeof value.signature==='string'&&/^[0-9a-f]{16}$/.test(value.signature),'Invalid body-map review signature.');
 return {version:1,kind:value.kind,facing:value.facing,roles,...(value.signature?{signature:value.signature}:{})};
}
export function bodySignature(joints,map){
 // Synchronous change detector, not a security/content hash. Include helpers: changing
 // their hierarchy or rest frames can invalidate a previously checked body map.
 const value=JSON.stringify([map.kind,map.facing,BODY_ROLES[map.kind].map(r=>[r.name,map.roles[r.name]||null]),joints.map(j=>[j.id,j.parent,j.position,j.rotation,j.type])]);
 let a=2166136261,b=5381;for(let i=0;i<value.length;i++){a=Math.imul(a^value.charCodeAt(i),16777619);b=Math.imul(b,33)^value.charCodeAt(i);}
 return (a>>>0).toString(16).padStart(8,'0')+(b>>>0).toString(16).padStart(8,'0');
}
export function namedBodyMap(joints,kind=bodyKind(joints)){
 const roles={},used=new Set();for(const r of BODY_ROLES[kind]){const exact=joints.filter(j=>j.name.toLowerCase()===r.name.toLowerCase());const matches=exact.length?exact:joints.filter(j=>jointKey(j.name)===jointKey(r.name));if(matches.length===1&&!used.has(matches[0].id)){roles[r.name]=matches[0].id;used.add(matches[0].id);}}
 return {version:1,kind,facing:'+Z',roles};
}
function tree(joints){
 const byId=new Map(joints.map(j=>[j.id,j])),children=new Map(joints.map(j=>[j.id,[]]));for(const j of joints)children.get(j.parent)?.push(j.id);
 const ancestors=id=>{const list=[],seen=new Set();while(byId.has(id)&&!seen.has(id)){seen.add(id);list.push(id);id=byId.get(id).parent;}return list;};
 const path=(a,b)=>{const chain=ancestors(b);const i=chain.indexOf(a);return i<0?[]:chain.slice(0,i+1).reverse();};
 const common=(a,b)=>ancestors(a).find(id=>ancestors(b).includes(id));
 return {byId,children,ancestors,path,common};
}
export function bodyMapReport(joints,input,{requireReview=true}={}){
 const map=normalizeBodyMap(input,joints),defs=BODY_ROLES[map.kind],t=tree(joints),issues=[],warnings=[];
 const mapped=defs.filter(r=>map.roles[r.name]),missing=defs.filter(r=>r.required&&!map.roles[r.name]).map(r=>r.label);
 if(missing.length)issues.push('Map '+missing.join(', ')+'.');
 if(joints.filter(j=>j.parent===null).length!==1)issues.push('The detailed rig needs one connected root.');
 // Size tolerances belong to the body. A long tail or remote detail/helper must
 // not turn ordinary limb spans into overlaps or invalidate side/facing checks.
 const bodyIds=new Set(mapped.filter(r=>!/^Tail/.test(r.name)).map(r=>map.roles[r.name])),positions=joints.filter(j=>map.kind!=='quadruped'||bodyIds.has(j.id)).map(j=>j.position);
 const span=Math.max(...[0,1,2].map(k=>Math.max(...positions.map(p=>p[k]))-Math.min(...positions.map(p=>p[k]))),1e-8);
 const defByName=new Map(defs.map(r=>[r.name,r]));
 for(const r of mapped){const joint=t.byId.get(map.roles[r.name]);if(joint.type!=='ball')issues.push(r.label+' needs a ball joint for AI motion.');
  let parent=r.parent;while(parent&&!map.roles[parent])parent=defByName.get(parent)?.parent;
  if(parent){const p=t.byId.get(map.roles[parent]);if(!t.path(p.id,joint.id).length)issues.push(r.label+' must descend from '+defByName.get(parent).label+'; check the selected joint and its parents.');else if(distance(p.position,joint.position)<span*.002)issues.push(r.label+' overlaps its mapped parent; separate the joint positions.');}
 }
 // Labels alone are not evidence of orientation. Reject reversed sides/upside-down
 // bodies before normalising the temporary motion skeleton.
 const p=name=>{const j=t.byId.get(map.roles[name]);return j?turnPosition(j.position,-FACINGS[map.facing]):null;};
 for(const r of mapped.filter(r=>r.name.startsWith('Left'))){const l=p(r.name),right=p(r.name.replace(/^Left/,'Right'));if(right&&l[0]<=right[0]+span*.005)issues.push(r.label+' is on the wrong side or overlaps its right partner for the chosen facing.');}
 const hips=p('Hips'),head=p('Head');if(map.kind==='humanoid'&&hips&&head&&head[1]<=hips[1]+span*.05)issues.push('The head must be above the pelvis. Use an upright rest pose (Y-up).');
 if(map.kind==='quadruped'){const chest=p('Chest')||p('Spine');if(hips&&chest&&chest[2]<=hips[2]+span*.02)issues.push('The animal’s chest must be ahead of its pelvis for the chosen facing.');if(hips&&head&&head[2]<=hips[2]+span*.02)issues.push('The animal’s head must be ahead of its pelvis for the chosen facing.');const feet=mapped.filter(r=>/Foot$/.test(r.name)).map(r=>p(r.name));if(hips&&feet.length===4&&feet.every(v=>v[1]>=hips[1]-span*.02))issues.push('The animal’s paws must be below its pelvis. Check Y-up and the resting pose.');}
 for(const r of mapped.filter(r=>/Foot$/.test(r.name))){const foot=p(r.name);if(hips&&foot[1]>=hips[1]-span*.05)warnings.push(r.label+' is high relative to the pelvis; check the rest pose.');}
 const reviewed=map.signature===bodySignature(joints,map);
 if(requireReview&&!reviewed)issues.push('Review the suggested body joints and facing, then click Use body map.');
 return {map,mapped:mapped.length,helpers:joints.length-mapped.length,missing,issues:[...new Set(issues)],warnings:[...new Set(warnings)],reviewed,ok:!issues.length};
}

/** Conservative topology + position suggestions. No new joints, no mesh surgery,
 * no claim of confidence probabilities. Missing/ambiguous anatomy stays editable. */
export function suggestBodyMap(joints,kind='humanoid',facing='+Z'){
 check(Object.hasOwn(BODY_ROLES,kind)&&Object.hasOwn(FACINGS,facing),'Choose a supported body and facing.');
 const map=namedBodyMap(joints,kind);map.facing=facing;const roles=map.roles,t=tree(joints),used=new Set(Object.values(roles));
 const p=new Map(joints.map(j=>[j.id,turnPosition(j.position,-FACINGS[facing])])),all=[...p.values()];
 if(all.length<5)return {map,sources:Object.fromEntries(Object.keys(roles).map(r=>[r,'name'])),note:'Too few joints for body suggestions.'};
 const lo=[0,1,2].map(k=>Math.min(...all.map(v=>v[k]))),hi=[0,1,2].map(k=>Math.max(...all.map(v=>v[k]))),height=Math.max(hi[1]-lo[1],1e-8),width=Math.max(hi[0]-lo[0],height*.1),depth=Math.max(hi[2]-lo[2],height*.1),cx=(hi[0]+lo[0])/2;
 const sources=Object.fromEntries(Object.keys(roles).map(r=>[r,'name']));
 const put=(role,id)=>{if(!roles[role]&&id&&!used.has(id)){roles[role]=id;used.add(id);sources[role]='position + tree';}return roles[role];};
 const choose=(filter,score)=>joints.filter(j=>filter(p.get(j.id),j)).sort((a,b)=>score(p.get(a.id),a)-score(p.get(b.id),b)||a.id.localeCompare(b.id))[0]?.id;
 // Split the four feet using low, lateral joints, not the entire rig's bounds.
 // A long tail or muzzle can otherwise put both pairs in the same half.
 const ground=all.filter(v=>v[1]<lo[1]+height*.3&&Math.abs(v[0]-cx)>width*.025),groundZ=ground.map(v=>v[2]);
 const feetMidZ=groundZ.length?(Math.min(...groundZ)+Math.max(...groundZ))/2:(lo[2]+hi[2])/2;
 const feetDepth=groundZ.length?Math.max(...groundZ)-Math.min(...groundZ):depth;
 const lowFeet={};
 for(const side of ['Left','Right']){const sign=side==='Left'?1:-1;for(const end of kind==='humanoid'?['']:['Front','Back']){
  const zsign=end==='Front'?1:-1,role=side+(end||'')+'Foot';
  lowFeet[role]=roles[role]||choose(v=>v[1]<lo[1]+height*.3&&(v[0]-cx)*sign>width*.025&&(kind==='humanoid'||(v[2]-feetMidZ)*zsign>feetDepth*.035),v=>kind==='humanoid'?Math.abs((v[1]-lo[1])/height-.055)+Math.abs(v[2]-(lo[2]+hi[2])/2)/height*.08:(v[1]-lo[1])/height);
 }}
 if(kind==='quadruped')for(const footRole of Object.keys(lowFeet)){
  // A short, mostly horizontal terminal segment is often a toe beyond the paw
  // pivot. Keep the tip in the detailed rig instead of conditioning on it.
  if(roles[footRole])continue;const tip=lowFeet[footRole],joint=t.byId.get(tip),parent=t.byId.get(joint?.parent),before=t.byId.get(parent?.parent);
  if(!parent||!before||(t.children.get(tip)||[]).length||(t.children.get(parent.id)||[]).length!==1)continue;
  const a=p.get(before.id),b=p.get(parent.id),c=p.get(tip),last=distance(b,c),previous=distance(a,b),drop=Math.abs(c[1]-b[1]),horizontal=Math.hypot(c[0]-b[0],c[2]-b[2]);
  if(last<previous*.6&&drop<Math.abs(b[1]-a[1])*.45&&horizontal>drop)lowFeet[footRole]=parent.id;
 }
 const hipEnds=kind==='humanoid'?['LeftFoot','RightFoot']:['LeftBackFoot','RightBackFoot'];
 put('Hips',t.common(lowFeet[hipEnds[0]],lowFeet[hipEnds[1]]));
 const hips=roles.Hips;
 if(kind==='humanoid'&&hips)for(const footRole of Object.keys(lowFeet)){
  // Large boots and short-legged characters put the ankle above the lowest
  // height band. A forward terminal toe must not steal the foot (and knee) role.
  if(roles[footRole])continue;const tip=lowFeet[footRole],joint=t.byId.get(tip),parent=t.byId.get(joint?.parent);if(!parent||t.path(hips,tip).length<5||(t.children.get(tip)||[]).length||(t.children.get(parent.id)||[]).length!==1)continue;
  const a=p.get(parent.id),b=p.get(tip),forward=b[2]-a[2],drop=Math.abs(b[1]-a[1]);
  if(a[1]<lo[1]+height*.3&&forward>height*.04&&drop<forward*1.5&&forward>Math.abs(b[0]-a[0])*2)lowFeet[footRole]=parent.id;
 }
 if(kind==='quadruped')put('Chest',t.common(lowFeet.LeftFrontFoot,lowFeet.RightFrontFoot));
 const chest=roles.Chest,limbPaths=new Set(Object.values(lowFeet).flatMap(id=>t.path(chest,id)));
 const head=roles.Head||choose((v,j)=>!used.has(j.id)&&Math.abs(v[0]-cx)<width*.18&&(kind==='quadruped'?chest&&t.path(chest,j.id).length>1&&!t.path(chest,j.id).slice(1).some(id=>limbPaths.has(id))&&v[2]>p.get(chest)[2]+height*.04:v[1]>lo[1]+height*.65&&(!hips||t.path(hips,j.id).length)),v=>kind==='quadruped'?-(v[2]-lo[2])/depth+Math.abs(v[0]-cx)/height:-(v[1]-lo[1])/height+Math.abs(v[0]-cx)/height);put('Head',head);
 const hands={};if(kind==='humanoid')for(const side of ['Left','Right']){const sign=side==='Left'?1:-1;hands[side]=roles[side+'Hand']||choose((v,j)=>v[1]>lo[1]+height*.34&&(v[0]-cx)*sign>width*.18&&(!hips||t.path(hips,j.id).length),v=>-(v[0]-cx)*sign/width);}
 if(kind==='humanoid')put('Chest',t.common(hands.Left,hands.Right));
 const sample=(path,fraction,exclude=new Set())=>{if(!path.length)return null;const lengths=[0];for(let i=1;i<path.length;i++)lengths.push(lengths[i-1]+distance(p.get(path[i-1]),p.get(path[i])));const target=lengths.at(-1)*fraction;return path.map((id,i)=>({id,d:Math.abs(lengths[i]-target)})).filter(v=>!used.has(v.id)&&!exclude.has(v.id)).sort((a,b)=>a.d-b.d)[0]?.id;};
 const spine=t.path(hips,roles.Head);if(spine.length>2){const chestIndex=spine.indexOf(roles.Chest),lower=chestIndex>0?spine.slice(0,chestIndex+1):spine;put('Spine',sample(lower,.45,new Set([hips,roles.Head])));if(!roles.Chest)put('Chest',sample(spine,.6));const neckPath=t.path(roles.Chest||roles.Spine||hips,roles.Head);if(neckPath.length>2)put('Neck',sample(neckPath,.65));}
 for(const [footRole,foot]of Object.entries(lowFeet)){const upper=kind==='humanoid'?footRole.replace('Foot','UpLeg'):footRole.replace('Foot','Upper'),lower=kind==='humanoid'?footRole.replace('Foot','Leg'):footRole.replace('Foot','Lower'),anchor=footRole.includes('Front')?(roles.Chest||roles.Spine||hips):hips,path=t.path(anchor,foot);if(path.length<4)continue;
  put(footRole,foot);const limb=path.slice(1),lateral=limb.filter(id=>Math.abs(p.get(id)[0]-cx)>width*.02&&!used.has(id));
  // Skip only short, sideways proximal collar/helper links. Stop at the first
  // substantial limb segment, even when that upper leg is posed horizontally.
  let upperId=lateral[0];if(kind==='quadruped'){let skipped=0;for(let i=limb.indexOf(upperId);i>=0&&i<limb.length-2;i++){
   const a=p.get(limb[i]),b=p.get(limb[i+1]),length=distance(a,b),vertical=Math.abs(b[1]-a[1]),horizontal=Math.hypot(b[0]-a[0],b[2]-a[2]);
   if(used.has(limb[i+1])||length>height*.18||vertical>height*.05||horizontal<=vertical*2||skipped+length>height*.25)break;upperId=limb[i+1];skipped+=length;
  }}
  put(upper,upperId);put(lower,sample(t.path(roles[upper],roles[footRole]),.52));
  if(kind==='humanoid'){const toes=t.children.get(roles[footRole])||[];put(footRole.replace('Foot','ToeBase'),toes.filter(id=>!used.has(id)).sort((a,b)=>p.get(b)[2]-p.get(a)[2])[0]);}
 }
 if(kind==='humanoid')for(const side of ['Left','Right']){const anchor=roles.Chest||roles.Spine||hips,full=t.path(anchor,hands[side]);if(full.length<4)continue;const path=full.slice(1);
  // Finger fans identify the wrist. Otherwise use the furthest endpoint as a
  // review suggestion; do not invent a palm joint in the middle of a bone.
  const wrist=path.find((id,i)=>i>=2&&(t.children.get(id)||[]).length>=2)||hands[side];put(side+'Hand',wrist);const limb=t.path(anchor,roles[side+'Hand']).slice(1);if(limb.length<3)continue;
  if(limb.length>=4)put(side+'Shoulder',limb[0]);put(side+'Arm',limb.find(id=>!used.has(id)));put(side+'ForeArm',sample(t.path(roles[side+'Arm'],roles[side+'Hand']),.5));
 }
 if(kind==='quadruped'&&hips){const bodyPaths=new Set([roles.Head,...Object.values(lowFeet)].flatMap(id=>t.path(hips,id))),tail=choose((v,j)=>v[2]<p.get(hips)[2]-height*.1&&Math.abs(v[0]-cx)<width*.2&&t.path(hips,j.id).length>1&&!t.path(hips,j.id).slice(1).some(id=>bodyPaths.has(id)),v=>v[2]);const path=t.path(hips,tail).slice(1);if(path.length){put('Tail',path[0]);if(path.length>1)put('TailTip',path.at(-1));}}
 return {map,sources,note:'Suggestions use names, branch paths and joint positions. Check every role on the mesh; fingers, tails and unusual poses can be ambiguous.'};
}

const setupCache=new WeakMap();
/** Suggest a body category and horizontal facing from anatomy, never from joint
 * count or an asset title. Only a complete four-legged topology is auto-detected.
 * The result is a UI proposal: it has no review signature and does not edit a rig. */
export function suggestBodySetup(joints,{kind=null,facing=null}={}){
 check(!kind||Object.hasOwn(BODY_ROLES,kind),'Choose a supported body.');check(!facing||Object.hasOwn(FACINGS,facing),'Choose a supported facing.');
 const key=JSON.stringify([kind,facing,joints.map(j=>[j.id,j.name,j.parent,j.position,j.type])]),cached=setupCache.get(joints);if(cached?.key===key)return structuredClone(cached.result);
 const namedKind=joints.some(j=>/(?:Front|Back)(?:Upper|Lower|Foot)/i.test(j.name))?'quadruped':'humanoid';
 const usable=joints.length>=5&&joints.every(j=>Array.isArray(j.position)&&j.position.length===3&&j.position.every(Number.isFinite));
 let result;
 if(!usable){result={map:{version:1,kind:kind||namedKind,facing:facing||'+Z',roles:{}},sources:{},detected:false,note:'Place a connected Y-up rig before suggesting body labels.'};}
 else{
  const facings=facing?[facing]:Object.keys(FACINGS),kinds=kind?[kind]:['quadruped','humanoid'];
  const candidates=kinds.flatMap(body=>facings.map(direction=>{const suggestion=suggestBodyMap(joints,body,direction),report=bodyMapReport(joints,suggestion.map,{requireReview:false}),p=role=>{const joint=joints.find(j=>j.id===suggestion.map.roles[role]);return joint?turnPosition(joint.position,-FACINGS[direction]):null;};
   const feet=['LeftFrontFoot','RightFrontFoot','LeftBackFoot','RightBackFoot'].map(p),hips=p('Hips'),chest=p('Chest'),height=Math.max(...joints.map(j=>j.position[1]))-Math.min(...joints.map(j=>j.position[1]));
   // Four separate low branches, two longitudinal pairs and a forward torso.
   // Hanging human hands or a two-legged animal must not become forepaws.
   const animal=body==='quadruped'&&report.ok&&feet.every(Boolean)&&hips&&chest&&(feet[0][2]+feet[1][2]-feet[2][2]-feet[3][2])/2>height*.3&&chest[2]-hips[2]>Math.abs(chest[1]-hips[1])*1.2;
   return {...suggestion,report,animal,names:Object.values(suggestion.sources).filter(s=>s==='name').length};
  }));
  const animals=candidates.filter(c=>c.animal),pool=kind?candidates:animals.length?animals:candidates.filter(c=>c.map.kind===namedKind);
  pool.sort((a,b)=>a.report.issues.length-b.report.issues.length||b.names-a.names||b.report.mapped-a.report.mapped||facings.indexOf(a.map.facing)-facings.indexOf(b.map.facing));
  const best=pool[0],detected=!!best.animal;
  result={map:best.map,sources:best.sources,detected,note:(detected?'Four-legged layout suggested from four low limb branches and the pelvis-to-chest direction. ':'')+best.note+(detected?' Review the proposed facing and every label before applying.':!facing?' Facing may be ambiguous; check the forward arrow.':'')};
 }
 setupCache.set(joints,{key,result});return structuredClone(result);
}

/** Display semantic labels alongside stable source names. Unmapped detail joints
 * keep their own names; no guesses are written into animation/skin indices. */
export function bodyJointLabel(joint,map,{suggested=false}={}){
 const role=Object.entries(map?.roles||{}).find(([,id])=>id===joint.id)?.[0];
 return role?role+(role===joint.name?'':' · '+joint.name)+(suggested?' · suggested':''):joint.name;
}

export function motionRigStatus(doc,model='unimate'){
 const joints=doc?.joints||[];if(!joints.length)return {issues:['Add a rig before generating motion.'],joints:[],map:null,helpers:0};
 let map=doc.bodyMap,implicit=false;
 if(!map){map=namedBodyMap(joints);const named=bodyMapReport(joints,map,{requireReview:false});if(named.ok){implicit=true;map={...map,signature:bodySignature(joints,map)};}else if(model==='unimate'&&named.missing.length&&!joints.some(j=>genericJoint(j.name))&&joints.length<=70){return {issues:[],joints,helpers:0,map:null,custom:true};}else return {issues:['Map body joints before AI motion. Choose a humanoid or animal body map; generic labels and extra helpers do not identify the limbs.'],joints:[],map:null,helpers:0};}
 const report=bodyMapReport(joints,map);if(model==='momask'&&map.kind!=='humanoid')report.issues.unshift('MoMask needs a human body map. Use UniMate for animals.');
 const defs=BODY_ROLES[map.kind],byName=new Map(defs.map(r=>[r.name,r])),byId=new Map(joints.map(j=>[j.id,j]));
 const compact=defs.filter(r=>map.roles[r.name]).map(r=>{const joint=byId.get(map.roles[r.name]);let parent=r.parent;while(parent&&!map.roles[parent])parent=byName.get(parent)?.parent;return {...joint,name:r.name,parent:parent?map.roles[parent]:null,position:turnPosition(joint.position,-FACINGS[map.facing])};});
 // Traverse parent-first even if the role catalogue places an optional limb later.
 const ordered=[],todo=[...compact];while(todo.length){const i=todo.findIndex(j=>!j.parent||ordered.some(p=>p.id===j.parent));if(i<0){report.issues.push('Body roles must form one connected tree.');break;}ordered.push(...todo.splice(i,1));}
 return {...report,joints:ordered,map,implicit,ok:!report.issues.length};
}
export function motionTargetNames(doc){return Object.fromEntries(Object.entries(doc.bodyMap?.roles||{}).map(([role,id])=>[id,role]));}
export function pruneBodyMap(doc){if(!doc.bodyMap)return;const ids=new Set(doc.joints.map(j=>j.id));for(const [r,id]of Object.entries(doc.bodyMap.roles))if(!ids.has(id))delete doc.bodyMap.roles[r];}
