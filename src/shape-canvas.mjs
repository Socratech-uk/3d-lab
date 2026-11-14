import { getShapePoint, getShapePairLinked, sampleShapePoints } from './authoring/src/model-format/sol-shape-profile.js';

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const finite = value => typeof value === 'number' && Number.isFinite(value);
const copyPoint = point => ({ x: point.x, y: point.y });
const sameSelection = (a, b) => a?.index === b?.index && a?.channel === b?.channel;
const colours = { upper:'#67e8cf', lower:'#78b6ff', far:'#67e8cf', near:'#b4a1ff', sketch:'#67e8cf' };
const pointDistance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
const nearestOnSegment = (point,a,b) => {
  const dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;
  const t=length ? clamp(((point.x-a.x)*dx+(point.y-a.y)*dy)/length,0,1) : 0;
  return { x:a.x+dx*t,y:a.y+dy*t,t };
};
const readable = value => Math.abs(value)<1e-9 ? '0' : Number(value.toPrecision(4)).toString();

/** Local-coordinate sketch editor. All durable changes belong to its controller. */
export class ShapeCanvas {
  constructor(canvas, callbacks={}) {
    if (!canvas?.getContext) throw new Error('ShapeCanvas needs a canvas element.');
    this.canvas=canvas;
    this.context=canvas.getContext('2d');
    if (!this.context) throw new Error('This device could not open the 2D shape editor.');
    this.callbacks=callbacks;
    this.state={part:null,view:'side',tool:'select',selected:null,snap:true,gridStep:.1,drawPoints:[]};
    this.camera={x:0,y:0,scale:100};
    this.width=0;this.height=0;this.dpr=1;this.drag=null;this.hover=null;this.space=false;
    this.geometry={handles:[],curves:[],segments:[],bounds:{minX:-2,maxX:2,minY:-1,maxY:1}};
    this.cacheKey='';this.status='';this.reference=null;this.referenceOptions={opacity:.28,scale:1};
    this.destroyed=false;this.needsFit=true;this.listeners=[];
    canvas.tabIndex=0;
    canvas.setAttribute('role','application');
    canvas.setAttribute('aria-label','Shape profile editor. Drag points or edges to edit. Double-click a line to insert a point. Scroll to zoom. Space and drag to pan.');
    canvas.style.touchAction='none';
    this.listen(canvas,'pointerdown',event=>this.pointerDown(event));
    this.listen(canvas,'pointermove',event=>this.pointerMove(event));
    this.listen(canvas,'pointerup',event=>this.pointerUp(event));
    this.listen(canvas,'pointercancel',()=>this.cancelGesture());
    this.listen(canvas,'lostpointercapture',()=>{if(this.drag)this.cancelGesture();});
    this.listen(canvas,'pointerleave',()=>{if(!this.drag){this.hover=null;this.render();}});
    this.listen(canvas,'dblclick',event=>this.doubleClick(event));
    this.listen(canvas,'contextmenu',event=>event.preventDefault());
    this.listen(canvas,'wheel',event=>this.wheel(event),{passive:false});
    this.listen(canvas,'keydown',event=>this.keyDown(event));
    this.listen(canvas,'keyup',event=>{if(event.code==='Space'){this.space=false;this.updateCursor();}});
    this.listen(canvas,'blur',()=>{this.space=false;this.cancelGesture();this.hover=null;this.render();});
    this.listen(globalThis,'blur',()=>{this.space=false;this.cancelGesture();});
    if(typeof ResizeObserver!=='undefined'){
      this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(canvas);
    }else this.listen(globalThis,'resize',()=>this.resize());
    this.resize();
  }

  listen(target,name,handler,options){target.addEventListener(name,handler,options);this.listeners.push(()=>target.removeEventListener(name,handler,options));}
  emit(name,value){try{return this.callbacks[name]?.(value);}catch(error){if(name!=='onError')this.callbacks.onError?.(error);}}
  announce(message){if(message!==this.status){this.status=message;this.emit('onStatus',message);}}
  profile(){return this.state.part?.profile || this.state.part?.recipe;}
  isProfile(){return this.state.part?.type==='profile' || !!this.profile();}
  isRevolve(){return this.state.part?.type==='revolve';}
  sketch(){return this.state.part?.sketch || {points:this.state.part?.points || [],closed:true};}

