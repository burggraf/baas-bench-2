export const actions = ['listPublic', 'listOwn', 'read', 'create', 'like', 'unlike', 'edit'];

export function validateConfig(c) {
  const require = (ok, message) => { if (!ok) throw new Error(`Invalid config: ${message}`); };
  const keys = (object, names) => object && typeof object === 'object' &&
    Object.keys(object).length === names.length && names.every(name => Object.hasOwn(object, name));
  require(keys(c, ['version', 'seed', 'dataset', 'vus', 'rampSeconds', 'warmupSeconds', 'measurementSeconds', 'pageSize', 'bodyBytes', 'thinkSeconds', 'sessionSeconds', 'weights']), 'unknown/missing fields');
  require(c.version === 'social-mixed-v1', 'version');
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
