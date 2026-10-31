export const actions = ['listPublic', 'listOwn', 'read', 'create', 'like', 'unlike', 'edit'];

export function validateConfig(c) {
  const require = (ok, message) => { if (!ok) throw new Error(`Invalid config: ${message}`); };
  const keys = (object, names) => object && typeof object === 'object' &&
    Object.keys(object).length === names.length && names.every(name => Object.hasOwn(object, name));
  const prepared = c?.version === 'social-prepared-v1';
  require(keys(c, ['version', 'seed', 'dataset', 'vus', 'rampSeconds', 'warmupSeconds', 'measurementSeconds', 'pageSize', 'bodyBytes', 'thinkSeconds', 'sessionSeconds', 'weights', ...(prepared ? ['authPreparation'] : [])]), 'unknown/missing fields');
  require(prepared || c.version === 'social-mixed-v1', 'version');
  if (prepared) {
    require(keys(c.authPreparation, ['loginsPerSecond', 'timeoutSeconds']), 'authPreparation fields');
    const { loginsPerSecond, timeoutSeconds } = c.authPreparation;
    require(Number.isFinite(loginsPerSecond) && loginsPerSecond > 0 && Number.isFinite(timeoutSeconds) && timeoutSeconds > 0 && timeoutSeconds <= 3600 && c.vus / loginsPerSecond < timeoutSeconds, 'authPreparation rate/deadline');
  }
  for (const name of ['seed', 'vus', 'pageSize', 'bodyBytes']) require(Number.isSafeInteger(c[name]) && c[name] > 0, name);
  require(c.seed <= 0xffffffff && c.pageSize <= 100 && c.bodyBytes <= 16384, 'seed/page/body bounds');
  for (const name of ['rampSeconds', 'warmupSeconds', 'measurementSeconds']) require(Number.isFinite(c[name]) && c[name] > 0, name);
  for (const name of ['thinkSeconds', 'sessionSeconds']) require(Array.isArray(c[name]) && c[name].length === 2 &&
    c[name].every(n => Number.isFinite(n) && n > 0) && c[name][0] <= c[name][1], name);
  require(keys(c.dataset, ['profile', 'users', 'postsPerUser', 'likesPerUser']), 'dataset fields');
  require(typeof c.dataset.profile === 'string' && /^[a-z][a-z0-9-]{0,40}$/.test(c.dataset.profile), 'dataset profile');
  for (const name of ['users', 'postsPerUser', 'likesPerUser']) require(Number.isSafeInteger(c.dataset[name]) && c.dataset[name] > 0, name);
  require(c.dataset.users >= 2 && c.dataset.users <= 20000 && c.vus <= c.dataset.users, 'distinct identity pool (2–20000)');
  if (['pilot-small', 'social-baseline'].includes(c.dataset.profile)) {
    require(c.dataset.users === (c.dataset.profile === 'pilot-small' ? 1000 : 10000) && c.dataset.postsPerUser === 10 && c.dataset.likesPerUser === 10, 'named dataset profile counts');
  }
  require(c.dataset.postsPerUser <= 100 && c.dataset.likesPerUser <= 100 &&
    c.dataset.likesPerUser <= c.dataset.users * c.dataset.postsPerUser, 'fixture bounds');
  require(keys(c.weights, actions) && actions.every(a => Number.isFinite(c.weights[a]) && c.weights[a] >= 0) &&
    actions.reduce((sum, a) => sum + c.weights[a], 0) === 100, 'weights must total 100');
  return c;
}

export function preparedArguments(args) {
  const candidate = args.find(arg => /^--vus=[1-9]\d*$/.test(arg));
  if (args.length !== 2 || new Set(args).size !== 2 || !args.includes('--prepared-sessions') || !args.every(arg => typeof arg === 'string' && ['--prepared-sessions', '--smoke', candidate].includes(arg))) throw new Error('Usage: --prepared-sessions --smoke | --vus=N');
  return { smoke: args.includes('--smoke'), ...(candidate ? { vus: Number(candidate.slice(6)) } : {}) };
}

export function preparedTokenTiming(claims, loginAtMs) {
  const expiresAtMs = claims.exp * 1000;
  if (!Number.isFinite(claims.exp) || !Number.isFinite(expiresAtMs) || !Number.isFinite(loginAtMs) || loginAtMs <= 0 || expiresAtMs <= loginAtMs ||
      (claims.iat !== undefined && (!Number.isFinite(claims.iat) || claims.iat <= 0 || claims.iat >= claims.exp))) throw new Error('Invalid native token timing');
  // PocketBase omits iat: expiry is authoritative, but native TTL is then unknown.
  return {loginAtMs, expiresAtMs, ttlSeconds:claims.iat === undefined ? null : claims.exp - claims.iat};
}

export function createPreparedClock(wallNow, monotonicNow) {
  let reference, previous = -Infinity;
  const fail = (reason, before, wall, after) => {
    const error = new Error('prepared_clock_inconsistent');
    const finite = value => Number.isFinite(value) ? value : null;
    error.clockEvidence = {reason, wall:finite(wall), monoBefore:finite(before), monoAfter:finite(after), referenceLow:reference?.low ?? null, referenceHigh:reference?.high ?? null};
    throw error;
  };
  const sample = () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = monotonicNow(), wall = wallNow(), after = monotonicNow();
      if (![before,wall,after].every(Number.isFinite) || before < 0 || before < previous || after < before) fail('invalid_clock',before,wall,after);
      previous = after;
      // Discard a preempted read, not clock drift; persistent uncertainty fails closed.
      if (after-before <= 1) return {wall,before,after,low:wall-after,high:wall-before};
      if (attempt === 2) fail('sampling_uncertain',before,wall,after);
    }
  };
  reference = sample();
  return () => {
    const current = sample();
    // Worst-case drift includes sampling uncertainty, never adds it to the 100ms policy.
    if (Math.max(Math.abs(current.low-reference.high),Math.abs(current.high-reference.low)) > 100) fail('clock_drift',current.before,current.wall,current.after);
    return current.wall;
  };
}

export function preparedSchedule(config, releaseAt, ordinal) {
  if (!Number.isFinite(releaseAt) || releaseAt <= 0 || !Number.isSafeInteger(ordinal) || ordinal < 1 || ordinal > config.vus) throw new Error('Invalid prepared schedule');
  return {
    activationAt: releaseAt + (ordinal - 1) / config.vus * config.rampSeconds * 1000,
    measurementAt: releaseAt + (config.rampSeconds + config.warmupSeconds) * 1000,
    endAt: releaseAt + (config.rampSeconds + config.warmupSeconds + config.measurementSeconds) * 1000,
  };
}

// Separate instances for actions, pacing, session lengths, and target selection.
export function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function postFields(config, user, sequence) {
  let seed = config.seed;
  for (const char of `${user}:${sequence}`) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  const rng = random(seed), alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let body = '';
  for (let i = 0; i < config.bodyBytes; i++) body += alphabet[Math.floor(rng() * alphabet.length)];
  return { title: `Post ${user} ${sequence}`.slice(0, 100), body };
}

export function chooseAction(weights, rng) {
  let value = rng() * 100;
  for (const action of actions) { value -= weights[action]; if (value < 0) return action; }
  return actions.at(-1);
}
