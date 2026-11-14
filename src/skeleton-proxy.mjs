import {meshes} from './action-geometry.mjs';
import {PROXY_LIMITS} from './skeleton-proxy-kernel.mjs';
const abort=signal=>{if(signal?.aborted)throw new Error('Generation cancelled.');};
const yieldUI=()=>new Promise(resolve=>setTimeout(resolve,0));
export async function prepareSkeletonMesh(base,{signal,progress=()=>{}}={}) {
 const parts=meshes(base),before={vertices:0,triangles:0};
 for(const m of parts){const p=m.geometry?.attributes.position;if(!p||p.itemSize!==3)throw new Error('The mesh has invalid XYZ positions.');before.vertices+=p.count;before.triangles+=(m.geometry.index?.count??p.count)/3;}
 if(before.vertices<3||!Number.isInteger(before.vertices)||!Number.isInteger(before.triangles)||before.triangles<1)throw new Error('Choose a mesh with complete triangles.');
 abort(signal);
 const large=before.vertices>PROXY_LIMITS.vertices||before.triangles>PROXY_LIMITS.triangles;
 progress(large?'Preparing a simplified prediction copy. Your detailed model, weights and actions are retained.':'Preparing the mesh for skeleton prediction…',{stage:'proxy',fraction:0});
 await yieldUI();abort(signal);
 const positions=new Float32Array(before.vertices*3),indices=new Uint32Array(before.triangles*3);let v=0,t=0;
 for(const m of parts){const p=m.geometry.attributes.position,index=m.geometry.index,start=v;
  for(let i=0;i<p.count;i++){for(let c=0;c<3;c++){const n=p[['getX','getY','getZ'][c]](i);if(!Number.isFinite(n)||Math.abs(n)>1e6)throw new Error('The mesh contains invalid coordinates.');positions[v*3+c]=n;}v++;if(i%16384===0){await yieldUI();abort(signal);}}
  for(let i=0;i<(index?.count??p.count);i++){const n=index?index.getX(i):i;if(!Number.isInteger(n)||n<0||n>=p.count)throw new Error('The mesh contains invalid triangle indices.');indices[t++]=start+n;if(i%49152===0){await yieldUI();abort(signal);}}
 }
 if(!large)return {mesh:{positions:Array.from(positions),indices:Array.from(indices)},preparation:{before,after:before,simplified:false}};
 // The build bundles a standalone local worker into the single-file app. Native
 // module tests can exercise the kernel directly; there is no synchronous UI fallback.
 const {default:source}=await import('./skeleton-proxy-worker.mjs?worker-inline');abort(signal);
 return new Promise((resolve,reject)=>{
  let worker,url,timer;
  const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);if(worker){worker.onmessage=null;worker.onerror=null;worker.terminate();}if(url)URL.revokeObjectURL(url);};
  const fail=error=>{cleanup();reject(error);};
  const cancel=()=>fail(new Error('Generation cancelled.'));
  try{
   url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));worker=new Worker(url);
   signal?.addEventListener('abort',cancel,{once:true});
   worker.onmessage=({data})=>{if(data.progress)progress(data.progress.message,{...data.progress,stage:'proxy'});else if(data.error)fail(new Error(data.error));else if(data.result){cleanup();resolve(data.result);}};
   worker.onerror=e=>fail(new Error('Prediction preparation failed: '+(e.message||'worker unavailable')+'. Your detailed model is unchanged.'));
   timer=setTimeout(()=>fail(new Error('Prediction preparation took too long. Your model is unchanged; reduce a copy in Builder and try again.')),120000);
   worker.postMessage({positions,indices},[positions.buffer,indices.buffer]);
  }catch(error){fail(error);}
 });
}
