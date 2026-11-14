import {predictionProxy} from './skeleton-proxy-kernel.mjs';
self.onmessage=({data})=>{
 try {self.postMessage({result:predictionProxy(data,(message,fraction)=>self.postMessage({progress:{message,fraction}}))});}
 catch(error){self.postMessage({error:error.message});}
};
