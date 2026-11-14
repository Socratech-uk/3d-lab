import { modelById } from './models.mjs';
export const VERSION = '0.22.0';
export const PROTOCOL = 'capp.3d-lab.assets.v1';
export const MODEL = 'triposr';
export const LIMITS = Object.freeze({ imageBytes: 4 * 1024 ** 2, sourceBytes: 25 * 1024 ** 2, glbBytes: 0xffffffff /* GLB 2.0 uint32 length */, pixels: 24_000_000 });
export function check(condition, message) { if (!condition) throw new Error(message); }
export function text(value, max, required = false) {
  check(typeof value === 'string' && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value), 'Invalid asset text.');
  value = value.trim(); check(!required || value, 'Give the asset a name.'); return value;
}
export function key(value) { return String(value || '').normalize('NFKC').trim().toLocaleLowerCase('en-US'); }
export function metadata(value = {}) {
  const tags = Array.isArray(value.tags) ? value.tags : String(value.tags || '').split(',').map(x => x.trim()).filter(Boolean);
  check(tags.length <= 32, 'Use up to 32 tags.');
  const folder = text(value.folder || '', 120);
  check(!/[\\/:*?"<>|]/.test(folder) && folder !== '.' && folder !== '..', 'Use a folder name without path separators.');
  return { title: text(value.title || '', 160, true), folder, tags: [...new Set(tags.map(t => key(text(t, 64, true))))], notes: text(value.notes || '', 4000) };
}
export function availableName(title, rows, folder = '') {
  title = text(title, 160, true);
  const taken = new Set(rows.filter(r => key(r.folder) === key(folder)).map(r => key(r.title)));
  if (!taken.has(key(title))) return title;
  for (let n = 2; n < 100000; n++) { const suffix = ` (${n})`, candidate = title.slice(0, 160 - suffix.length) + suffix; if (!taken.has(key(candidate))) return candidate; }
  throw new Error('Too many assets share this name. Choose a different name.');
}
export function filterAssets(rows, { query = '', folder = '', type = '' } = {}) {
  const words = key(query).split(/\s+/).filter(Boolean);
  return rows.filter(r => (!folder || key(r.folder) === key(folder)) && (!type || r.origin === type) && words.every(w => key([r.title, r.folder, ...r.tags, r.notes, r.origin, r.recipe?.model].join(' ')).includes(w))).sort((a,b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
}
export function recipe(value = {}) {
  const model = value.model || MODEL, device = value.device || 'auto', resolution = value.resolution ?? 256;
  const spec = modelById(model);
  check(spec && spec.devices.includes(device) && spec.resolutions.includes(resolution), 'Choose a supported model, device and detail level.');
  if (model === MODEL) return { model, device, resolution };
  const seed = value.seed ?? 0, steps = value.steps ?? 30;
  check(Number.isInteger(seed) && seed >= 0 && seed <= 2147483647 && Number.isInteger(steps) && steps >= 10 && steps <= 75, 'Use a seed from 0 to 2147483647 and 10–75 steps.');
  const result = { model, device, resolution, seed, steps };
  if (model.startsWith('hunyuan3d-')) {
    const guidanceScale=value.guidanceScale??5, memoryMode=value.memoryMode??'gpu', numChunks=value.numChunks??8000;
    check(Number.isFinite(guidanceScale)&&guidanceScale>=0&&guidanceScale<=20, 'Use guidance from 0 to 20.');
    check(['gpu','cpu-offload'].includes(memoryMode), 'Choose GPU or CPU offload memory mode.');
    check(Number.isInteger(numChunks)&&numChunks>=1000&&numChunks<=32000, 'Use 1000–32000 decode points per batch.');
    Object.assign(result,{guidanceScale,memoryMode,numChunks});
    if(value.imagePadding!==undefined){check(Number.isFinite(value.imagePadding)&&value.imagePadding>=.05&&value.imagePadding<=.25, 'Use reference padding from 0.05 to 0.25.');result.imagePadding=value.imagePadding;}
  }
  return result;
}
export function encode64(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode(...bytes.subarray(i, i + 32768)); return btoa(s); }
export function decode64(value, max = LIMITS.glbBytes) {
  const invalid = 'Invalid or oversized encoded file.';
  check(typeof value === 'string' && value.length > 0 && value.length % 4 === 0 && value.length <= Math.ceil(max / 3) * 4, invalid);
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const byteLength = value.length / 4 * 3 - padding;
  check(byteLength <= max, 'The file is too large.');
  // Repeated base64 groups in a RegExp overflow V8's stack on large valid GLBs.
  // Check the alphabet in constant space, allowing padding only at the end.
  for (let i = 0; i < value.length - padding; i++) {
    const c = value.charCodeAt(i);
    check((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 43 || c === 47, invalid);
  }
  const bytes = new Uint8Array(byteLength);
  // Each chunk ends on a base64 quartet. Avoid a full-size decoded string and
  // Uint8Array.from(string)'s iterable temporary allocation for 64 MiB models.
  for (let start = 0, offset = 0; start < value.length; start += 65536) {
    const raw = atob(value.slice(start, start + 65536));
    for (let i = 0; i < raw.length; i++) bytes[offset++] = raw.charCodeAt(i);
  }
  return bytes;
}
export async function digest(bytes) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join(''); }

/** Read raster dimensions before browser decoding can allocate a large surface. */
export function imageDimensions(bytes, mime) {
  const v = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength), ascii = (start,count) => String.fromCharCode(...bytes.subarray(start,start+count));
  let width=0,height=0;
  if (mime === 'image/png' && bytes.length>=24 && v.getUint32(0)===0x89504e47 && v.getUint32(4)===0x0d0a1a0a && ascii(12,4)==='IHDR') { width=v.getUint32(16); height=v.getUint32(20); }
  if (mime === 'image/jpeg' && bytes.length>=4 && bytes[0]===255 && bytes[1]===216) {
    let cursor=2;
    while (cursor+4<=bytes.length) {
      check(bytes[cursor++]===255,'Invalid JPEG marker.'); while (bytes[cursor]===255) cursor++;
      const marker=bytes[cursor++]; if (marker===217 || marker===218) break;
      if (marker===1 || (marker>=208 && marker<=215)) continue;
      check(cursor+2<=bytes.length,'Truncated JPEG.'); const length=v.getUint16(cursor); check(length>=2 && cursor+length<=bytes.length,'Truncated JPEG segment.');
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) { check(length>=8,'Invalid JPEG frame.'); height=v.getUint16(cursor+3); width=v.getUint16(cursor+5); break; }
      cursor+=length;
    }
  }
  if (mime === 'image/webp' && bytes.length>=30 && ascii(0,4)==='RIFF' && ascii(8,4)==='WEBP') {
    const type=ascii(12,4),u24=p=>bytes[p]+bytes[p+1]*256+bytes[p+2]*65536;
    if (type==='VP8X') { width=u24(24)+1;height=u24(27)+1; }
    else if (type==='VP8 ' && ascii(23,3)==='\x9d\x01\x2a') { width=v.getUint16(26,true)&0x3fff;height=v.getUint16(28,true)&0x3fff; }
    else if (type==='VP8L' && bytes[20]===47) { const bits=v.getUint32(21,true);width=(bits&0x3fff)+1;height=((bits>>>14)&0x3fff)+1; }
  }
  check(Number.isSafeInteger(width) && Number.isSafeInteger(height) && width>0 && height>0,'Unsupported or invalid raster image header.');
  return {width,height};
}

/** Admit a bounded, self-contained glTF 2.0 binary before any renderer or loader runs. */
export function inspectGlb(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  check(bytes.byteLength >= 28 && bytes.byteLength <= LIMITS.glbBytes, 'Use a complete GLB 2.0 file.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  check(view.getUint32(0, true) === 0x46546c67 && view.getUint32(4, true) === 2 && view.getUint32(8, true) === bytes.byteLength, 'This is not a complete GLB 2.0 file.');
  let cursor = 12, json = null, binaryBytes = 0, binaryStart = 0, chunks = 0;
  while (cursor < bytes.length) {
    check(cursor + 8 <= bytes.length, 'Truncated GLB chunk.');
    const size = view.getUint32(cursor, true), kind = view.getUint32(cursor + 4, true); cursor += 8;
    check(size % 4 === 0 && cursor + size <= bytes.length && ++chunks <= 2, 'Invalid GLB chunks.');
    if (chunks === 1) {
      check(kind === 0x4e4f534a && size <= 8 * 1024 ** 2, 'Missing or oversized GLB JSON.');
      try { json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(cursor, cursor + size))); } catch { throw new Error('Invalid GLB metadata.'); }
    } else { check(kind === 0x004e4942, 'Unsupported GLB chunk.'); binaryBytes = size; binaryStart = cursor; }
    cursor += size;
  }
  check(json?.asset?.version === '2.0' && Array.isArray(json.meshes) && json.meshes.length > 0 && json.meshes.length <= 512, 'The GLB needs a supported mesh.');
  check((json.nodes?.length || 0) <= 4096 && (json.materials?.length || 0) <= 256 && (json.images?.length || 0) <= 64 && (json.accessors?.length || 0) <= 10000, 'This GLB is too complex for the preview.');
  check(!json.extensionsRequired?.some(e => e !== 'KHR_materials_unlit'), 'This GLB requires an extension not supported by this release. Export an uncompressed GLB.');
  // No external paths, URLs, embedded executable content or compressed decoders.
  function walk(value, depth = 0) {
    check(depth <= 64, 'GLB metadata is nested too deeply.');
    if (!value || typeof value !== 'object') return;
    for (const [k,v] of Object.entries(value)) {
      check(k !== 'uri', 'Use a self-contained GLB with embedded buffers and textures. External references are not loaded.');
      check(!['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_texture_basisu'].includes(k), 'Compressed GLB requires a decoder unavailable in this release.');
      if (typeof v === 'object') walk(v, depth + 1);
    }
  }
  walk(json);
  check(Array.isArray(json.buffers) && json.buffers.length === 1 && Number.isSafeInteger(json.buffers[0].byteLength) && json.buffers[0].byteLength > 0 && json.buffers[0].byteLength <= binaryBytes && binaryBytes - json.buffers[0].byteLength < 4, 'GLB buffer length does not match.');
  for (const b of json.bufferViews || []) check(b.buffer === 0 && Number.isSafeInteger(b.byteLength) && b.byteLength >= 0 && Number.isSafeInteger(b.byteOffset || 0) && (b.byteOffset || 0) >= 0 && (b.byteOffset || 0) + b.byteLength <= json.buffers[0].byteLength, 'GLB buffer view is out of range.');
  const components = {5120:1,5121:1,5122:2,5123:2,5125:4,5126:4}, widths = {SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT2:4,MAT3:9,MAT4:16};
  for (const a of json.accessors || []) {
    check(Number.isSafeInteger(a.count) && a.count > 0 && components[a.componentType] && widths[a.type], 'Invalid mesh attribute.');
    check(!a.sparse, 'Sparse GLB attributes are not supported in this release. Re-export a standard GLB.');
    const b = json.bufferViews?.[a.bufferView], element = components[a.componentType]*widths[a.type], stride = b?.byteStride || element, offset = a.byteOffset || 0;
    check(b && Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(stride) && stride >= element && stride <= 252 && offset+(a.count-1)*stride+element <= b.byteLength, 'Mesh attribute exceeds its buffer.');
  }
  check((json.images?.length || 0) <= 8, 'Use up to eight embedded textures in this release.');
  let texturePixels=0;
  for (const image of json.images || []) {
    const b=json.bufferViews?.[image.bufferView]; check(['image/png','image/jpeg'].includes(image.mimeType) && b?.byteLength <= 16*1024**2, 'Use embedded PNG or JPEG textures up to 16 MiB.');
    const start=binaryStart+(b.byteOffset||0),dimensions=imageDimensions(bytes.subarray(start,start+b.byteLength),image.mimeType);
    texturePixels+=dimensions.width*dimensions.height;
    check(dimensions.width<=4096 && dimensions.height<=4096 && texturePixels<=32_000_000,'Reduce embedded texture dimensions before importing this model.');
  }
  const parents = new Map(), nodes = json.nodes || [];
  for (let i=0;i<nodes.length;i++) {
    const node = nodes[i];
    if (node.mesh !== undefined) check(Number.isSafeInteger(node.mesh) && json.meshes[node.mesh], 'Invalid mesh reference.');
    check(!node.extensions?.EXT_mesh_gpu_instancing, 'Instanced GLBs are not supported in this release.');
    for (const child of node.children || []) { check(Number.isSafeInteger(child) && child>=0 && child<nodes.length && !parents.has(child) && child!==i, 'Invalid model hierarchy.'); parents.set(child,i); }
  }
  for (let i=0;i<nodes.length;i++) { let parent=i, depth=0; while (parents.has(parent)) { parent=parents.get(parent); check(++depth<=64 && parent!==i, 'Cyclic or overly deep model hierarchy.'); } }
  let vertices = 0, triangles = 0;
  for (const m of json.meshes) {
    check(Array.isArray(m.primitives) && m.primitives.length > 0 && m.primitives.length <= 512, 'Invalid mesh primitives.');
    for (const p of m.primitives) {
      const position = json.accessors?.[p.attributes?.POSITION];
      check(position && Number.isSafeInteger(position.count) && position.count > 0 && position.type === 'VEC3' && position.componentType === 5126, 'Invalid mesh positions.');
      check(p.mode === undefined || p.mode === 4, 'Only triangle meshes are supported.');
      check(!p.targets?.length, 'Morph targets are not supported by Action Lab yet. Export skeletal animation or a static mesh.');
      const indices = p.indices === undefined ? position : json.accessors?.[p.indices];
      check(indices && Number.isSafeInteger(indices.count) && indices.count > 0 && indices.count % 3 === 0, 'Invalid triangle indices.');
      vertices += position.count; triangles += indices.count / 3;
    }
  }
  // Animation and skin data must be checked before GLTFLoader creates a rig.
  const read=(index,i,c=0)=>{const a=json.accessors[index],b=json.bufferViews[a.bufferView],offset=binaryStart+(b.byteOffset||0)+(a.byteOffset||0)+i*(b.byteStride||components[a.componentType]*widths[a.type])+c*components[a.componentType];return a.componentType===5126?view.getFloat32(offset,true):a.componentType===5123?view.getUint16(offset,true):a.componentType===5121?view.getUint8(offset):a.componentType===5125?view.getUint32(offset,true):NaN;};
  check((json.skins?.length||0)<=128&&(json.animations?.length||0)<=32,'Use at most 128 skins and 32 actions.');
  for(const skin of json.skins||[]){
    check(Array.isArray(skin.joints)&&skin.joints.length>0&&skin.joints.length<=128&&new Set(skin.joints).size===skin.joints.length&&skin.joints.every(n=>Number.isInteger(n)&&n>=0&&nodes[n]),'Invalid or oversized skeleton.');
    if(skin.skeleton!==undefined)check(Number.isInteger(skin.skeleton)&&nodes[skin.skeleton],'Invalid skeleton root.');
    if(skin.inverseBindMatrices!==undefined){const a=json.accessors[skin.inverseBindMatrices];check(a?.type==='MAT4'&&a.componentType===5126&&a.count===skin.joints.length,'Invalid inverse bind matrices.');for(let i=0;i<a.count;i++)for(let k=0;k<16;k++)check(Number.isFinite(read(skin.inverseBindMatrices,i,k)),'Non-finite bind matrix.');}
  }
  for(const node of nodes)if(node.skin!==undefined){
    const skin=json.skins?.[node.skin];check(Number.isInteger(node.skin)&&skin&&json.meshes[node.mesh],'Invalid skin reference.');
    for(const p of json.meshes[node.mesh].primitives){const ji=p.attributes.JOINTS_0,wi=p.attributes.WEIGHTS_0,j=json.accessors[ji],w=json.accessors[wi],pos=json.accessors[p.attributes.POSITION];check(j?.type==='VEC4'&&[5121,5123].includes(j.componentType)&&j.count===pos.count&&w?.type==='VEC4'&&[5126,5121,5123].includes(w.componentType)&&w.count===pos.count,'A skinned mesh needs four joint indices and weights per vertex.');check(w.componentType===5126||w.normalized===true,'Integer skin weights must be normalized.');
      for(let i=0;i<j.count;i++){let sum=0;for(let k=0;k<4;k++){const index=read(ji,i,k),weight=read(wi,i,k)/(w.componentType===5121?255:w.componentType===5123?65535:1);check(index<skin.joints.length&&Number.isFinite(weight)&&weight>=0&&weight<=1.0001,'Invalid bone influence.');sum+=weight;}check(sum>.00001&&Math.abs(sum-1)<.03,'Skin weights must sum to one.');}
    }
  }
  let animationKeys=0;
  for(const animation of json.animations||[]){check(Array.isArray(animation.channels)&&animation.channels.length>0&&animation.channels.length<=384&&Array.isArray(animation.samplers),'Invalid animation.');const targets=new Set();
    for(const channel of animation.channels){const sampler=animation.samplers[channel.sampler],target=channel.target;check(Number.isInteger(channel.sampler)&&sampler&&Number.isInteger(target?.node)&&nodes[target.node]&&['translation','rotation','scale'].includes(target.path),'Unsupported animation target.');const key=target.node+':'+target.path;check(!targets.has(key),'Duplicate animation channel.');targets.add(key);
      const times=json.accessors[sampler.input],values=json.accessors[sampler.output],interpolation=sampler.interpolation||'LINEAR';check(['LINEAR','STEP','CUBICSPLINE'].includes(interpolation)&&times?.type==='SCALAR'&&times.componentType===5126&&values?.componentType===5126&&values.type===(target.path==='rotation'?'VEC4':'VEC3')&&values.count===times.count*(interpolation==='CUBICSPLINE'?3:1),'Invalid animation sampler.');animationKeys+=times.count;check(animationKeys<=540000,'Animation key budget exceeded.');let previous=-1;
      for(let i=0;i<times.count;i++){const t=read(sampler.input,i);check(Number.isFinite(t)&&t>=0&&t>previous&&t<=3600,'Invalid animation times.');previous=t;}
      for(let i=0;i<values.count;i++)for(let k=0;k<widths[values.type];k++)check(Number.isFinite(read(sampler.output,i,k)),'Non-finite animation value.');
    }
  }
  return { bytes, json, vertices, triangles, meshes: json.meshes.length, animations:json.animations?.length||0, skins:json.skins?.length||0, byteLength: bytes.byteLength };
}

/** Re-encode a user-selected raster; never hand arbitrary paths or URLs to native code. */
export async function prepareImage(file) {
  check(file instanceof Blob && file.size > 0 && file.size <= LIMITS.sourceBytes, 'Choose a PNG, JPEG or WebP image up to 25 MiB.');
  check(['image/png','image/jpeg','image/webp'].includes(file.type), 'Choose a PNG, JPEG or WebP image.');
  const dimensions = imageDimensions(new Uint8Array(await file.arrayBuffer()),file.type);
  check(dimensions.width*dimensions.height <= LIMITS.pixels && dimensions.width>=32 && dimensions.height>=32,'Use a reference from 32 pixels to 24 megapixels.');
  let bitmap; try { bitmap = await createImageBitmap(file); } catch { throw new Error('The image could not be decoded. Try exporting it as PNG.'); }
  try {
    check(bitmap.width * bitmap.height <= LIMITS.pixels && bitmap.width >= 32 && bitmap.height >= 32, 'Use an image at least 32 pixels wide/high and no more than 24 megapixels.');
    const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas'); canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
    check(canvas.width >= 32 && canvas.height >= 32, 'The reference is too narrow after resizing. Crop around the object before importing it.');
    const context = canvas.getContext('2d', { willReadFrequently: false }); check(context, 'Image processing is unavailable.');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    check(blob && blob.size <= LIMITS.imageBytes, 'The prepared PNG exceeds 4 MiB. Use a smaller image.');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return { blob, bytes, imagePng: encode64(bytes), width: canvas.width, height: canvas.height, sha256: await digest(bytes), name: String(file.name || 'Reference image').slice(0, 200) };
  } finally { bitmap.close(); }
}
