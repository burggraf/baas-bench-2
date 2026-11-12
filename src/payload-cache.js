import { postFields } from './workload.js';

// A cache miss changes cost, never the payload recipe or the user's sequence.
export function payloadCachePlan(config, budgetBytes = 64 * 1024 * 1024) {
  if (![64 * 1024 * 1024, 320 * 1024 * 1024, 480 * 1024 * 1024].includes(budgetBytes)) throw new Error('invalid_payload_cache_budget');
  const slotsPerUser = Math.min(32, Math.floor(budgetBytes / (config.vus * config.bodyBytes)));
  return {
    version: budgetBytes === 64 * 1024 * 1024 ? 'deterministic-post-cache-v1' : 'deterministic-post-cache-v2', ...(budgetBytes === 64 * 1024 * 1024 ? {} : { budgetBytes }), seed: config.seed, bodyBytes: config.bodyBytes,
    users: config.vus, firstSequence: config.dataset.postsPerUser + 1, slotsPerUser,
    records: config.vus * slotsPerUser,
  };
}

// Called once inside SharedArray's initializer, not once per VU.
export function validatePayloadTable(table, config, budgetBytes) {
  const plan = payloadCachePlan(config, budgetBytes), recipe = table?.recipe;
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

export function createPayloadLookup(config, rows, budgetBytes) {
  const plan = payloadCachePlan(config, budgetBytes);
  if (rows.length !== plan.records) throw new Error('invalid_payload_cache');
  return (user, sequence) => {
    const slot = sequence - plan.firstSequence;
    if (Number.isSafeInteger(user) && user >= 0 && user < plan.users && Number.isSafeInteger(slot) && slot >= 0 && slot < plan.slotsPerUser) {
      return rows[user * plan.slotsPerUser + slot];
    }
    return postFields(config, user, sequence);
  };
}
