"""Seed a disposable native Files pool; receives all paths explicitly."""
from pathlib import Path
import argparse,sys,json,struct,hashlib,zlib
p=argparse.ArgumentParser();p.add_argument('--capp',type=Path,required=True);p.add_argument('--home',type=Path,required=True);p.add_argument('--model',type=Path,required=True);args=p.parse_args();sys.path.insert(0,str(args.capp/'sidecars/files/native'))
from model_store import DraftStore
root=args.home/'user/cApp/assets/3d';store=DraftStore(root)
def chunk(kind,data):return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data))
pixels=b''.join(b'\0'+b''.join(bytes((50+x//4,80+y//4,180,255 if 15<x<240 and 10<y<374 else 0)) for x in range(256)) for y in range(384));ref=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',256,384,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(pixels))+chunk(b'IEND',b'');(args.home/'reference.png').write_bytes(ref)
refsha=hashlib.sha256(ref).hexdigest();store.put_blob(refsha,ref)
blob=lambda key,data,mime:{'$blob':{'sha256':key,'size':len(data),'type':mime}}
raw=json.dumps({'asset':{'version':'2.0'},'scene':0,'scenes':[{'nodes':[0]}],'nodes':[{'mesh':0}],'meshes':[{'primitives':[{'attributes':{'POSITION':0}}]}],'buffers':[{'byteLength':36}],'bufferViews':[{'buffer':0,'byteLength':36}],'accessors':[{'bufferView':0,'componentType':5126,'count':3,'type':'VEC3','min':[0,0,0],'max':[1,1,0]}]},separators=(',',':')).encode();raw+=b' '*(-len(raw)%4);binary=struct.pack('<9f',0,0,0,1,0,0,0,1,0);small=struct.pack('<III',0x46546c67,2,28+len(raw)+len(binary))+struct.pack('<II',len(raw),0x4e4f534a)+raw+struct.pack('<II',len(binary),0x004e4942)+binary
model=args.model.read_bytes();length=struct.unpack_from('<I',model,12)[0];doc=json.loads(model[20:20+length]);triangles=sum(doc['accessors'][n.get('indices',n['attributes']['POSITION'])]['count']//3 for m in doc['meshes'] for n in m['primitives']);vertices=sum(doc['accessors'][n['attributes']['POSITION']]['count'] for m in doc['meshes'] for n in m['primitives'])
try:
 for i in range(54):
  data=model if i==53 else small;sha=hashlib.sha256(data).hexdigest();store.put_blob(sha,data);id='npc-test' if i==53 else 'fixture-'+str(i)
  asset={'id':id,'title':'NPC projection test' if i==53 else 'Fixture '+str(i),'revision':1,'sha256':sha,'byteLength':len(data),'origin':'import','triangles':triangles if i==53 else 1,'vertices':vertices if i==53 else 3,'createdAt':f'2026-10-18T20:00:{i:02}Z','updatedAt':'2026-10-18T20:00:00Z','folder':'','tags':[],'notes':''}
  files={'id':id,'glb':blob(sha,data,'model/gltf-binary'),'thumbnail':blob(refsha,ref,'image/png'),'image':blob(refsha,ref,'image/png'),'views':{'right':{'blob':blob(refsha,ref,'image/png'),'name':'right.png'}}}
  store.save({'bundle':{'asset':asset,'files':files}})
finally:store.close()
print(json.dumps({'root':str(root),'triangles':triangles}))
