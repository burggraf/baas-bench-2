import { openSync, closeSync, writeSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import { payloadCachePlan } from '../src/payload-cache.js';
import { postFields } from '../src/workload.js';

// Generate outside the measurement, with bounded batches and cancellation points.
export async function writePayloadCache(path, config, signal, budgetBytes) {
  signal?.throwIfAborted();
  const recipe = payloadCachePlan(config, budgetBytes), digest = createHash('sha256'), fd = openSync(path, 'wx', 0o644);
  const write = text => {
    const bytes = Buffer.from(text);
    for (let offset = 0; offset < bytes.length;) offset += writeSync(fd, bytes, offset, bytes.length - offset);
    digest.update(bytes);
  };
  try {
    write(JSON.stringify({ recipe }).slice(0, -1) + ',"rows":[');
    for (let first = 0; first < recipe.records; first += 128) {
      signal?.throwIfAborted();
      const batch = [];
      for (let i = first; i < Math.min(first + 128, recipe.records); i++) {
        batch.push(JSON.stringify(postFields(config, Math.floor(i / recipe.slotsPerUser), recipe.firstSequence + i % recipe.slotsPerUser)));
      }
      write((first ? ',' : '') + batch.join(','));
      await setImmediate();
    }
    signal?.throwIfAborted();
    write(']}\n');
  } finally { closeSync(fd); }
  return { recipe, sha256: digest.digest('hex'), bytes: statSync(path).size };
}