  setState(next={}){
    if(this.destroyed)return;
    const previousId=this.state.part?.id,previousView=this.state.view,previousType=this.state.part?.type;
    const changedPart=Object.hasOwn(next,'part') && next.part?.id!==previousId;
    if(this.drag && (changedPart || (next.view && next.view!==previousView) || (next.tool && next.tool!==this.state.tool)))this.cancelGesture();
    this.state={...this.state,...next};
    this.state.drawPoints=Array.isArray(this.state.drawPoints)?this.state.drawPoints:[];
    if(!['side','top'].includes(this.state.view))this.state.view='side';
    if(!finite(this.state.gridStep)||this.state.gridStep<=0)this.state.gridStep=.1;
    this.rebuildGeometry();
    if(changedPart || previousView!==this.state.view || previousType!==this.state.part?.type)this.needsFit=true;
    if(this.needsFit&&this.width&&this.height)this.fit();else this.render();
    this.updateCursor();
  }

  rebuildGeometry(){
    const profile=this.profile(),sketch=this.sketch();
    const key=JSON.stringify([this.state.view,this.state.part?.type,profile || sketch]);
    if(key===this.cacheKey)return;
    this.cacheKey=key;
    const handles=[],curves=[],segments=[];
    try{
      if(this.isProfile()&&profile){
        // Formula metadata describes how the stations were created; the stations
        // already contain its values. Avoid recompiling it for every preview sample.
        const previewProfile={...profile,formula:null};
        const channels=this.state.view==='top'?['far','near']:['upper','lower'];
        const half=(this.state.view==='top'?profile.depth:profile.height)/2;
        for(const channel of channels){
          const sign=channel==='lower'||channel==='near'?-1:1;
          for(let index=0;index<profile.stations.length;index++){
            const point=getShapePoint(previewProfile,index,channel);
            handles.push({x:(point.t-.5)*profile.length,y:sign*point.reach*half,index,channel,linked:getShapePairLinked(previewProfile,index,this.state.view==='top'?'depth':'outline')});
          }
          curves.push({channel,points:[]});
        }
        const count=Math.max(80,Math.min(192,profile.segments*2));
        const samples=[...new Set([...Array.from({length:count+1},(_,i)=>i/count),...profile.stations.map(station=>station.t)])].sort((a,b)=>a-b);
        for(const u of samples){
          const sampled=sampleShapePoints(previewProfile,u);
          for(const curve of curves){const point=sampled[curve.channel],sign=curve.channel==='lower'||curve.channel==='near'?-1:1;curve.points.push({x:(point.t-.5)*profile.length,y:sign*point.reach*half,u});}
        }
        for(const curve of curves)for(let i=0;i<curve.points.length-1;i++){
          const a=curve.points[i],b=curve.points[i+1];let station=0;
          while(station<profile.stations.length-2&&a.u>=profile.stations[station+1].t-1e-12)station++;
          segments.push({a,b,index:station,nextIndex:station+1,channel:curve.channel});
        }
      }else{
        for(let index=0;index<(sketch.points||[]).length;index++){
          const point=sketch.points[index];if(finite(point.x)&&finite(point.y))handles.push({...copyPoint(point),index});
        }
        curves.push({channel:'sketch',points:handles,closed:sketch.closed!==false});
        const count=handles.length-(sketch.closed===false?1:0);
        for(let index=0;index<count;index++){const a=handles[index],b=handles[(index+1)%handles.length];if(a&&b)segments.push({a,b,index,nextIndex:(index+1)%handles.length});}
      }
    }catch(error){this.emit('onError',error);}
    const points=[...handles,...curves.flatMap(curve=>curve.points)];
    const bounds=points.length?{
      minX:Math.min(...points.map(p=>p.x)),maxX:Math.max(...points.map(p=>p.x)),
      minY:Math.min(...points.map(p=>p.y)),maxY:Math.max(...points.map(p=>p.y))
    }:{minX:-2,maxX:2,minY:-1,maxY:1};
    if(this.isRevolve()){bounds.minX=Math.min(0,bounds.minX);bounds.maxX=Math.max(0,bounds.maxX);}
    this.geometry={handles,curves,segments,bounds};
  }

