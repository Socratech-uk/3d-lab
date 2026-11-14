/** Editable, bounded cross-section recipes for Shape Studio. No executable expressions. */
export const SHAPE_PROFILE_VERSION = 1;
export const SHAPE_PRESETS = Object.freeze([
  { id: 'hull', name: 'Streamlined hull', description: 'A full body with a drawn-out, pointed nose.' },
  { id: 'wing', name: 'Wing / blade', description: 'A slim foil with a rounded leading edge.' },
  { id: 'fin', name: 'Swept fin', description: 'An upright, swept profile for fins and supports.' },
  { id: 'canopy', name: 'Canopy', description: 'An arched upper surface above a low base.' },
  { id: 'panel', name: 'Panel', description: 'A broad, softly squared panel with blunt ends.' },
  { id: 'stand', name: 'Stand / strut', description: 'A waisted support with broad mounting ends.' },
]);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const number = (x, fallback) => Number.isFinite(Number(x)) ? Number(x) : fallback;
const extent = x => clamp(number(x, 0), 0, 4);
export const SHAPE_POINT_CHANNELS = Object.freeze(['upper','lower','far','near']);
const pairChannels = {outline:['upper','lower'],depth:['far','near']};
const pointPair = channel => channel === 'upper' || channel === 'lower' ? 'outline' : 'depth';
const stationPoint = (s, channel) => s.points?.[channel] || {t:s.t,reach:s[channel === 'far' || channel === 'near' ? 'depth' : channel]};
const makeStations = rows => rows.map(([t, upper, lower, depth]) => ({ t, upper, lower, depth }));
export function createDefaultShapeRecipe(preset = 'hull') {
  const rows = {
    hull: [[0,0,0,0],[.12,.65,.45,.65],[.3,1,.8,1],[.55,.95,.78,1],[.8,.65,.5,.8],[.94,.28,.18,.38],[1,0,0,0]],
    wing: [[0,0,0,0],[.08,.65,.45,.8],[.25,1,.65,1],[.5,.75,.4,.8],[.75,.35,.18,.45],[1,0,0,0]],
    fin: [[0,0,0,0],[.15,.2,.08,.55],[.4,.65,.12,1],[.72,1,.12,.9],[.92,.8,.08,.45],[1,0,0,0]],
    canopy: [[0,.04,.06,.25],[.15,.7,.1,.75],[.38,1,.1,1],[.64,.9,.1,.95],[.85,.48,.08,.65],[1,0,0,0]],
    panel: [[0,.8,.8,.8],[.1,1,1,1],[.5,1,1,1],[.9,1,1,1],[1,.8,.8,.8]],
    stand: [[0,1,1,1],[.12,1,1,1],[.28,.45,.45,.5],[.5,.35,.35,.4],[.72,.45,.45,.5],[.88,1,1,1],[1,1,1,1]],
  };
  if (!rows[preset]) preset = 'hull';
  const sizes = { hull:[4,1.4,1.6], wing:[4,.35,2], fin:[3,2,.25], canopy:[3,1.5,1.4], panel:[3,.2,2], stand:[2,.5,.5] };
  const [length,height,depth] = sizes[preset];
  return { version:1, preset, length, height, depth, smoothness:.85, roundness:preset === 'panel' ? .25 : .8,
    segments:48, radialSegments:24, stations:makeStations(rows[preset]), formula:null };
}
export function normalizeShapeRecipe(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Shape recipe must be an object.');
  if (input.version !== undefined && input.version !== SHAPE_PROFILE_VERSION) throw new Error('Unsupported shape profile version.');
  if (input.preset !== undefined && !SHAPE_PRESETS.some(p => p.id === input.preset)) throw new Error('Unknown shape preset.');
  const base = createDefaultShapeRecipe(input.preset);
  const bounded = (value, lo, hi, name, fallback, integer = false) => {
    if (value === undefined) return fallback;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < lo || value > hi || (integer && !Number.isInteger(value)))
      throw new Error(`${name} must be ${integer ? 'an integer' : 'a finite number'} between ${lo} and ${hi}.`);
    return value;
  };
  const sourceStations = input.stations === undefined ? base.stations : input.stations;
  if (!Array.isArray(sourceStations) || sourceStations.length < 3 || sourceStations.length > 33) throw new Error('Use between 3 and 33 profile handles.');
  const stations = sourceStations.map((s, index) => {
    if (!s || typeof s !== 'object' || Array.isArray(s)) throw new Error('Each profile handle must be an object.');
    for (const field of ['t', 'upper', 'lower', 'depth']) if (s[field] === undefined) throw new Error(`Profile handle ${index + 1} is missing ${field}.`);
    const out={t:bounded(s.t,0,1,'Handle position'),upper:bounded(s.upper,0,4,'Upper edge'),lower:bounded(s.lower,0,4,'Lower edge'),depth:bounded(s.depth,0,4,'Depth edge')};
    if(s.points !== undefined){
      if(!s.points || typeof s.points !== 'object' || Array.isArray(s.points) || Object.keys(s.points).some(c=>!SHAPE_POINT_CHANNELS.includes(c)))throw new Error('Invalid independent profile points.');
      out.points={};for(const channel of SHAPE_POINT_CHANNELS)if(s.points[channel] !== undefined){const p=s.points[channel];if(!p||typeof p !== 'object'||Array.isArray(p)||p.t===undefined||p.reach===undefined)throw new Error('Each independent point needs position and reach.');out.points[channel]={t:bounded(p.t,0,1,'Point position'),reach:bounded(p.reach,0,4,'Point reach')};}
    }
    if(s.links !== undefined){if(!s.links||typeof s.links !== 'object'||Array.isArray(s.links)||Object.keys(s.links).some(c=>!Object.hasOwn(pairChannels,c)))throw new Error('Invalid point links.');out.links={};for(const pair of Object.keys(pairChannels))if(s.links[pair]!==undefined){if(typeof s.links[pair]!=='boolean')throw new Error('Point links must be true or false.');out.links[pair]=s.links[pair];}}
    return out;
  });
  if (stations[0].t !== 0 || stations.at(-1).t !== 1) throw new Error('The first and last profile handles must stay at 0 and 1.');
  for (let index=1; index<stations.length; index++) {
    if (stations[index].t-stations[index-1].t < .002-1e-12) throw new Error('Keep profile handles in order, at least 0.002 apart.');
    if (index < stations.length-1 && (stations[index].upper+stations[index].lower < .001 || stations[index].depth < .001))
      throw new Error('Interior handles need nonzero height and depth; pointed ends belong at the first or last handle.');
  }
  for(const channel of SHAPE_POINT_CHANNELS)for(let index=1;index<stations.length;index++)if(stationPoint(stations[index],channel).t-stationPoint(stations[index-1],channel).t<.002-1e-12)throw new Error('Keep each edge’s points in order, at least 0.002 apart.');
  for(let index=1;index<stations.length-1;index++)if(stationPoint(stations[index],'upper').reach+stationPoint(stations[index],'lower').reach<.001-1e-12||stationPoint(stations[index],'far').reach+stationPoint(stations[index],'near').reach<.002-1e-12)throw new Error('Interior points need nonzero height and depth.');
  let formula = null;
  if (input.formula !== undefined && input.formula !== null) {
    const f = input.formula;
    if (typeof f !== 'object' || Array.isArray(f) || typeof f.expression !== 'string' || !['upper','lower','depth','symmetric'].includes(f.channel)) throw new Error('Invalid formula metadata.');
    const samples=bounded(f.samples,3,33,'Formula sample count',undefined,true);
    if (samples === undefined) throw new Error('Formula metadata needs a sample count.');
    const calculate=compileShapeFormula(f.expression);
    for (let i=0;i<=1024;i++) { const value=calculate(i/1024); if(value< -1e-10||value>4+1e-10) throw new Error('Formula values must stay between 0 and 4.'); }
    formula={expression:f.expression,channel:f.channel,samples};
  }
  const radialSegments=bounded(input.radialSegments,8,48,'Cross-section resolution',base.radialSegments,true);
  if (radialSegments % 4 !== 0) throw new Error('Cross-section resolution must be a multiple of 4.');
  return {version:1,preset:base.preset,length:bounded(input.length,.02,1000,'Length',base.length),height:bounded(input.height,.02,1000,'Height',base.height),depth:bounded(input.depth,.02,1000,'Depth',base.depth),smoothness:bounded(input.smoothness,0,1,'Smoothness',base.smoothness),roundness:bounded(input.roundness,0,1,'Roundness',base.roundness),segments:bounded(input.segments,8,128,'Length resolution',base.segments,true),radialSegments,stations,formula};
}
function channelInterpolator(stations, channel, smoothness) {
  const n=stations.length, h=[], delta=[], slope=[];
  for(let i=0;i<n-1;i++){h[i]=stations[i+1].t-stations[i].t;delta[i]=(stations[i+1][channel]-stations[i][channel])/h[i];}
  const end=(h0,h1,d0,d1)=>{ let m=((2*h0+h1)*d0-h0*d1)/(h0+h1);if(Math.sign(m)!==Math.sign(d0))m=0;else if(Math.sign(d0)!==Math.sign(d1)&&Math.abs(m)>Math.abs(3*d0))m=3*d0;return m;};
  slope[0]=end(h[0],h[1],delta[0],delta[1]);slope[n-1]=end(h[n-2],h[n-3],delta[n-2],delta[n-3]);
  for(let i=1;i<n-1;i++){ if(delta[i-1]*delta[i]<=0)slope[i]=0;else{const w1=2*h[i]+h[i-1],w2=h[i]+2*h[i-1];slope[i]=(w1+w2)/(w1/delta[i-1]+w2/delta[i]);} }
  return t=>{ let i=0;while(i<n-2&&t>stations[i+1].t)i++; const u=clamp((t-stations[i].t)/h[i],0,1),a=stations[i][channel],b=stations[i+1][channel],u2=u*u,u3=u2*u;
    const linear=a+(b-a)*u,curved=(2*u3-3*u2+1)*a+(u3-2*u2+u)*h[i]*slope[i]+(-2*u3+3*u2)*b+(u3-u2)*h[i]*slope[i+1];
    return clamp(linear+(curved-linear)*smoothness,Math.min(a,b),Math.max(a,b)); };
}
function samplers(recipe){const rows=recipe.stations.map(s=>({...s,upper:stationPoint(s,'upper').reach,lower:stationPoint(s,'lower').reach,depth:(stationPoint(s,'far').reach+stationPoint(s,'near').reach)/2}));return Object.fromEntries(['upper','lower','depth'].map(c=>[c,channelInterpolator(rows,c,recipe.smoothness)]));}
export function sampleShapeProfile(input,t){if(typeof t!=='number'||!Number.isFinite(t)||t<0||t>1)throw new Error('Profile position must be a finite number between 0 and 1.');const recipe=normalizeShapeRecipe(input),f=samplers(recipe);return {t,upper:f.upper(t),lower:f.lower(t),depth:f.depth(t)};}
export const sampleProfile=sampleShapeProfile;

