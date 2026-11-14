// Only untimed final native sign-outs are staggered. Application deadlines never move.
export function cleanupAllowance(config,backend){return ['supabase','convex'].includes(backend)?Math.ceil(config.vus/config.authPreparation.loginsPerSecond):0;}
export function cleanupDelay(config,epoch,ordinal,now,backend){
 if(!['supabase','convex'].includes(backend))return 0;
 const at=epoch+(config.rampSeconds+config.warmupSeconds+config.measurementSeconds)*1000+(ordinal-1)*1000/config.authPreparation.loginsPerSecond;
 return Math.max(0,(at-now)/1000);
}