  resize(){
    if(this.destroyed)return;
    const rect=this.canvas.getBoundingClientRect();
    this.width=Math.max(0,rect.width);this.height=Math.max(0,rect.height);
    this.dpr=clamp(globalThis.devicePixelRatio||1,1,3);
    if(!this.width||!this.height)return;
    const width=Math.max(1,Math.round(this.width*this.dpr)),height=Math.max(1,Math.round(this.height*this.dpr));
    if(this.canvas.width!==width)this.canvas.width=width;
    if(this.canvas.height!==height)this.canvas.height=height;
    if(this.needsFit)this.fit();else this.render();
  }

  fit(){
    if(!this.width||!this.height){this.needsFit=true;return;}
    let {minX,maxX,minY,maxY}=this.geometry.bounds;
    for(const point of this.state.drawPoints){minX=Math.min(minX,point.x);maxX=Math.max(maxX,point.x);minY=Math.min(minY,point.y);maxY=Math.max(maxY,point.y);}
    const w=Math.max(.1,maxX-minX),h=Math.max(.1,maxY-minY);
    // The compact split editor has less height than the standalone sketch pane.
    // Keep room for its labels without shrinking the drawing to a thumbnail.
    const verticalPadding=clamp(this.height*.22,48,112);
    this.camera={x:(minX+maxX)/2,y:(minY+maxY)/2,scale:clamp(Math.min(Math.max(40,this.width-104)/w,Math.max(40,this.height-verticalPadding)/h)*.9,.01,1e6)};
    this.needsFit=false;this.render();
  }

  zoomBy(factor,anchor={x:this.width/2,y:this.height/2}){
    if(!finite(factor)||factor<=0)return;
    const before=this.toModel(anchor);this.camera.scale=clamp(this.camera.scale*factor,.01,1e6);
    const after=this.toModel(anchor);this.camera.x+=before.x-after.x;this.camera.y+=before.y-after.y;
    this.render();
  }
  setReference(image,options={}){this.reference=image||null;this.referenceOptions={opacity:.28,scale:1,...options};this.render();}
  toScreen(point){return {x:this.width/2+(point.x-this.camera.x)*this.camera.scale,y:this.height/2-(point.y-this.camera.y)*this.camera.scale};}
  toModel(point){return {x:this.camera.x+(point.x-this.width/2)/this.camera.scale,y:this.camera.y-(point.y-this.height/2)/this.camera.scale};}
  eventPoint(event){const rect=this.canvas.getBoundingClientRect();return {x:event.clientX-rect.left,y:event.clientY-rect.top};}
  selectedPoint(){return this.state.selected?.edge?null:this.geometry.handles.find(point=>sameSelection(point,this.state.selected));}
  edgeShape(selection){
    if(!selection)return null;
    const segments=this.geometry.segments.filter(segment=>segment.index===selection.index&&segment.channel===selection.channel);
    if(!segments.length)return null;
    const middle=segments[Math.floor(segments.length/2)],point={x:(middle.a.x+middle.b.x)/2,y:(middle.a.y+middle.b.y)/2};
    return {point,points:[segments[0].a,...segments.map(segment=>segment.b)],index:segments[0].index,nextIndex:segments[0].nextIndex,channel:segments[0].channel};
  }
  emitGesture(phase,drag,point,cancelled=false){
    this.emit('onGesture',{phase,point:copyPoint(point),selection:drag.selection,cancelled,...(drag.selection.edge?{delta:{x:point.x-drag.initial.x,y:point.y-drag.initial.y}}:{})});
  }

  nearestHandle(screen,excluded=null){
    let nearest=null,distance=12;
    for(const point of this.geometry.handles){
      if(excluded&&point.channel===excluded.channel&&(point.index===excluded.index||(excluded.edge&&point.index===excluded.nextIndex)))continue;
      const d=pointDistance(screen,this.toScreen(point));
      // Coincident pointed ends remain selectable on either side of the centre line.
      const signPreferred=(point.channel==='lower'||point.channel==='near')===(this.toModel(screen).y<0);
      if(d<distance-1e-5 || (nearest&&Math.abs(d-distance)<1e-5&&signPreferred)) {nearest=point;distance=d;}
    }
    return nearest?{point:nearest,distance}:null;
  }
  nearestEdge(model,{exclude=null}={}){
    let nearest=null,distance=Infinity;
    for(const segment of this.geometry.segments){
      if(exclude&&segment.channel===exclude.channel){
        const count=this.isProfile()?this.profile().stations.length:this.geometry.handles.length;
        const previous=(exclude.index-1+count)%count;
        if(segment.index===exclude.index||segment.index===previous||(exclude.edge&&segment.index===exclude.nextIndex))continue;
      }
      const point=nearestOnSegment(model,segment.a,segment.b),d=pointDistance(model,point)*this.camera.scale;
      if(d<distance){distance=d;nearest={...point,segmentIndex:segment.index,nextIndex:segment.nextIndex,channel:segment.channel,distance:d};}
    }
    return nearest;
  }

