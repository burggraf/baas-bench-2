import { postFields } from './workload.js';

// A cache miss changes cost, never the payload recipe or the user's sequence.
export function payloadCachePlan(config) {
  const slotsPerUser = Math.min(32, Math.floor(64 * 1024 * 1024 / (config.vus * config.bodyBytes)));
  return {
    version: 'deterministic-post-cache-v1', seed: config.seed, bodyBytes: config.bodyBytes,
    users: config.vus, firstSequence: config.dataset.postsPerUser + 1, slotsPerUser,
    records: config.vus * slotsPerUser,
  };
}

// Called once inside SharedArray's initializer, not once per VU.
export function validatePayloadTable(table, config) {
  const plan = payloadCachePlan(config), recipe = table?.recipe;
  if (!recipe || Object.keys(recipe).length !== Object.keys(plan).length ||
      Object.entries(plan).some(([key, value]) => recipe[key] !== value) ||
      !Array.isArray(table.rows) || table.rows.length !== plan.records) throw new Error('invalid_payload_cache');
  for (let i = 0; i < table.rows.length; i++) {
    const row = table.rows[i], user = Math.floor(i / plan.slotsPerUser), sequence = plan.firstSequence + i % plan.slotsPerUser;
    if (!row || Object.keys(row).length !== 2 || row.title !== `Post ${user} ${sequence}`.slice(0, 100) ||
        typeof row.body !== 'string' || row.body.length !== plan.bodyBytes) throw new Error('invalid_payload_cache');
  }
  return table.rows;
}

export function createPayloadLookup(config, rows) {
  const plan = payloadCachePlan(config);
  if (rows.length !== plan.records) throw new Error('invalid_payload_cache');
  return (user, sequence) => {
    const slot = sequence - plan.firstSequence;
    if (Number.isSafeInteger(user) && user >= 0 && user < plan.users && Number.isSafeInteger(slot) && slot >= 0 && slot < plan.slotsPerUser) {
      return rows[user * plan.slotsPerUser + slot];
    }
    return postFields(config, user, sequence);
  };
}
