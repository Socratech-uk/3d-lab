/** One texture/packed-surface evaluator shared by raw gameplay and Gallery.
 * Metre-scaled triplanar mapping uses local (not world) coordinates, so ship
 * translation/rotation never swims textures. Decals have explicit local UVs.
 * Packed B is micro-height only: neither displacement nor a collision surface.
 */
export const SHIP_SURFACE_GLSL=`
uniform sampler2D uShipAlbedo;
uniform sampler2D uShipSurface;
uniform float uShipEnabled;
uniform float uShipDecal;
uniform float uShipScale;
uniform float uShipBump;
uniform float uShipTexel;
uniform float uShipOpacity;
uniform vec3 uShipTint;
uniform vec4 uShipRect;
void sampleShipSurface(vec3 P,vec3 N,vec2 uv,inout vec3 colour,inout float roughness,inout float metallic,out vec3 normal,out float alpha){
 normal=normalize(N);alpha=1.0;
 if(uShipEnabled<.5)return;
 if(uShipDecal>.5){
  vec2 atlasUv=uShipRect.xy+clamp(uv,vec2(.002),vec2(.998))*uShipRect.zw;
  vec4 ink=texture2D(uShipAlbedo,atlasUv);colour=ink.rgb*uShipTint;alpha=ink.a*uShipOpacity;roughness=.82;metallic=0.;return;
 }
 vec3 p=P*uShipScale;
 vec3 w=pow(abs(normal)+vec3(.0001),vec3(6.));w/=max(.0001,w.x+w.y+w.z);
 vec4 ax=texture2D(uShipAlbedo,p.yz),ay=texture2D(uShipAlbedo,p.xz),az=texture2D(uShipAlbedo,p.xy);
 vec3 sx=texture2D(uShipSurface,p.yz).rgb,sy=texture2D(uShipSurface,p.xz).rgb,sz=texture2D(uShipSurface,p.xy).rgb;
 vec3 surf=sx*w.x+sy*w.y+sz*w.z;
 colour=(ax.rgb*w.x+ay.rgb*w.y+az.rgb*w.z)*uShipTint;
 roughness=clamp(surf.r,.045,1.);metallic=clamp(surf.g,0.,1.);
 // Dominant-plane finite differences keep WebGL1 support without optional
 // derivative extensions. Mipmapped source suppresses distant microdetail.
 vec2 q=p.xy;float h=sz.b;vec3 tangent=vec3(1,0,0),bitangent=vec3(0,1,0);
 if(w.x>=w.y&&w.x>=w.z){q=p.yz;h=sx.b;tangent=vec3(0,1,0);bitangent=vec3(0,0,1);}
 else if(w.y>=w.z){q=p.xz;h=sy.b;tangent=vec3(1,0,0);bitangent=vec3(0,0,1);}
 vec2 gradient=vec2(texture2D(uShipSurface,q+vec2(uShipTexel,0)).b-h,texture2D(uShipSurface,q+vec2(0,uShipTexel)).b-h);
 vec3 g=(tangent*gradient.x+bitangent*gradient.y)*uShipBump*7.;
 normal=normalize(normal-(g-normal*dot(normal,g)));
}
`;
export const SHIP_SURFACE_UNIFORMS=['uShipAlbedo','uShipSurface','uShipEnabled','uShipDecal','uShipScale','uShipBump','uShipTexel','uShipOpacity','uShipTint','uShipRect'];
export function shipSurfaceUniforms(gl,program){return Object.fromEntries(SHIP_SURFACE_UNIFORMS.map(k=>[k,gl.getUniformLocation(program,k)]));}