function pointSamplers(recipe){return Object.fromEntries(SHAPE_POINT_CHANNELS.map(channel=>{const rows=recipe.stations.map(s=>({t:s.t,x:stationPoint(s,channel).t,reach:stationPoint(s,channel).reach}));return [channel,{t:channelInterpolator(rows,'x',recipe.smoothness),reach:channelInterpolator(rows,'reach',recipe.smoothness)}];}));}
/** u is the section parameter; each returned point owns its actual length position. */
export function sampleShapePoints(input,u){if(typeof u!=='number'||!Number.isFinite(u)||u<0||u>1)throw new Error('Profile position must be between 0 and 1.');const f=pointSamplers(normalizeShapeRecipe(input));return Object.fromEntries(SHAPE_POINT_CHANNELS.map(c=>[c,{t:f[c].t(u),reach:f[c].reach(u)}]));}
function checkedIndex(recipe,index){if(!Number.isInteger(index)||index<0||index>=recipe.stations.length)throw new Error('Choose a valid profile station.');}
function checkedChannel(channel){if(!SHAPE_POINT_CHANNELS.includes(channel))throw new Error('Choose an upper, lower, far or near point.');}
function checkedPair(pair){if(!Object.hasOwn(pairChannels,pair))throw new Error('Choose outline or depth links.');}
export function getShapePoint(input,index,channel){const recipe=normalizeShapeRecipe(input);checkedIndex(recipe,index);checkedChannel(channel);return {...stationPoint(recipe.stations[index],channel)};}
export function getShapePairLinked(input,index,pair){const recipe=normalizeShapeRecipe(input);checkedIndex(recipe,index);checkedPair(pair);return recipe.stations[index].links?.[pair]!==false;}
export function setShapePairLinked(input,index,pair,linked){const recipe=normalizeShapeRecipe(input);checkedIndex(recipe,index);checkedPair(pair);if(typeof linked!=='boolean')throw new Error('Linked state must be true or false.');const s=recipe.stations[index];s.links={...s.links,[pair]:linked};return normalizeShapeRecipe(recipe);}
export function setAllShapePairsLinked(input,linked){const recipe=normalizeShapeRecipe(input);if(typeof linked!=='boolean')throw new Error('Linked state must be true or false.');for(const s of recipe.stations)s.links={outline:linked,depth:linked};return normalizeShapeRecipe(recipe);}
function materializePoints(s){s.points=Object.fromEntries(SHAPE_POINT_CHANNELS.map(c=>[c,{...stationPoint(s,c)}]));return s.points;}
function syncLegacyExtents(s){s.upper=stationPoint(s,'upper').reach;s.lower=stationPoint(s,'lower').reach;s.depth=(stationPoint(s,'far').reach+stationPoint(s,'near').reach)/2;}
/** Absolute point target. Linked peers move by the same bounded delta, never snap. */
export function moveShapePoint(input,index,channel,target){const recipe=normalizeShapeRecipe(input);checkedIndex(recipe,index);checkedChannel(channel);if(!target||typeof target!=='object'||Array.isArray(target)||(!Object.hasOwn(target,'t')&&!Object.hasOwn(target,'reach')))throw new Error('Provide a point position or reach.');for(const key of ['t','reach'])if(target[key]!==undefined&&(typeof target[key]!=='number'||!Number.isFinite(target[key])))throw new Error('Point coordinates must be finite numbers.');
  const s=recipe.stations[index],pair=pointPair(channel),linked=s.links?.[pair]!==false,channels=linked?pairChannels[pair]:[channel],points=materializePoints(s),current=points[channel];let dt=(target.t??current.t)-current.t,dr=(target.reach??current.reach)-current.reach,loT=-Infinity,hiT=Infinity,loR=-Infinity,hiR=Infinity;
  for(const c of channels){const p=points[c],previous=recipe.stations[index-1],next=recipe.stations[index+1];loT=Math.max(loT,(previous?stationPoint(previous,c).t+.002:0)-p.t);hiT=Math.min(hiT,(next?stationPoint(next,c).t-.002:1)-p.t);loR=Math.max(loR,-p.reach);hiR=Math.min(hiR,4-p.reach);}
  if(index>0&&index<recipe.stations.length-1){const sum=pairChannels[pair].reduce((total,c)=>total+points[c].reach,0);loR=Math.max(loR,((pair==='outline'?.001:.002)-sum)/channels.length);}
  dt=clamp(dt,loT,hiT);dr=clamp(dr,loR,hiR);for(const c of channels){points[c].t=clamp(points[c].t+dt,0,1);points[c].reach=clamp(points[c].reach+dr,0,4);}syncLegacyExtents(s);recipe.formula=null;return normalizeShapeRecipe(recipe);
}
export const setShapePoint=moveShapePoint;
export function addShapeStation(input,u){const recipe=normalizeShapeRecipe(input);if(typeof u!=='number'||!Number.isFinite(u)||u<=0||u>=1)throw new Error('Add a station between the shape ends.');if(recipe.stations.length>=33)throw new Error('This shape already has 33 stations.');if(recipe.stations.some(s=>Math.abs(s.t-u)<.002-1e-12))throw new Error('Move further from an existing station.');const station={...sampleShapeProfile(recipe,u)};if(recipe.stations.some(s=>s.points))station.points=sampleShapePoints(recipe,u);syncLegacyExtents(station);recipe.stations.push(station);recipe.stations.sort((a,b)=>a.t-b.t);recipe.formula=null;return normalizeShapeRecipe(recipe);}
export function removeShapeStation(input,index){const recipe=normalizeShapeRecipe(input);checkedIndex(recipe,index);if(recipe.stations.length<=3)throw new Error('Keep at least three stations.');if(index===0||index===recipe.stations.length-1)throw new Error('The end stations cannot be removed.');recipe.stations.splice(index,1);recipe.formula=null;return normalizeShapeRecipe(recipe);}
export function setShapeEnd(input,side,reach){const recipe=normalizeShapeRecipe(input);side=side==='start'?0:side==='end'?1:side;if(side!==0&&side!==1)throw new Error('Choose the start or end.');if(typeof reach!=='number'||!Number.isFinite(reach)||reach<0||reach>4)throw new Error('End reach must be between 0 and 4.');const s=recipe.stations[side?recipe.stations.length-1:0];s.upper=s.lower=s.depth=reach;if(s.points){const points=materializePoints(s);for(const c of SHAPE_POINT_CHANNELS)points[c].reach=reach;}recipe.formula=null;return normalizeShapeRecipe(recipe);}

