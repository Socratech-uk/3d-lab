/** Portable, bounded Shape Lab recipes. Imported data is never executable. */
import {createDefaultShapeRecipe, normalizeShapeRecipe, SHAPE_PRESETS} from './authoring/src/model-format/sol-shape-profile.js';
export const SHAPE_DOCUMENT_FORMAT = 'capp.shape-lab';
export const SHAPE_DOCUMENT_VERSION = 1;
export const SHAPE_PART_TYPES = Object.freeze(['profile', 'extrude', 'revolve']);
export const MAX_SHAPE_DOCUMENT_BYTES = 2 * 1024 * 1024;
export const SKETCH_PRESETS = Object.freeze([
  {id:'rectangle',name:'Rectangle'}, {id:'circle',name:'Circle'}, {id:'star',name:'Star'},
  {id:'arch',name:'Arch'}, {id:'vessel',name:'Vessel profile'}
]);
const ownObject = (v, name) => {if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`${name} must be an object.`); return v;};
const bounded = (v, fallback, low, high, name, integer=false) => {const n = v === undefined ? fallback : v; if(typeof n !== 'number' || !Number.isFinite(n) || n<low || n>high || (integer && !Number.isInteger(n))) throw new Error(`${name} must be ${integer?'an integer':'a finite number'} between ${low} and ${high}.`); return n;};
const label = (v, fallback, max, name) => {const s=v===undefined?fallback:v;if(typeof s!=='string'||!s.trim()||s.length>max||/[\u0000-\u001f]/.test(s))throw new Error(`${name} must be readable text of 1–${max} characters.`);return s.trim();};
const flag=(v,fallback,name)=>{if(v===undefined)return fallback;if(typeof v!=='boolean')throw new Error(`${name} must be true or false.`);return v;};
const newId=()=>`shape-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
const vec=(v,fallback,name,low,high)=>{if(v===undefined)return [...fallback];if(!Array.isArray(v)||v.length!==3)throw new Error(`${name} requires three numbers.`);return v.map(n=>bounded(n,0,low,high,name));};
const area=points=>points.reduce((sum,p,i)=>{const q=points[(i+1)%points.length];return sum+p.x*q.y-q.x*p.y;},0)/2;
const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
const on=(a,b,p,e)=>Math.abs(cross(a,b,p))<=e&&p.x>=Math.min(a.x,b.x)-e&&p.x<=Math.max(a.x,b.x)+e&&p.y>=Math.min(a.y,b.y)-e&&p.y<=Math.max(a.y,b.y)+e;
function intersects(a,b,c,d,e){const x=cross(a,b,c),y=cross(a,b,d),z=cross(c,d,a),w=cross(c,d,b);return ((x>e&&y< -e||x< -e&&y>e)&&(z>e&&w< -e||z< -e&&w>e))||on(a,b,c,e)||on(a,b,d,e)||on(c,d,a,e)||on(c,d,b,e);}
/** Sketches are simple closed contours. A revolve contour uses X as radius. */
export function normalizeShapeSketch(input, type='extrude') {
  ownObject(input,'Sketch'); if(input.closed!==undefined&&input.closed!==true)throw new Error('Close the sketch before building a solid.');
  if(!Array.isArray(input.points)||input.points.length<3||input.points.length>128)throw new Error('Use 3–128 sketch points.');
  const points=input.points.map(p=>{ownObject(p,'Sketch point');return {x:bounded(p.x,NaN,type==='revolve'?0:-1000,1000,type==='revolve'?'Radius':'Point X'),y:bounded(p.y,NaN,-1000,1000,'Point Y')};});
  // Files may repeat the closing corner; store it once so edits have one handle.
  if(points.length>3&&points[0].x===points.at(-1).x&&points[0].y===points.at(-1).y)points.pop();
  const span=Math.max(...points.map(p=>p.x))-Math.min(...points.map(p=>p.x))+Math.max(...points.map(p=>p.y))-Math.min(...points.map(p=>p.y)), eps=Math.max(1,span*span)*1e-12;
  for(let i=0;i<points.length;i++){
    const a=points[i],b=points[(i+1)%points.length];if(Math.hypot(a.x-b.x,a.y-b.y)<1e-7)throw new Error('Separate adjacent sketch points.');
    for(let j=i+1;j<points.length;j++){if(j===i+1||(i===0&&j===points.length-1))continue;if(intersects(a,b,points[j],points[(j+1)%points.length],eps))throw new Error('The sketch crosses or touches itself. Move the overlapping points.');}
  }
  if(Math.abs(area(points))<=eps)throw new Error('The sketch needs a nonzero enclosed area.');
  if(type==='revolve'&&Math.max(...points.map(p=>p.x))<1e-4)throw new Error('A revolved shape needs some radius away from the axis.');
  // Preserve handle order and orientation; geometry chooses winding itself.
  return {points,closed:true};
}
export function createSketchPreset(preset='rectangle') {
  let points;
  if(preset==='circle')points=Array.from({length:32},(_,i)=>({x:Math.cos(i/32*Math.PI*2),y:Math.sin(i/32*Math.PI*2)}));
  else if(preset==='star')points=Array.from({length:10},(_,i)=>({x:Math.cos(i/10*Math.PI*2-Math.PI/2)*(i%2?.45:1),y:Math.sin(i/10*Math.PI*2-Math.PI/2)*(i%2?.45:1)}));
  else if(preset==='arch')points=[{x:-1,y:-1},{x:1,y:-1},...Array.from({length:17},(_,i)=>({x:Math.cos(i/16*Math.PI),y:Math.sin(i/16*Math.PI)}))];
  else if(preset==='vessel')points=[{x:0,y:-1},{x:.65,y:-1},{x:.9,y:-.7},{x:.7,y:.3},{x:.45,y:.8},{x:.5,y:1},{x:0,y:1}];
  else if(preset==='rectangle')points=[{x:-1,y:-.7},{x:1,y:-.7},{x:1,y:.7},{x:-1,y:.7}];
  else throw new Error('Choose a rectangle, circle, star, arch or vessel sketch.');
  return {points,closed:true};
}
export function createShapePart(type='profile', preset=type==='profile'?'hull':type==='revolve'?'vessel':'rectangle') {
  if(!SHAPE_PART_TYPES.includes(type))throw new Error('Unknown Shape Lab part type.');
  const names={profile:SHAPE_PRESETS.find(p=>p.id===preset)?.name||'Streamlined hull',extrude:'Extruded sketch',revolve:'Revolved sketch'};
  return normalizeShapePart({id:newId(),name:names[type],type,profile:type==='profile'?createDefaultShapeRecipe(preset):undefined,sketch:type==='profile'?undefined:createSketchPreset(type==='revolve'&&preset==='hull'?'vessel':preset)});
}
export function normalizeShapePart(input) {
  ownObject(input,'Shape part'); const type=input.type??'profile';if(!SHAPE_PART_TYPES.includes(type))throw new Error('Choose profile, extrude or revolve.');
  const id=label(input.id,newId(),80,'Part ID');if(!/^[A-Za-z0-9_-]+$/.test(id))throw new Error('Part IDs may contain letters, digits, underscores and hyphens.');
  const transform=ownObject(input.transform??{},'Transform'),scale=vec(transform.scale,[1,1,1],'Scale',-1000,1000);if(scale.some(n=>Math.abs(n)<.001))throw new Error('Each scale magnitude must be at least 0.001.');
  const color=input.color??'#8bb8c9';if(typeof color!=='string'||!/^#[0-9a-f]{6}$/i.test(color))throw new Error('Colour must be a six-digit hexadecimal colour.');
  const params=ownObject(input.params??{},'Shape parameters');
  const out={id,name:label(input.name,'Shape',120,'Part name'),type,visible:flag(input.visible,true,'Visibility'),locked:flag(input.locked,false,'Lock'),color:color.toLowerCase(),transform:{position:vec(transform.position,[0,0,0],'Position',-100000,100000),rotation:vec(transform.rotation,[0,0,0],'Rotation',-36000,36000),scale},params:{depth:bounded(params.depth,1,.01,1000,'Extrusion depth'),bevel:bounded(params.bevel,0,0,100,'Bevel'),bevelSegments:bounded(params.bevelSegments,2,1,8,'Bevel segments',true),taper:bounded(params.taper,1,.05,20,'Taper'),twist:bounded(params.twist,0,-720,720,'Twist'),segments:bounded(params.segments,32,type==='revolve'?8:1,128,'Segments',true),angle:bounded(params.angle,360,360,360,'Revolve angle')}};
  if(type==='profile')out.profile=normalizeShapeRecipe(input.profile??createDefaultShapeRecipe());
  else {out.sketch=normalizeShapeSketch(input.sketch??createSketchPreset(type==='revolve'?'vessel':'rectangle'),type);if(type==='extrude'&&out.params.bevel>0){const p=out.sketch.points,w=Math.max(...p.map(v=>v.x))-Math.min(...p.map(v=>v.x)),h=Math.max(...p.map(v=>v.y))-Math.min(...p.map(v=>v.y));if(out.params.bevel>Math.min(out.params.depth/2,w/4,h/4))throw new Error('Bevel must fit within half the depth and a quarter of the sketch width and height.');}}
  return out;
}
export function normalizeShapeDocument(input) {
  ownObject(input,'Shape document');if(input.format!==undefined&&input.format!==SHAPE_DOCUMENT_FORMAT)throw new Error('This file is not a Shape Lab recipe.');if(input.version!==undefined&&input.version!==SHAPE_DOCUMENT_VERSION)throw new Error('Unsupported Shape Lab recipe version.');
  if(!Array.isArray(input.parts)||input.parts.length<1||input.parts.length>64)throw new Error('A Shape Lab scene needs 1–64 parts.');
  const parts=input.parts.map(normalizeShapePart),ids=new Set();for(const p of parts){if(ids.has(p.id))throw new Error('Every Shape Lab part needs a unique ID.');ids.add(p.id);}
  const out={format:SHAPE_DOCUMENT_FORMAT,version:SHAPE_DOCUMENT_VERSION,title:label(input.title,'Untitled shape',160,'Document title'),parts};
  if(new TextEncoder().encode(JSON.stringify(out)).byteLength>MAX_SHAPE_DOCUMENT_BYTES)throw new Error('Shape Lab recipes must fit within 2 MiB.');return out;
}
export function createShapeDocument(options={}) {ownObject(options,'Shape document options');return normalizeShapeDocument({format:SHAPE_DOCUMENT_FORMAT,version:1,title:options.title??'Untitled shape',parts:options.parts??[createShapePart()]});}
export function cloneShapeDocument(input){return normalizeShapeDocument(input);}
export function parseShapeDocumentJSON(text){if(typeof text!=='string'||new TextEncoder().encode(text).byteLength>MAX_SHAPE_DOCUMENT_BYTES)throw new Error('Choose a Shape Lab JSON recipe no larger than 2 MiB.');let input;try{input=JSON.parse(text);}catch{throw new Error('The file is not valid JSON.');}return normalizeShapeDocument(input);}
export function stringifyShapeDocument(input){return JSON.stringify(normalizeShapeDocument(input),null,2)+'\n';}
