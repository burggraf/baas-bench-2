import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { calibrationRows } from './calibration.js';

export function createCalibrationTarget() {
  // Static read-only responses deliberately exclude database, authorization and mutation costs.
  const body=JSON.stringify({records:calibrationRows()});
  return createServer({requestTimeout:10000,headersTimeout:10000,maxHeaderSize:8192},(req,res)=>{
    const url=new URL(req.url,'http://synthetic');
    const list=req.method==='GET' && url.pathname==='/api/records/v1/posts' && url.searchParams.size===2 &&
      url.searchParams.get('limit')==='20' && url.searchParams.get('order')==='-created_at,-id';
    const health=req.method==='GET' && req.url==='/health';
    const allowed=!['authorization','cookie','refresh-token','csrf-token'].some(name=>req.headers[name]) && (list||health);
    res.writeHead(allowed?200:400,{'content-type':'application/json','x-baas-calibration':'synthetic-read-only'});
    res.end(allowed?(health?'{}':body):'{}');
  });
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
  const server=createCalibrationTarget(); server.listen(4000,'0.0.0.0');
  for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{server.close();server.closeAllConnections();});
}