  snapPoint(model,event={},exclude=null){
    const point=copyPoint(model),screen=this.toScreen(point);
    if(this.state.snap&&!event.altKey){
      const handle=this.nearestHandle(screen,exclude);
      if(handle)return {...copyPoint(handle.point),kind:'point',index:handle.point.index,channel:handle.point.channel};
      const edge=this.nearestEdge(point,{exclude});
      if(edge&&edge.distance<7)return {...copyPoint(edge),kind:'edge',segmentIndex:edge.segmentIndex,channel:edge.channel};
      const step=this.state.gridStep;
      point.x=Math.round(point.x/step)*step;point.y=Math.round(point.y/step)*step;
      if(this.isRevolve())point.x=Math.max(0,point.x);
      return {...point,kind:'grid'};
    }
    if(this.isRevolve())point.x=Math.max(0,point.x);
    return {...point,kind:'free'};
  }

  pointerDown(event){
    if(this.destroyed||!this.width||!this.height||event.isPrimary===false)return;
    if(this.drag){event.preventDefault();return;}
    this.canvas.focus({preventScroll:true});
    const screen=this.eventPoint(event),model=this.toModel(screen);
    const panning=event.button===1||event.button===2||this.space||this.state.tool==='pan';
    if(panning){
      event.preventDefault();this.drag={type:'pan',pointerId:event.pointerId,start:screen,camera:{...this.camera}};
      this.canvas.setPointerCapture?.(event.pointerId);this.updateCursor();return;
    }
    if(event.button!==0)return;
    event.preventDefault();
    if(this.state.tool==='draw'){
      const first=this.state.drawPoints[0];
      if(first&&this.state.drawPoints.length>=3&&pointDistance(screen,this.toScreen(first))<13){this.emit('onClose');return;}
      const snapped=this.snapPoint(model,event);this.hover={...snapped,screen};this.emit('onDrawPoint',copyPoint(snapped));this.render();return;
    }
    if(this.state.tool==='insert'){
      if(this.state.part?.locked){this.announce('This part is locked. Unlock it to edit its points.');return;}
      const nearest=this.nearestEdge(model),point=nearest?copyPoint(nearest):copyPoint(model);
      const profile=this.profile();this.emit('onInsert',{point,segmentIndex:nearest?.segmentIndex,t:profile?clamp(point.x/profile.length+.5,0,1):nearest?.t});return;
    }
    const handle=this.nearestHandle(screen),edge=handle?null:this.nearestEdge(model);
    if(!handle&&(!edge||edge.distance>9)){this.emit('onSelect',null);this.hover={...this.snapPoint(model,event),screen};this.render();return;}
    const selected=handle?{index:handle.point.index,...(handle.point.channel?{channel:handle.point.channel}:{})}:{index:edge.segmentIndex,nextIndex:edge.nextIndex,edge:true,...(edge.channel?{channel:edge.channel}:{})};
    const initial=handle?handle.point:edge;
    this.emit('onSelect',selected);
    if(this.state.part?.locked){this.announce('This part is locked. Unlock it to edit its points.');return;}
    this.drag={type:handle?'point':'edge',pointerId:event.pointerId,selection:selected,initial:copyPoint(initial),last:copyPoint(initial),start:screen,offset:{x:initial.x-model.x,y:initial.y-model.y},moved:false};
    this.canvas.setPointerCapture?.(event.pointerId);
    this.emitGesture('begin',this.drag,initial);
    this.updateCursor();this.render();
  }

