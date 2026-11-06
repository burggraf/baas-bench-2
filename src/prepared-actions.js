// Logical start time is authoritative; metric transport time is separate evidence.
export function preparedActionPhase(config,releaseAt,at) {
  if(!Number.isFinite(at)||at<releaseAt)throw new Error('invalid_action_start');
  if(at<releaseAt+config.rampSeconds*1000)return 'ramp';
  if(at<releaseAt+(config.rampSeconds+config.warmupSeconds)*1000)return 'warmup';
  if(at<releaseAt+(config.rampSeconds+config.warmupSeconds+config.measurementSeconds)*1000)return 'measurement';
  return 'cleanup';
}
