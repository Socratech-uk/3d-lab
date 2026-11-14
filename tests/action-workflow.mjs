import assert from 'node:assert/strict';
import {actionWorkflow,workflowNext} from '../src/action-workflow.mjs';

const doc=()=>({title:'Character',joints:[],bindings:{},clips:[{id:'empty',tracks:{}}]});
const joint=(id,name,parent=null,type='ball')=>({id,name,parent,type});
const asset={asset:{id:'source',title:'Original character',origin:'import'},files:{}};
let passed=0;
function test(name,fn){fn();passed++;console.log('✓ '+name);}

test('a static asset is a new working copy, not an already saved action draft',()=>{
 const state=actionWorkflow({document:doc(),parts:['body'],record:asset});
 assert.equal(state.stage,'rig');assert.equal(state.savedDraft,false);assert.equal(state.sourceId,'source');assert.equal(state.sourceTitle,'Original character');assert.match(state.saveLabel,/Working copy/);assert.equal(state.keyedActions,0);
});
test('binding counts use actual scene parts and ignore stale or detached entries',()=>{
 const document=doc();document.joints=[joint('hips','Hips')];document.bindings={body:{mode:'skin'},hair:{mode:'unbound'},stale:{mode:'skin'}};
 const state=actionWorkflow({document,parts:['body','hair','boots'],record:asset});
 assert.equal(state.stage,'partial');assert.equal(state.parts,3);assert.equal(state.boundParts,1);assert.deepEqual(state.unboundIds,['hair','boots']);assert.match(workflowNext(state).note,/2 of 3/);
});
test('a saved animated draft previews its existing actions without requesting a replacement rig',()=>{
 const document=doc();document.joints=[joint('hips','Hips')];document.bindings={body:{mode:'skin'}};document.clips.push({id:'walk',tracks:{hips:[{time:0},{time:1}]}});
 const before=JSON.stringify(document),state=actionWorkflow({document,parts:['body'],record:{asset:{...asset.asset,origin:'action'},files:{actionDocument:document}}});
 assert.equal(state.stage,'review');assert.equal(state.keyedActions,1);assert.equal(state.firstActionId,'walk');assert.equal(state.savedDraft,true);assert.equal(state.sourceKind,'Action draft');assert.equal(JSON.stringify(document),before);
});
test('generic joint names and partial binding remain visible on an animated imported GLB',()=>{
 const document=doc();document.joints=[joint('joint0','Joint0'),joint('joint1','Bone_001','joint0')];document.bindings={body:{mode:'skin'}};document.clips=[{id:'run',tracks:{joint0:[{time:0}]}}];
 const state=actionWorkflow({document,parts:['body','hat'],record:asset});
 assert.equal(state.stage,'review');assert.equal(state.namesNeedReview,true);assert.deepEqual(state.genericNames,['joint0','joint1']);assert.equal(state.unboundParts,1);assert.equal(state.savedDraft,false);
});
test('candidate status takes priority over a usable existing animation',()=>{
 const document=doc();document.joints=[joint('hips','Hips')];document.bindings={body:{mode:'skin'}};document.clips=[{id:'walk',tracks:{hips:[{time:0}]}}];
 assert.equal(actionWorkflow({document,parts:['body'],candidate:true}).stage,'candidate');
});
test('mechanical guidance allows deliberately unbound fixed geometry and generic pivot names',()=>{
 const document=doc();document.joints=[joint('hinge','Joint0',null,'hinge')];document.bindings={door:{mode:'rigid',joint:'hinge'},wall:{mode:'unbound'}};
 const state=actionWorkflow({document,parts:['door','wall']});
 assert.equal(state.kind,'mechanical');assert.equal(state.stage,'animate');assert.equal(state.namesNeedReview,false);assert.equal(state.unboundParts,1);
});
test('choosing another guidance type does not add joints or overwrite existing bindings',()=>{
 const document=doc();document.joints=[joint('hips','Hips'),joint('front','LeftFrontUpper','hips')];document.bindings={body:{mode:'skin'}};
 const before=JSON.stringify(document);assert.equal(actionWorkflow({document,parts:['body']}).kind,'quadruped');assert.equal(actionWorkflow({document,parts:['body'],kind:'mechanical'}).kind,'mechanical');assert.equal(JSON.stringify(document),before);
});
test('AI naming guidance detects duplicate names and disconnected roots without claiming engine readiness',()=>{
 const document=doc();document.joints=[joint('a','Hips'),joint('b','hips')];document.bindings={body:{mode:'skin'}};
 const state=actionWorkflow({document,parts:['body']});
 assert.equal(state.stage,'names');assert.equal(state.roots,2);assert.deepEqual(state.duplicateNames,['b']);assert.match(workflowNext(state).note,/Manual posing is still available/);
});
test('saved practice drafts preserve their source classification and dirty state',()=>{
 const document=doc();document.source=null;
 const state=actionWorkflow({document,parts:['body'],record:{asset:{id:'practice-draft',title:'Practice saved',origin:'action'},files:{actionDocument:document}},dirty:true});
 assert.equal(state.savedDraft,true);assert.match(state.saveLabel,/Unsaved edits/);assert.equal(document.source,null);
});
test('empty and unbound scenes are not presented as motion ready',()=>{
 assert.equal(actionWorkflow().stage,'no-model');const document=doc();document.joints=[joint('hips','Hips')];assert.equal(actionWorkflow({document,parts:['body']}).stage,'bind');
});
console.log(passed+' Action Lab workflow checks passed.');