/** Small arithmetic parser. Expressions are data, never JavaScript. */
export function compileShapeFormula(expression) {
  if(typeof expression!=='string'||!expression.trim()||expression.length>256)throw new Error('Use a formula between 1 and 256 characters.');
  const tokens=[];let cursor=0;
  while(cursor<expression.length){const rest=expression.slice(cursor),space=/^\s+/.exec(rest);if(space){cursor+=space[0].length;continue;}
    const match=/^(?:(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z_][A-Za-z_0-9]*|[+\-*/^(),])/.exec(rest);
    if(!match)throw new Error(`Unsupported character at position ${cursor+1}.`);tokens.push(match[0]);cursor+=match[0].length;if(tokens.length>192)throw new Error('Formula is too complex.');}
  let i=0,level=0;
  const functions={sin:[1,Math.sin],cos:[1,Math.cos],abs:[1,Math.abs],sqrt:[1,Math.sqrt],pow:[2,Math.pow],min:[2,Math.min],max:[2,Math.max],clamp:[3,clamp]};
  const expressionAt=(minimum=0)=>{if(++level>24)throw new Error('Formula has too many nested expressions.');let left;const token=tokens[i++];
    if(token==='+'||token==='-'){const child=expressionAt(3);left=t=>token==='-'?-child(t):child(t);}
    else if(token==='('){left=expressionAt(0);if(tokens[i++]!==')')throw new Error('Close the bracket with ).');}
    else if(token==='t'||token==='x')left=t=>t;
    else if(token==='pi'||token==='e'){const value=token==='pi'?Math.PI:Math.E;left=()=>value;}
    else if(token&&/^\d|^\./.test(token)){const value=Number(token);if(!Number.isFinite(value))throw new Error('Formula number is too large.');left=()=>value;}
    else if(Object.hasOwn(functions,token)){const [arity,fn]=functions[token];if(tokens[i++]!=='(')throw new Error(`${token} needs brackets.`);const args=[];for(let j=0;j<arity;j++){if(j&&tokens[i++]!==',')throw new Error(`${token} needs ${arity} arguments.`);args.push(expressionAt(0));}if(tokens[i++]!==')')throw new Error(`${token} needs ${arity} arguments and a closing bracket.`);left=t=>fn(...args.map(arg=>arg(t)));}
    else throw new Error(`Unknown name or missing value: ${token||'end of formula'}.`);
    while(i<tokens.length){const op=tokens[i],power={'+':1,'-':1,'*':2,'/':2,'^':4}[op];if(!power||power<minimum)break;i++;const right=expressionAt(power+(op==='^'?0:1)),previous=left;left=t=>{const a=previous(t),b=right(t);return op==='+'?a+b:op==='-'?a-b:op==='*'?a*b:op==='/'?a/b:a**b;};}
    level--;return left;};
  const calculate=expressionAt();if(i!==tokens.length)throw new Error(`Unexpected ${tokens[i]}. Use * for multiplication.`);
  return t=>{if(typeof t!=='number'||!Number.isFinite(t)||t<0||t>1)throw new Error('Formula position must be a finite number between 0 and 1.');const value=calculate(t);if(!Number.isFinite(value))throw new Error('Formula must produce a finite value across the whole shape.');return value;};
}
export function applyShapeFormula(input,expression,{channel='upper',count=9}={}){
  if(!['upper','lower','depth','symmetric'].includes(channel))throw new Error('Choose upper, lower, depth or symmetric.');
  if(typeof count!=='number'||!Number.isInteger(count)||count<3||count>33)throw new Error('Formula sample count must be an integer between 3 and 33.');
  const recipe=normalizeShapeRecipe(input),fn=compileShapeFormula(expression);
  for(let i=0;i<=1024;i++){const value=fn(i/1024);if(value< -1e-10||value>4+1e-10)throw new Error('Keep the curve between 0 and 4. Try abs(...), max(0, ...) or clamp(..., 0, 4).');}
  const independent=recipe.stations.some(s=>s.points||s.links);
  const stations=Array.from({length:count},(_,i)=>{const t=i/(count-1),s=sampleShapeProfile(recipe,t),value=clamp(fn(t),0,4);if(independent){s.points=sampleShapePoints(recipe,t);const closest=recipe.stations.reduce((a,b)=>Math.abs(a.t-t)<=Math.abs(b.t-t)?a:b);if(closest.links)s.links={...closest.links};for(const c of channel==='symmetric'?['upper','lower']:channel==='depth'?['far','near']:[channel])s.points[c].reach=value;syncLegacyExtents(s);}else if(channel==='symmetric')s.upper=s.lower=value;else s[channel]=value;return s;});
  return normalizeShapeRecipe({...recipe,stations,formula:{expression,channel,samples:count}});
}

