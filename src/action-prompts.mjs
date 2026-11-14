// Prompt recipes are independent of saved geometry and never execute as code.
export const PROMPT_STORAGE_KEY='capp.3d-lab.action-prompts.v1';
export const PROMPT_LIMITS=Object.freeze({entries:48,bytes:256*1024,prompt:2000,name:80,duration:60});
const requireValue=(condition,message)=>{if(!condition)throw new Error(message);};
const preset=(id,group,name,prompt,durationSeconds=6)=>Object.freeze({id,group,name,prompt,durationSeconds,seed:0});
export const ACTION_PROMPTS=Object.freeze([
 preset('game-start','Game movement · review and trim','Start walking','A person starts walking forward from a standing position.',2),
 preset('game-stop','Game movement · review and trim','Come to rest','A person walks forward, slows down and comes to a stop.',4),
 preset('game-back','Game movement · review and trim','Walk backward','A person walks backward.',4),
 preset('game-left','Game movement · review and trim','Strafe left','A person sidesteps to their left while facing forward.',4),
 preset('game-right','Game movement · review and trim','Strafe right','A person sidesteps to their right while facing forward.',4),
 preset('human-walk','People · locomotion','Walk forward','A person walks forward.'),
 preset('human-walk-place','People · locomotion','Walk in place','A person walks in place.'),
 preset('human-run','People · locomotion','Run forward','A person runs forward.'),
 preset('human-idle','People · locomotion','Stand idle','A person stands still.'),
 preset('human-crouch','People · locomotion','Crouch','A person crouches.',2),
 preset('human-crouch-walk','People · locomotion','Crouch walk','A person walks while crouching.'),
 preset('human-jump','People · locomotion','Jump','A person jumps.',2),
 preset('human-turn','People · locomotion','Turn left','A person turns left.',2),
 preset('human-wave','People · gestures','Wave','A person waves.',2),
 preset('human-dance','People · gestures','Dance','A person dances.'),
 preset('animal-walk','Animals · quadrupeds','Animal walk','An object walks forward.'),
 preset('animal-trot','Animals · quadrupeds','Animal trot','An object trots forward.'),
 preset('animal-run','Animals · quadrupeds','Animal run','An object runs forward.'),
 preset('animal-idle','Animals · quadrupeds','Animal idle','An object stands still.'),
 preset('animal-sit','Animals · quadrupeds','Animal sit','An object sits.',2),
 preset('animal-look','Animals · quadrupeds','Look left','An object looks left.',2)
]);
export function normalizePrompt(value,{allowEmpty=false}={}){
 requireValue(value&&typeof value==='object'&&!Array.isArray(value),'Choose a valid prompt recipe.');
 const string=(key,max)=>{requireValue(typeof value[key]==='string'&&value[key].length<=max,`Prompt ${key} must be at most ${max} characters.`);return value[key];};
 const name=string('name',80),prompt=string('prompt',2000),actionName=value.actionName===undefined?name:string('actionName',120);
 requireValue(!/[\u0000-\u001f\u007f]/u.test(name)&&!/[\u0000-\u001f\u007f]/u.test(actionName),'Prompt and action names cannot contain control characters or line breaks.');
 requireValue(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(prompt),'The movement description contains unsupported control characters.');
 requireValue(allowEmpty||name.trim(),'Give this saved prompt a name.');
 requireValue(allowEmpty||prompt.trim(),'Write an action description first.');
 requireValue(Number.isFinite(value.durationSeconds)&&value.durationSeconds>=.5&&value.durationSeconds<=60,'Choose a duration from 0.5 to 60 seconds.');
 requireValue(Number.isInteger(value.seed)&&value.seed>=0&&value.seed<=2147483647,'Use a whole seed from 0 to 2147483647.');
 return {name,prompt,actionName,durationSeconds:value.durationSeconds,seed:value.seed};
}
const defaultDraft=()=>({...ACTION_PROMPTS[0],actionName:'Walk forward',name:'Walk forward'});
const id=()=> 'prompt-'+crypto.randomUUID();
const empty=()=>({format:'capp.action-prompts',version:1,entries:[],draft:normalizePrompt(defaultDraft()),selected:'preset:human-walk'});
export function parsePromptLibrary(raw){
 requireValue(typeof raw==='string'&&new TextEncoder().encode(raw).length<=PROMPT_LIMITS.bytes,'Prompt libraries must be smaller than 256 KiB.');
 const value=JSON.parse(raw);
 requireValue(value?.format==='capp.action-prompts'&&value.version===1&&Array.isArray(value.entries)&&value.entries.length<=48,'Choose an Action Lab prompt library with at most 48 prompts.');
 const seen=new Set(),names=new Set();
 const entries=value.entries.map(entry=>{requireValue(typeof entry.id==='string'&&/^prompt-[a-zA-Z0-9-]{1,80}$/.test(entry.id)&&!seen.has(entry.id),'Saved prompt identifiers must be valid and unique.');seen.add(entry.id);const item=normalizePrompt(entry),name=item.name.trim().toLowerCase();requireValue(!names.has(name),'Saved prompt names must be unique.');names.add(name);return {id:entry.id,...item};});
 const draft=value.draft?normalizePrompt(value.draft,{allowEmpty:true}):normalizePrompt(defaultDraft());
 const selected=typeof value.selected==='string'&&value.selected.length<150?value.selected:'';
 return {format:value.format,version:1,entries,draft,selected};
}
export class PromptLibrary{
 constructor(storage){this.storage=storage;this.state=empty();this.error='';this.blocked=false;if(!storage)this.error='Local prompt storage is unavailable. Export the library to keep your prompts.';try{const raw=storage?.getItem(PROMPT_STORAGE_KEY);if(raw)this.state=parsePromptLibrary(raw);}catch(error){this.blocked=true;this.error='Saved prompts could not be read. Existing storage was preserved. '+error.message;}}
 write(next){requireValue(!this.blocked,this.error);const raw=JSON.stringify(next);parsePromptLibrary(raw);requireValue(this.storage,'Local prompt storage is unavailable. Export the library to keep your prompts.');try{this.storage.setItem(PROMPT_STORAGE_KEY,raw);}catch{throw new Error('Prompt storage is full or unavailable. Your previous saved prompts are unchanged. Export the library to keep this draft.');}this.state=next;this.error='';}
 draft(value,selected=this.state.selected){const draft=normalizePrompt(value,{allowEmpty:true}),next={...this.state,draft,selected};try{this.write(next);return true;}catch(error){this.state=next;this.error=error.message;return false;}}
 save(value,existingId=null){const normalized=normalizePrompt(value),entries=this.state.entries.map(v=>({...v})),index=existingId?entries.findIndex(v=>v.id===existingId):-1;requireValue(!existingId||index>=0,'Choose a saved prompt to update.');requireValue(!entries.some((v,i)=>i!==index&&v.name.trim().toLowerCase()===normalized.name.trim().toLowerCase()),'That prompt name already exists. Choose a different name or Update saved.');const entry={id:existingId||id(),...normalized};if(index>=0)entries[index]=entry;else{requireValue(entries.length<48,'The prompt library holds 48 prompts. Delete one or export a backup first.');entries.push(entry);}this.write({...this.state,entries,draft:normalized,selected:'saved:'+entry.id});return entry;}
 duplicate(value){const draft=normalizePrompt(value),names=new Set(this.state.entries.map(v=>v.name.trim().toLowerCase()));let name=draft.name.slice(0,70)+' copy',n=2;while(names.has(name.toLowerCase()))name=draft.name.slice(0,65)+' copy '+n++;return this.save({...draft,name});}
 remove(id){requireValue(this.state.entries.some(v=>v.id===id),'Choose a saved prompt to delete.');this.write({...this.state,entries:this.state.entries.filter(v=>v.id!==id),selected:''});}
 export(){return JSON.stringify(this.state,null,2);}
 import(raw){const incoming=parsePromptLibrary(raw),entries=this.state.entries.map(v=>({...v})),names=new Set(entries.map(v=>v.name.trim().toLowerCase()));let added=0;for(const source of incoming.entries){if(entries.some(v=>v.id===source.id&&JSON.stringify(v)===JSON.stringify(source)))continue;let name=source.name,n=2;while(names.has(name.trim().toLowerCase()))name=source.name.slice(0,68)+' imported '+n++;names.add(name.toLowerCase());entries.push({...source,id:id(),name});added++;}requireValue(entries.length<=48,'Import would exceed 48 saved prompts. Nothing was changed.');this.write({...this.state,entries});return added;}
}
