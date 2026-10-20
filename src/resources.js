const integer = text => /^\d+$/.test(text ?? '') && Number.isSafeInteger(Number(text)) ? Number(text) : null;

export function parseCgroup(source) {
  const files = Object.fromEntries([...source.matchAll(/\[([^\]]+)\]\n([^[]*)/g)].map(([, name, body]) => [name, body.trim()]));
  const counters = name => Object.fromEntries((files[name] ?? '').split('\n').flatMap(line => {
    const [key, value] = line.trim().split(/\s+/);
    return integer(value) === null ? [] : [[key, integer(value)]];
  }));
  return { cpuStat: counters('cpu.stat'), memoryEvents: counters('memory.events'), memoryCurrentBytes: integer(files['memory.current']), memoryPeakBytes: integer(files['memory.peak']) };
}

export function summarizeResources(records) {
  const issues = [];
  const containers = {};
  if (records.some(r => r.type === 'error')) issues.push('collector_error');
  for (const role of ['backend', 'runner']) {
    const rows = records.filter(r => r.role === role);
    const life = rows.filter(r => r.type === 'lifecycle');
    const stats = rows.filter(r => r.type === 'stats');
    const groups = rows.filter(r => r.type === 'cgroup').map(r => parseCgroup(r.source));
    const first = life[0]?.source, last = life.at(-1)?.source;
    const cpus = stats.map(r => /^\d+(\.\d+)?%$/.test(r.source.CPUPerc) ? parseFloat(r.source.CPUPerc) / 100 : null);
    const complete = life.length >= 2 && stats.length >= 2 && groups.length >= 2 &&
      cpus.every(n => n !== null && Number.isFinite(n)) &&
      rows.every(r => Number.isFinite(r.elapsedMs) && r.elapsedMs >= 0) &&
      groups.every(g => g.memoryCurrentBytes !== null && Number.isSafeInteger(g.cpuStat.usage_usec) && Number.isSafeInteger(g.memoryEvents.oom_kill));
    const times = [life[0]?.elapsedMs, ...stats.map(r => r.elapsedMs), Math.max(life.at(-1)?.elapsedMs ?? 0, stats.at(-1)?.elapsedMs ?? 0)];
    // Five seconds is an evidence-gap guard, not a utilization/headroom threshold.
    const covered = times.every((t, i) => Number.isFinite(t) && (!i || (t >= times[i - 1] && t - times[i - 1] <= 5000)));
    if (!complete || !covered) issues.push(`${role}:incomplete_samples`);
    const changed = life.some(r => ['id', 'startedAt', 'restarts', 'nanoCpus', 'cpuQuota', 'cpuPeriod', 'cpuset', 'memoryLimit', 'memorySwap'].some(key => r.source[key] !== first[key]));
    const unstable = life.some(r => r.source.oomKilled || (role === 'backend' && (!r.source.running || r.source.health !== 'healthy'))) || changed;
    const delta = (key, field) => {
      const values = groups.map(g => g[key]?.[field]);
      if (values.length < 2 || values.some(v => !Number.isSafeInteger(v))) return null;
      if (values.some((v, i) => i && v < values[i - 1])) { issues.push(`${role}:counter_reset:${field}`); return null; }
      return values.at(-1) - values[0];
    };
    const oomKillDelta = delta('memoryEvents', 'oom_kill');
    const oomDelta = delta('memoryEvents', 'oom');
    const throttledUsecDelta = delta('cpuStat', 'throttled_usec');
    delta('cpuStat', 'usage_usec');
    if (unstable || oomKillDelta > 0 || oomDelta > 0) issues.push(`${role}:instability`);
    if (role === 'runner' && (first?.status !== 'running' || last?.status !== 'exited' || ![0, 99].includes(last?.exitCode))) issues.push('runner:missing_clean_exit');
    const memory = groups.map(g => g.memoryCurrentBytes).filter(v => v !== null);
    const peaks = groups.map(g => g.memoryPeakBytes).filter(v => v !== null);
    containers[role] = {
      statsSamples: stats.length, lifecycleSamples: life.length, cgroupSamples: groups.length,
      peakCpuCores: cpus.length && cpus.every(n => n !== null) ? Math.max(...cpus) : null,
      peakMemoryBytes: memory.length ? Math.max(...memory) : null,
      cgroupLifetimePeakMemoryBytes: peaks.length ? Math.max(...peaks) : null,
      oomKillDelta, oomDelta, throttledUsecDelta, first: first ?? null, last: last ?? null,
    };
  }
  return {
    valid: !issues.length, stability: issues.length ? 'invalid_or_incomplete' : 'no_instability_observed',
    generatorHeadroom: 'unverified', runnerOutcome: containers.runner.last?.exitCode === 99 ? 'thresholds_failed' : containers.runner.last?.exitCode === 0 ? 'completed' : 'unknown_or_failed', containers, issues: [...new Set(issues)],
    limitations: ['Utilization samples do not prove generator headroom; calibration and larger/separate-runner confirmation remain required.', 'Collection spans startup, warm-up, measurement and k6 cleanup; peaks are not measurement-only.', 'Docker CPU 100% means one core; cgroup memory includes cache. Lifetime peaks may predate this run.', 'Host/VM contention, socket pressure, thermal state and monitoring overhead are not calibrated.'],
  };
}
