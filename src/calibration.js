import { postFields } from './workload.js';

export function calibrationPlan(args) {
  if(new Set(args).size!==args.length || args.some(arg=>!['--smoke','--compare-vus'].includes(arg)))throw new Error('Usage: node scripts/calibrate.js [--smoke] [--compare-vus]');
  const smoke=args.includes('--smoke'),compareVus=args.includes('--compare-vus');
  return {smoke,compareVus,rates:smoke?[10,40]:[25,100,400,1600],seconds:smoke?6:20,warmup:smoke?2:5,allocations:compareVus?[32,128]:[32]};
}

export function calibrationRows() {
  return Array.from({ length: 20 }, (_, i) => ({ id: `synthetic-${19-i}`, author: 'synthetic-author', ...postFields({seed:20261020,bodyBytes:1024},0,19-i), created_at:19-i, updated_at:19-i }));
}

export function summarizeCalibration(summary, rate, seconds, resources) {
  const m=summary?.metrics ?? {}, started=m.calibration_started?.count, completed=m.calibration_completed?.count;
  const dropped=m['dropped_iterations{scenario:measure}']?.count, failed=m.calibration_failed?.value;
  const logicalP95=m.calibration_ms?.['p(95)'], nonHttpP95=m.calibration_non_http_ms?.['p(95)'];
  const valid=resources?.valid === true && [started,completed,dropped].every(n=>Number.isSafeInteger(n)&&n>=0) &&
    started>0 && completed===started && failed===0 && [logicalP95,nonHttpP95].every(n=>Number.isFinite(n)&&n>=0);
  return { valid, certified:false, generatorHeadroom:'unverified', offeredPerSecond:rate, seconds, expectedIterations:rate*seconds,
    started:started ?? null, completed:completed ?? null, dropped:dropped ?? null, achievedPerSecond:Number.isFinite(completed)?completed/seconds:null,
    rateDelivered:valid && dropped===0 && Math.abs(started-rate*seconds)<=1,
    logicalP95Ms:logicalP95 ?? null, nonHttpP95Ms:nonHttpP95 ?? null, tailEvidence:completed>=1000?'descriptive_only':'insufficient_samples' };
}

export function assertCalibrationContainer(state, run, image) {
  const labels=state?.Config?.Labels ?? {};
  if (!/^calibration-[A-Za-z0-9]{6}$/.test(run) || !/^[a-f0-9]{64}$/.test(state?.Id ?? '') || state.Image!==image ||
      labels['com.docker.compose.project']!=='baas-bench-2-calibration' || !['target','runner'].includes(labels['com.docker.compose.service']) ||
      !(labels['baas-bench-2.run']===run || [10,25,40,100,400,1600].some(rate=>labels['baas-bench-2.run']===`${run}-${rate}` || [32,128].some(vus=>labels['baas-bench-2.run']===`${run}-${rate}-vu${vus}`))) ||
      !Array.isArray(state.Mounts) || state.Mounts.some(m=>m.Type==='volume')) throw new Error('Refuse unowned/persistent calibration container');
}
