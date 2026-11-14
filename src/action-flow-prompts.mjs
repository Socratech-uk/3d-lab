import {ACTION_PROMPTS,normalizePrompt} from './action-prompts.mjs';

/** Use the composer's live library; a workflow keeps its own portable snapshot. */
export function flowPromptChoices(saved=[]){
 return [
  ...ACTION_PROMPTS.map(p=>({key:'preset:'+p.id,group:p.group,recipe:normalizePrompt(p)})),
  ...saved.map(p=>({key:'saved:'+p.id,group:'Your saved prompts',recipe:normalizePrompt(p)}))
 ];
}

export function flowActionFromPrompt(recipe,model,{durationSeconds=recipe.durationSeconds,seed=recipe.seed,loop=false}={}){
 const value=normalizePrompt({...recipe,durationSeconds,seed});
 if(!['unimate','momask'].includes(model))throw new Error('Choose UniMate or MoMask.');
 if(model==='momask'&&value.durationSeconds>9.6)throw new Error('MoMask allows up to 9.6 seconds. Shorten this workflow copy or choose UniMate.');
 return {name:value.actionName.trim()||value.name,prompt:value.prompt,durationSeconds:value.durationSeconds,seed:value.seed,loop:!!loop};
}