  pointerMove(event){
    if(this.destroyed||!this.width||!this.height)return;
    const screen=this.eventPoint(event),model=this.toModel(screen);
    if(this.drag&&event.pointerId!==this.drag.pointerId)return;
    if(this.drag?.type==='pan'){
      this.camera.x=this.drag.camera.x-(screen.x-this.drag.start.x)/this.camera.scale;
      this.camera.y=this.drag.camera.y+(screen.y-this.drag.start.y)/this.camera.scale;
      this.hover=null;this.render();return;
    }
    if(this.drag?.type==='point'||this.drag?.type==='edge'){
      if(!this.drag.moved&&pointDistance(screen,this.drag.start)<1)return;
      this.drag.moved=true;
      const target={x:model.x+this.drag.offset.x,y:model.y+this.drag.offset.y};
      const snapped=this.snapPoint(target,event,this.drag.selection);
      this.drag.last=copyPoint(snapped);this.hover={...snapped,screen};
      this.emitGesture('update',this.drag,snapped);
    }else{
      const snapped=this.snapPoint(model,event);this.hover={...snapped,screen};
      // Selection targets stay visible when movement snapping is switched off.
      if(this.state.tool==='select'||this.state.tool==='insert'){
        const handle=this.nearestHandle(screen),edge=handle?null:this.nearestEdge(model);
        if(handle)this.hover={...copyPoint(handle.point),kind:'point',index:handle.point.index,channel:handle.point.channel,screen};
        else if(edge&&edge.distance<9)this.hover={...copyPoint(edge),kind:'edge',segmentIndex:edge.segmentIndex,channel:edge.channel,screen};
      }
      const first=this.state.drawPoints[0];
      if(this.state.tool==='draw'&&first&&this.state.drawPoints.length>=3&&pointDistance(screen,this.toScreen(first))<13)this.hover={...copyPoint(first),kind:'close',screen};
    }
    this.announce(`${this.hover.kind==='close'?'Close outline':`${this.hover.kind} ${this.state.snap&&!event.altKey?'snap':'target'}`} · x ${readable(this.hover.x)} · ${this.isProfile()&&this.state.view==='top'?'z':'y'} ${readable(this.hover.y)}`);
    this.updateCursor();this.render();
  }

  pointerUp(event){
    if(!this.drag||event.pointerId!==this.drag.pointerId)return;
    const drag=this.drag;this.drag=null;
    if(this.canvas.hasPointerCapture?.(event.pointerId))this.canvas.releasePointerCapture(event.pointerId);
    if(drag.type==='point'||drag.type==='edge')this.emitGesture('end',drag,drag.last);
    this.updateCursor();this.render();
  }
  cancelGesture(){
    const drag=this.drag;if(!drag)return;
    this.drag=null;
    if(this.canvas.hasPointerCapture?.(drag.pointerId))this.canvas.releasePointerCapture(drag.pointerId);
    if(drag.type==='point'||drag.type==='edge')this.emitGesture('end',drag,drag.initial,true);
    else if(drag.type==='pan')this.camera={...drag.camera};
    this.updateCursor();this.render();
  }
  doubleClick(event){
    if(this.state.part?.locked||this.state.tool!=='select'||this.nearestHandle(this.eventPoint(event)))return;
    event.preventDefault();const point=this.toModel(this.eventPoint(event)),nearest=this.nearestEdge(point);
    if(!nearest||nearest.distance>16)return;
    const profile=this.profile();this.emit('onInsert',{point:copyPoint(nearest),segmentIndex:nearest.segmentIndex,t:profile?clamp(nearest.x/profile.length+.5,0,1):nearest.t});
  }
  wheel(event){if(event.ctrlKey||event.metaKey)return;event.preventDefault();if(this.drag)return;this.zoomBy(Math.exp(-clamp(event.deltaY,-200,200)*.0018),this.eventPoint(event));}

