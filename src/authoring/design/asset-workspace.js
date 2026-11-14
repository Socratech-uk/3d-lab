/** Pure UI-side document identity. Names, downloads, draft recovery and project
 * paths are separate; this module never reads/writes a model by itself. */
import {validSolProjectFilename as validModelFilename,validSolProjectDirectory as validModelDirectory} from '../src/model-format/sol-project-file.js?v=1.1.0';
export {validModelFilename,validModelDirectory};
export const DESIGNER_WORKSPACE_PROTOCOL='sol.designer-workspace.v1';
export function workspaceAssets(workspace){
 if(workspace?.protocol!==DESIGNER_WORKSPACE_PROTOCOL||!Array.isArray(workspace.assets))throw Error('Designer workspace contract unavailable');
 return workspace.assets.filter(a=>a&&typeof a.assetId==='string'&&validModelFilename(a.filename)&&validModelDirectory(a.directory===undefined?'':a.directory)&&a.path===`assets/models/user/${a.directory?a.directory+'/':''}${a.filename}`&&/^[a-f0-9]{64}$/i.test(a.sha256));
}
export function projectSource(asset){return {type:'project',assetId:asset.assetId,path:asset.path,filename:asset.filename,directory:asset.directory||'',sha256:asset.sha256,name:asset.name};}
export function destinationFor(source,filename,assets=[],options={}){
 if(!validModelFilename(filename))throw Error('Use a basename ending in .solmodel.json; folders and traversal are not accepted.');
 const directory=options.directory??source?.directory??'';
 if(!validModelDirectory(directory))throw Error('Choose the project root or a safe folder under components/.');
 const relative=`${directory?directory+'/':''}${filename}`,path=`assets/models/user/${relative}`;
 if(assets.some(a=>a.path!==path&&a.path?.toLowerCase()===path.toLowerCase()))throw Error('Choose the exact existing folder and filename; names differing only in case conflict on Windows.');
 // Directory aliases conflict even before a file with this basename exists.
 const segments=directory.split('/');
 if(assets.some(a=>{const authored=(a.directory||'').split('/');return segments.some((part,index)=>{if(index>=authored.length)return false;const requested=segments.slice(0,index+1).join('/'),existing=authored.slice(0,index+1).join('/');return requested!==existing&&requested.toLowerCase()===existing.toLowerCase();});}))throw Error('Choose the exact existing folder; names differing only in case conflict on Windows.');
 const existing=assets.find(a=>a.path===path),same=source?.type==='project'&&source.filename===filename&&(source.directory||'')===directory;
 if(same&&!/^[a-f0-9]{64}$/i.test(source.sha256||''))throw Error('The loaded file has no verified identity. Recheck the workspace and reopen it before replacing it.');
 return {filename,directory,assetId:`project:${relative}`,expectedSha256:same?source.sha256:existing?.sha256||'absent',existing,same,overwrite:!!existing&&!same,path};
}
export function currentDefaultFilename(workspace,slot){
 const assigned=workspace?.defaultFiles?.[slot];
 if(assigned&&validModelFilename(assigned))return assigned;
 const id=workspace?.defaults?.[slot];
 return workspace?.assets?.find(a=>a.assetId===id)?.filename||'none';
}
export function groupedAssets(workspace){
 const assets=workspaceAssets(workspace),defaults=new Set(Object.values(workspace.defaults||{}));
 return {defaults:assets.filter(a=>defaults.has(a.assetId)),project:assets.filter(a=>!defaults.has(a.assetId))};
}
export const PLAYER_SHIP_SELECTION_PREFIX='player-ship:';
export function playerShipSelectionId(id){return PLAYER_SHIP_SELECTION_PREFIX+id;}
export function playerShipSource(ship,projectRoot=''){
 return {type:'player-ship-capture',assetId:playerShipSelectionId(ship.id),playerShipId:ship.id,name:ship.name||ship.label,filename:ship.suggestedFilename,projectRoot};
}
export function playerShipForDocument(document,ships=[]){
 const id=document?.meta?.parameters?.playerShip?.id;
 return ships.find(ship=>ship.id===id)||null;
}
/** Runtime captures are choices in the same editor, even if the project service
 * is unavailable. Project assignments remain independently authored metadata. */
export function workspaceModelGroups(workspace,ships=[]){
 const groups=workspace?groupedAssets(workspace):{defaults:[],project:[]};
 return {ships:ships.map(ship=>({...ship,assetId:playerShipSelectionId(ship.id)})),...groups};
}
/** Restore only an explicit choice or opened project identity. Browser draft
 * contents remain behind the separate Recover action. A fresh visit opens the
 * actual Kestrel assembly rather than a similarly named weapon or fleet ship. */
export function startupModelSelection(workspace,ships=[],lastOpened=null,recoverySource=null){
 const groups=workspaceModelGroups(workspace,ships),valid=new Set([...groups.ships,...groups.defaults,...groups.project].map(asset=>asset.assetId));
 if(lastOpened?.root===workspace?.root&&valid.has(lastOpened.selectionId))return lastOpened.selectionId;
 if(recoverySource?.type==='project'&&(!recoverySource.projectRoot||recoverySource.projectRoot===workspace?.root)&&valid.has(recoverySource.assetId))return recoverySource.assetId;
 return groups.ships[0]?.assetId||workspace?.defaults?.player||groups.defaults[0]?.assetId||groups.project[0]?.assetId||'';
}
export function sourceLabel(source){
 if(source?.type==='joined-copy')return `Joined object copy · unsaved · from ${source.originalSource||source.name}`;
 if(source?.type==='project')return `${source.recovered?'Recovered draft of project file':'Project file'} · ${source.path}`;
 if(source?.type==='draft')return 'Recovered browser draft · save a project file to use it in the game';
 if(source?.type==='inspection')return `Game assembly inspection · ${source.name||source.assetId||'procedural asset'}`;
 if(source?.type==='player-ship-capture')return `${source.recovered?'Recovered editable player hull draft':'Editable player hull'} · ${source.name} · new capture, not yet a project file`;
 if(source?.type==='ship-component-capture')return `${source.recovered?'Recovered source object draft':'Editable source object'} · ${source.shipName} · ${source.name} · Save creates an independent file`;
 if(source?.type==='generator')return `Native generator capture · ${source.name||source.registryId||'model'}`;
 if(source?.type==='import')return `Imported file · ${source.name||'model'} · choose a project destination`;
 return 'New document · choose a project destination';
}