/** Closed loft with a wrap seam, separate cap normals and bounded SOL topology. */
export function buildShapeGeometry(input){
  const recipe=normalizeShapeRecipe(input);if(recipe.stations.some(s=>SHAPE_POINT_CHANNELS.some(c=>stationPoint(s,c).t!==s.t)||stationPoint(s,'far').reach!==stationPoint(s,'near').reach))return buildIndependentGeometry(recipe);const f=samplers(recipe),radial=recipe.radialSegments;
  const ts=[...new Set([...Array.from({length:recipe.segments+1},(_,i)=>i/recipe.segments),...recipe.stations.map(s=>s.t)])].sort((a,b)=>a-b);
  const vertices=[],uvs=[],normals=[],faces=[],canonical=[],canonicalPositions=[],canonicalNormals=[],weld=new Map(),rings=[];
  const exponent=.12+.88*recipe.roundness;
  const pointKey=p=>p.map(x=>Math.round(x*1e10)).join(',');
  const add=(p,uv,normal=null)=>{const key=pointKey(p);let c=weld.get(key);if(c===undefined){c=canonicalPositions.length;weld.set(key,c);canonicalPositions.push(p);canonicalNormals.push([0,0,0]);}const index=vertices.length;vertices.push(p);uvs.push(uv);normals.push(normal);canonical.push(c);return index;};
  const face=(indices,name,cap=false)=>{const [a,b,c]=indices.map(j=>vertices[j]);if(new Set(indices.map(j=>canonical[j])).size<3)return;const u=b.map((x,i)=>x-a[i]),v=c.map((x,i)=>x-a[i]),n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];if(Math.hypot(...n)<1e-14)return;faces.push({vertices:indices,materialId:null,surfaceId:null,name});if(!cap)for(const j of indices)for(let axis=0;axis<3;axis++)canonicalNormals[canonical[j]][axis]+=n[axis];};
  for(const t of ts){const upper=f.upper(t)*recipe.height/2,lower=f.lower(t)*recipe.height/2,depth=f.depth(t)*recipe.depth/2,ring=[];
    for(let j=0;j<=radial;j++){const theta=(j===radial?0:j/radial)*Math.PI*2,s=Math.sin(theta),c=Math.cos(theta);const y=Math.abs(s)<1e-12?0:Math.sign(s)*Math.abs(s)**exponent*(s>=0?upper:lower),z=Math.abs(c)<1e-12?0:Math.sign(c)*Math.abs(c)**exponent*depth;ring.push(add([(t-.5)*recipe.length,y,z],[t,j/radial]));}rings.push(ring);}
  for(let i=0;i<rings.length-1;i++)for(let j=0;j<radial;j++){const a=rings[i][j],b=rings[i+1][j],c=rings[i+1][j+1],d=rings[i][j+1];face([a,b,c],'Body');face([a,c,d],'Body');}
  for(const side of [0,1]){const r=rings[side?rings.length-1:0],t=side?1:0,upper=f.upper(t)*recipe.height/2,lower=f.lower(t)*recipe.height/2,depth=f.depth(t)*recipe.depth/2;if(upper+lower<1e-12||depth<1e-12)continue;
    const normal=[side?1:-1,0,0],x=(t-.5)*recipe.length,center=add([x,0,0],[.5,lower/(upper+lower)],normal),capRing=r.slice(0,radial).map(index=>{const p=vertices[index];return add([...p],[(p[2]/depth+1)/2,(p[1]+lower)/(upper+lower)],normal);});
    for(let j=0;j<radial;j++){const a=capRing[j],b=capRing[(j+1)%radial];face(side?[center,b,a]:[center,a,b],side?'End cap':'Start cap',true);}}
  for(let i=0;i<normals.length;i++)if(!normals[i]){const n=canonicalNormals[canonical[i]],length=Math.hypot(...n);normals[i]=length>1e-20?n.map(x=>x/length):[vertices[i][0]<0?-1:1,0,0];}
  return {vertices,faces,normals,uvs};
}

