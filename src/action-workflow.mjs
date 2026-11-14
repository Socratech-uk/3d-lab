import {bodyKind,bodyMapReport} from './action-anatomy.mjs';
/** UI guidance from the scene that is actually open. No rig or binding is changed. */
export function actionWorkflow({document=null,parts=[],record=null,dirty=false,candidate=false,kind=null}={}){
 const joints=document?.joints||[],clips=document?.clips||[],bindings=document?.bindings||{};
 const ids=parts.map(part=>typeof part==='string'?part:part.id);
 const boundParts=ids.filter(id=>['skin','rigid'].includes(bindings[id]?.mode)).length;
 const unboundIds=ids.filter(id=>!['skin','rigid'].includes(bindings[id]?.mode));
 const genericNames=joints.filter(j=>/^(?:joint|bone|node)[\s_.-]*\d*$/i.test(j.name?.trim()||'')).map(j=>j.id);
 const seen=new Set(),duplicateNames=[];
 for(const joint of joints){const name=joint.name.trim().toLowerCase();if(seen.has(name))duplicateNames.push(joint.id);seen.add(name);}
 const roots=joints.filter(j=>!j.parent).length;
 const keyedClips=clips.filter(clip=>Object.values(clip.tracks||{}).some(keys=>keys.length));
 const inferredKind=document?.bodyMap?.kind|| (joints.some(j=>['hinge','slider'].includes(j.type))?'mechanical':bodyKind(joints));
 kind=['humanoid','quadruped','mechanical'].includes(kind)?kind:inferredKind;
 const mapped=document?.bodyMap?bodyMapReport(joints,document.bodyMap).ok:false;
 const namesNeedReview=!mapped&&kind!=='mechanical'&&(!!document?.bodyMap||genericNames.length>0||duplicateNames.length>0||roots>1);
 const savedDraft=!!(record?.files?.actionDocument||record?.asset?.origin==='action');
 const sourceKind=!ids.length?'No model':!record?'Practice scene':savedDraft?'Action draft':keyedClips.length?'Model with actions':joints.length?'Rigged model':'Model asset';
 let stage=!ids.length?'no-model':candidate?'candidate':!joints.length?'rig':!boundParts?'bind':keyedClips.length?'review':namesNeedReview?'names':unboundIds.length&&kind!=='mechanical'?'partial':'animate';
 return {stage,kind,sourceKind,sourceTitle:record?.asset?.title||document?.title||'Choose a model',sourceId:record?.asset?.id||null,savedDraft,dirty,
  parts:ids.length,boundParts,unboundParts:unboundIds.length,unboundIds,jointCount:joints.length,genericNames,duplicateNames,roots,namesNeedReview,keyedActions:keyedClips.length,firstActionId:keyedClips[0]?.id||null,
  saveLabel:dirty?'Unsaved edits · Save actions to keep them.':savedDraft?'Saved action draft · Save updates this asset; use Save as new asset for a variant.':record?'Working copy · Save actions when ready.':'Practice scene · Save actions to keep it.'};
}

export function workflowNext(state){
 const mechanical=state.kind==='mechanical';
 return {
  'no-model':{title:'Choose your model',action:'Choose asset',note:'Open a saved asset or import a GLB. Its original stays available.'},
  candidate:{title:'Review the predicted joints',action:'Review skeleton',note:'Adjust positions and names, then Apply or Discard in Rig & parts. Your previous rig and actions are kept until you decide.'},
  rig:{title:mechanical?'Give the moving part a pivot':'Add joints that match your model',action:mechanical?'Place a hinge axis':state.kind==='quadruped'?'Fit animal starting rig':'Fit human starting rig',note:mechanical?'Separate moving doors, panels or gear in Builder first. A hinge rotates; a slider moves along a line.':'Fit a starting structure, then move each joint inside the corresponding body part. A bounds fit does not find anatomy.'},
  names:{title:'Map the body before AI motion',action:'Map body joints',note:'Review suggested hips, spine and limb roles on your model. Extra joints stay in the detailed rig. Manual posing is still available.'},
  bind:{title:mechanical?'Attach the moving parts':'Make the surface follow the joints',action:'Set up binding',note:mechanical?'Select a moving mesh part and its joint, then Attach rigidly to joint. Leave fixed scenery unbound.':'Check joint positions first, then Bind with smooth weights. Weights control how much each joint moves the nearby surface.'},
  partial:{title:'Some mesh parts will stay still',action:'Review unbound parts',note:`${state.unboundParts} of ${state.parts} parts are unbound. Attach parts that should move; deliberately fixed parts may remain unbound. Existing weights are kept.`},
  animate:{title:'Create your first action',action:'Start posing',note:mechanical?'Move the timeline, rotate a hinge or move a slider, then play the action. Pose changes store keys at the chosen time.':'Move the timeline and rotate a joint to store a pose, or open AI models for text motion. Test a small bend and review the surface first.'},
  review:{title:'Preview and keep your actions',action:'Preview action',note:`${state.keyedActions} action${state.keyedActions===1?' has':'s have'} pose keys. Play each action and check bends, foot contact and any parts that should stay fixed. Save actions keeps the mesh, rig and every action together.`}
 }[state.stage];
}