  keyDown(event){
    if(event.target!==this.canvas)return;
    if(event.code==='Space'){event.preventDefault();this.space=true;this.updateCursor();return;}
    if(event.key==='Escape'&&this.drag){event.preventDefault();event.stopPropagation();this.cancelGesture();return;}
    if(event.ctrlKey||event.metaKey)return;
    if(event.key==='Home'||event.key==='0'){event.preventDefault();event.stopPropagation();this.fit();return;}
    if(event.key==='+'||event.key==='='){event.preventDefault();this.zoomBy(1.2);return;}
    if(event.key==='-'){event.preventDefault();this.zoomBy(1/1.2);return;}
    if(event.key==='Enter'&&this.state.tool==='draw'){event.preventDefault();event.stopPropagation();this.emit('onClose');return;}
    if((event.key==='Delete'||event.key==='Backspace')&&this.state.selected&&!this.state.part?.locked){event.preventDefault();event.stopPropagation();this.emit('onDelete',this.state.selected);return;}
    const delta={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,1],ArrowDown:[0,-1]}[event.key];
    const selected=this.state.selected?.edge?this.edgeShape(this.state.selected)?.point:this.selectedPoint();
    if(delta&&selected&&!this.state.part?.locked){
      event.preventDefault();event.stopPropagation();const step=this.state.gridStep*(event.shiftKey?10:event.altKey?.1:1);
      const selection={...this.state.selected},point={x:selected.x+delta[0]*step,y:selected.y+delta[1]*step};
      if(this.isRevolve())point.x=Math.max(0,point.x);
      const gesture={selection,initial:selected};
      this.emitGesture('begin',gesture,selected);
      this.emitGesture('update',gesture,point);
      this.emitGesture('end',gesture,point);
    }
  }
  updateCursor(){this.canvas.style.cursor=this.drag?'grabbing':this.space||this.state.tool==='pan'?'grab':this.state.tool==='draw'||this.state.tool==='insert'?'crosshair':this.hover?.kind==='point'||this.hover?.kind==='edge'?(this.state.part?.locked?'not-allowed':this.hover.kind==='edge'?'grab':'pointer'):'default';}

  line(points,{colour='#67e8cf',width=1.7,dash=[],close=false,fill=null}={}){
    if(!points.length)return;const ctx=this.context;ctx.beginPath();points.forEach((point,index)=>{const screen=this.toScreen(point);if(index)ctx.lineTo(screen.x,screen.y);else ctx.moveTo(screen.x,screen.y);});if(close)ctx.closePath();
    if(fill){ctx.fillStyle=fill;ctx.fill();}ctx.strokeStyle=colour;ctx.lineWidth=width;ctx.setLineDash(dash);ctx.stroke();ctx.setLineDash([]);
  }
  circle(point,radius,fill,stroke,width=1){const ctx=this.context,screen=this.toScreen(point);ctx.beginPath();ctx.arc(screen.x,screen.y,radius,0,Math.PI*2);if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=width;ctx.stroke();}}
  label(text,x,y,{colour='#9eb2c3',background=false}={}){
    const ctx=this.context;ctx.font='11px ui-monospace, SFMono-Regular, Consolas, monospace';const width=ctx.measureText(text).width;
    if(background){ctx.fillStyle='rgba(9,17,24,.92)';ctx.fillRect(x-5,y-12,width+10,18);}ctx.fillStyle=colour;ctx.fillText(text,x,y);
  }

  renderGrid(){
    const ctx=this.context,scale=this.camera.scale,lower=this.toModel({x:0,y:this.height}),upper=this.toModel({x:this.width,y:0});
    let step=this.state.gridStep;
    while(step*scale<18)step*=5;while(step*scale>120)step/=2;
    const firstX=Math.ceil(lower.x/step),lastX=Math.floor(upper.x/step),firstY=Math.ceil(lower.y/step),lastY=Math.floor(upper.y/step);
    ctx.lineWidth=1;
    for(let i=firstX;i<=lastX&&i-firstX<1000;i++){
      const x=this.toScreen({x:i*step,y:0}).x;ctx.strokeStyle=i%5===0?'#243443':'#1a2733';ctx.beginPath();ctx.moveTo(Math.round(x)+.5,0);ctx.lineTo(Math.round(x)+.5,this.height);ctx.stroke();
      if(i%5===0&&x>35&&x<this.width-35)this.label(readable(i*step),x+4,this.height-11,{colour:'#637a8e'});
    }
    for(let i=firstY;i<=lastY&&i-firstY<1000;i++){
      const y=this.toScreen({x:0,y:i*step}).y;ctx.strokeStyle=i%5===0?'#243443':'#1a2733';ctx.beginPath();ctx.moveTo(0,Math.round(y)+.5);ctx.lineTo(this.width,Math.round(y)+.5);ctx.stroke();
      if(i%5===0&&y>40&&y<this.height-32)this.label(readable(i*step),8,y-5,{colour:'#637a8e'});
    }
    const origin=this.toScreen({x:0,y:0});
    ctx.strokeStyle=this.isRevolve()?'#c99658':'#4a6b81';ctx.setLineDash(this.isRevolve()?[7,5]:[]);
    ctx.beginPath();ctx.moveTo(origin.x,0);ctx.lineTo(origin.x,this.height);ctx.stroke();ctx.setLineDash([]);
    ctx.strokeStyle='#42605b';ctx.beginPath();ctx.moveTo(0,origin.y);ctx.lineTo(this.width,origin.y);ctx.stroke();
    if(this.isRevolve()&&origin.x>0&&origin.x<this.width)this.label('REVOLUTION AXIS',origin.x+8,48,{colour:'#d7b684',background:true});
    this.label(this.isRevolve()?'radius →':'x →',this.width-70,clamp(origin.y-8,48,this.height-30),{colour:'#92b5ad'});
  }

  renderReference(){
    if(!this.reference)return;
    const image=this.reference,iw=image.naturalWidth||image.width,ih=image.naturalHeight||image.height;if(!iw||!ih)return;
    const bounds=this.geometry.bounds,worldWidth=Math.max(.1,bounds.maxX-bounds.minX)*(this.referenceOptions.scale||1),worldHeight=worldWidth*ih/iw;
    const centre={x:this.referenceOptions.x??(bounds.minX+bounds.maxX)/2,y:this.referenceOptions.y??(bounds.minY+bounds.maxY)/2};
    const screen=this.toScreen({x:centre.x-worldWidth/2,y:centre.y+worldHeight/2}),ctx=this.context;
    ctx.save();ctx.globalAlpha=clamp(this.referenceOptions.opacity??.28,0,1);
    try{ctx.drawImage(image,screen.x,screen.y,worldWidth*this.camera.scale,worldHeight*this.camera.scale);}catch{/* An image that is still decoding will appear on the next redraw. */}ctx.restore();
  }

  render(){
    if(this.destroyed||!this.width||!this.height)return;
    const ctx=this.context;ctx.setTransform(this.dpr,0,0,this.dpr,0,0);ctx.clearRect(0,0,this.width,this.height);ctx.fillStyle='#101923';ctx.fillRect(0,0,this.width,this.height);
    this.renderGrid();this.renderReference();
    const {handles,curves}=this.geometry;
    if(this.isProfile()&&curves.length===2){
      this.line([...curves[0].points,...curves[1].points.slice().reverse()],{close:true,fill:'rgba(75,176,170,.11)',colour:'rgba(103,232,207,.1)',width:1});
      const count=handles.length/2;
      for(let i=0;i<count;i++){
        const a=handles[i],b=handles[i+count];
        if(a.linked)this.line([a,b],{colour:this.state.selected?.index===a.index?'rgba(225,209,137,.7)':'rgba(107,150,169,.38)',width:1,dash:[3,5]});
      }
      for(const curve of curves)this.line(curve.points,{colour:colours[curve.channel],width:2});
    }else{
      for(const curve of curves)this.line(curve.points,{colour:colours.sketch,width:2,close:curve.closed,fill:curve.closed?'rgba(75,176,170,.13)':null});
      if(this.isRevolve()&&curves[0]?.points.length){
        const reflected=curves[0].points.map(point=>({x:-point.x,y:point.y}));
        this.line(reflected,{colour:'rgba(131,170,187,.38)',width:1,dash:[4,5],close:curves[0].closed,fill:curves[0].closed?'rgba(90,135,155,.04)':null});
      }
    }
    if(this.state.selected?.edge){
      const edge=this.edgeShape(this.state.selected);
      if(edge){this.line(edge.points,{colour:'#f4df95',width:4});const screen=this.toScreen(edge.point);this.label(`Edge ${edge.index+1}–${edge.nextIndex+1}`,screen.x+12,screen.y-12,{colour:'#fff0b1',background:true});}
    }
    for(const point of handles){
      const selected=!this.state.selected?.edge&&sameSelection(point,this.state.selected),edgeEndpoint=this.state.selected?.edge&&point.channel===this.state.selected.channel&&(point.index===this.state.selected.index||point.index===this.state.selected.nextIndex),colour=colours[point.channel]||colours.sketch;
      if(edgeEndpoint)this.circle(point,8,null,'#f4df95',1.5);
      this.circle(point,selected?7:4.5,selected?'#f4df95':'#101923',selected?'#fff0b1':colour,selected?2:1.6);
      if(selected){const screen=this.toScreen(point);this.label(`${point.index+1}${point.channel?` · ${point.channel}`:''}`,screen.x+12,screen.y-12,{colour:'#fff0b1',background:true});}
    }
    const drawing=this.state.drawPoints;
    if(drawing.length){
      this.line(drawing,{colour:'#f1cf80',width:2});
      if(drawing.length>=3)this.line(drawing,{colour:'rgba(241,207,128,.28)',close:true,fill:'rgba(241,207,128,.06)',dash:[3,5],width:1});
      drawing.forEach((point,index)=>{this.circle(point,index===0?6:4,'#263242','#f1cf80',1.5);const screen=this.toScreen(point);this.label(String(index+1),screen.x+9,screen.y-8,{colour:'#f1cf80',background:true});});
      if(this.hover&&this.state.tool==='draw')this.line([drawing.at(-1),this.hover],{colour:'#f1cf80',width:1.5,dash:[5,4]});
    }
    if(this.hover&&!this.space&&this.state.tool!=='pan'&&this.drag?.type!=='pan'){
      const screen=this.toScreen(this.hover),colour=this.hover.kind==='close'?'#f4df95':this.hover.kind==='free'?'#b3c4d2':'#f1cf80';
      ctx.strokeStyle=colour;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(screen.x-11,screen.y);ctx.lineTo(screen.x-5,screen.y);ctx.moveTo(screen.x+5,screen.y);ctx.lineTo(screen.x+11,screen.y);ctx.moveTo(screen.x,screen.y-11);ctx.lineTo(screen.x,screen.y-5);ctx.moveTo(screen.x,screen.y+5);ctx.lineTo(screen.x,screen.y+11);ctx.stroke();
      this.circle(this.hover,this.hover.kind==='close'?10:3,null,colour,1.3);
      if(this.hover.kind==='edge'){const edge=this.edgeShape({index:this.hover.segmentIndex,channel:this.hover.channel});if(edge)this.line(edge.points,{colour:'#f1cf80',width:3});}
      const text=this.hover.kind==='close'?'Click to close':`${this.hover.kind} · ${readable(this.hover.x)}, ${readable(this.hover.y)}`;
      const textWidth=ctx.measureText(text).width;this.label(text,clamp(screen.x+16,8,this.width-textWidth-12),clamp(screen.y+23,44,this.height-34),{colour,background:true});
    }
    const title=this.isProfile()?(this.state.view==='top'?'TOP PROFILE · X / Z':'SIDE PROFILE · X / Y'):this.isRevolve()?'REVOLVE SKETCH · RADIUS / HEIGHT':'EXTRUDE SKETCH · X / Y';
    this.label(title+(this.state.part?.locked?' · LOCKED':''),14,23,{colour:'#b7ccdb',background:true});
    const scaleText=`grid ${readable(this.state.gridStep)} · ${this.state.snap?'snap on':'snap off'}`;
    this.label(scaleText,this.width-ctx.measureText(scaleText).width-15,this.width<580?this.height-31:23,{colour:'#86a5b8',background:true});
    if(!this.state.part&&!drawing.length)this.label('Choose a shape or draw a new outline.',Math.max(18,this.width/2-130),this.height/2,{colour:'#b7ccdb',background:true});
  }

  getState(){return {view:this.state.view,tool:this.state.tool,selected:this.state.selected?{...this.state.selected}:null,points:this.geometry.handles.length,edges:[...new Map(this.geometry.segments.map(segment=>[`${segment.channel||'sketch'}:${segment.index}`,segment])).values()].map(segment=>{const edge=this.edgeShape(segment);return {index:edge.index,nextIndex:edge.nextIndex,channel:edge.channel,point:copyPoint(edge.point),screen:this.toScreen(edge.point)};}),handles:this.geometry.handles.map(point=>({...copyPoint(point),index:point.index,channel:point.channel,linked:point.linked,screen:this.toScreen(point)})),drawPoints:this.state.drawPoints.length,drawing:this.state.drawPoints.map(point=>({...copyPoint(point),screen:this.toScreen(point)})),dragging:this.drag?.type||null,snap:this.state.snap,camera:{...this.camera},size:{width:this.width,height:this.height,dpr:this.dpr},hover:this.hover?{x:this.hover.x,y:this.hover.y,kind:this.hover.kind}:null};}
  destroy(){if(this.destroyed)return;this.cancelGesture();this.destroyed=true;this.observer?.disconnect();for(const remove of this.listeners)remove();this.listeners=[];this.reference=null;this.callbacks={};}
}