/** Independent edge positions warp sections continuously; caps follow those edges. */
function buildIndependentGeometry(recipe){
  const f=pointSamplers(recipe),radial=recipe.radialSegments,exponent=.12+.88*recipe.roundness;
  const ts=[...new Set([...Array.from({length:recipe.segments+1},(_,i)=>i/recipe.segments),...recipe.stations.map(s=>s.t)])].sort((a,b)=>a-b);
  const vertices=[],uvs=[],faces=[],rings=[],capVertices=new Set();
  const key=p=>p.map(x=>Math.round(x*1e10)).join(',');
  const add=(p,uv,cap=false)=>{const index=vertices.length;vertices.push(p);uvs.push(uv);if(cap)capVertices.add(index);return index;};
  const cross=(a,b,c)=>{const u=b.map((x,i)=>x-a[i]),v=c.map((x,i)=>x-a[i]);return [u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];};
  const face=(ids,name)=>{if(new Set(ids.map(i=>key(vertices[i]))).size<3||Math.hypot(...cross(...ids.map(i=>vertices[i])))<1e-14)return;faces.push({vertices:ids,materialId:null,surfaceId:null,name});};
  for(const u of ts){const p=Object.fromEntries(SHAPE_POINT_CHANNELS.map(c=>[c,{t:f[c].t(u),reach:f[c].reach(u)}])),ring=[];
    for(let j=0;j<=radial;j++){const theta=(j===radial?0:j/radial)*Math.PI*2,rawS=Math.sin(theta),rawC=Math.cos(theta),s=Math.abs(rawS)<1e-12?0:rawS,c=Math.abs(rawC)<1e-12?0:rawC,vertical=p[s>=0?'upper':'lower'],horizontal=p[c>=0?'far':'near'];const t=s*s*vertical.t+c*c*horizontal.t,y=Math.sign(s)*Math.abs(s)**exponent*vertical.reach*recipe.height/2,z=Math.sign(c)*Math.abs(c)**exponent*horizontal.reach*recipe.depth/2;ring.push(add([(t-.5)*recipe.length,y,z],[u,j/radial]));}rings.push(ring);}
  for(let i=0;i<rings.length-1;i++)for(let j=0;j<radial;j++){const a=rings[i][j],b=rings[i+1][j],c=rings[i+1][j+1],d=rings[i][j+1];face([a,b,c],'Body');face([a,c,d],'Body');}
  for(const side of [0,1]){const ring=rings[side?rings.length-1:0].slice(0,radial),points=ring.map(i=>vertices[i]),ys=points.map(p=>p[1]),zs=points.map(p=>p[2]),ymin=Math.min(...ys),ymax=Math.max(...ys),zmin=Math.min(...zs),zmax=Math.max(...zs),center=[points.reduce((sum,p)=>sum+p[0],0)/radial,0,0],capUV=p=>[(p[2]-zmin)/(zmax-zmin||1),(p[1]-ymin)/(ymax-ymin||1)];
    const area=[0,0,0];for(let j=0;j<points.length;j++){const n=cross(center,points[j],points[(j+1)%points.length]);for(let axis=0;axis<3;axis++)area[axis]+=n[axis];}if(Math.hypot(...area)<1e-14)continue;
    for(let j=0;j<radial;j++){const a=points[j],b=points[(j+1)%radial],ordered=side?[center,b,a]:[center,a,b];if(Math.hypot(...cross(...ordered))<1e-14)continue;face(ordered.map(p=>add([...p],capUV(p),true)),side?'End cap':'Start cap');}
  }
  // A zero-width end can lie along a line with distinct point positions. Split
  // its collinear boundary segments at common vertices before welding normals.
  for(const ring of [rings[0],rings.at(-1)]){
    const candidates=[...new Map(ring.map(i=>[key(vertices[i]),i])).values()];
    for(let index=faces.length-1;index>=0;index--){const original=faces[index];if(original.name!=='Body')continue;let parts=[original.vertices];
      for(let edge=0;edge<3;edge++){const a=original.vertices[edge],b=original.vertices[(edge+1)%3];if(!ring.includes(a)||!ring.includes(b))continue;const pa=vertices[a],pb=vertices[b],delta=pb.map((x,i)=>x-pa[i]),length2=delta.reduce((sum,x)=>sum+x*x,0);if(length2<1e-20)continue;const inside=candidates.map(i=>{const p=vertices[i],t=p.reduce((sum,x,k)=>sum+(x-pa[k])*delta[k],0)/length2;return {i,t,error:Math.hypot(...p.map((x,k)=>x-pa[k]-t*delta[k]))};}).filter(v=>v.t>1e-9&&v.t<1-1e-9&&v.error<1e-9).sort((x,y)=>x.t-y.t);
        if(!inside.length)continue;const next=[];for(const ids of parts){const ai=ids.indexOf(a);if(ai<0||ids[(ai+1)%3]!==b){next.push(ids);continue;}const other=ids[(ai+2)%3],line=[a,...inside.map(v=>v.i),b];for(let j=0;j<line.length-1;j++)next.push([line[j],line[j+1],other]);}parts=next;
      }
      if(parts.length>1)faces.splice(index,1,...parts.map(ids=>({...original,vertices:ids})));
    }
  }
  const sums=new Map(),normals=vertices.map(()=>[0,0,0]);
  for(const item of faces){const n=cross(...item.vertices.map(i=>vertices[i]));for(const i of item.vertices){if(capVertices.has(i)){normals[i]=n;continue;}const k=key(vertices[i]),sum=sums.get(k)||[0,0,0];for(let axis=0;axis<3;axis++)sum[axis]+=n[axis];sums.set(k,sum);}}
  for(let i=0;i<normals.length;i++){const n=capVertices.has(i)?normals[i]:sums.get(key(vertices[i]))||[vertices[i][0]<0?-1:1,0,0],length=Math.hypot(...n);normals[i]=length>1e-20?n.map(x=>x/length):[1,0,0];}
  return {vertices,faces,normals,uvs};
}
