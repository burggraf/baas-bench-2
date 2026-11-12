import crypto from 'k6/crypto';
import { SharedArray } from 'k6/data';
import { createPayloadLookup, validatePayloadTable } from '../payload-cache.js';

export function loadPayloadCache(config, digest, budgetBytes) {
  return createPayloadLookup(config, new SharedArray('post payloads', () => {
    const bytes = open('/config/payload-cache.json');
    if (!/^[a-f0-9]{64}$/.test(digest ?? '') || crypto.sha256(bytes, 'hex') !== digest) throw new Error('invalid_payload_cache_hash');
    return validatePayloadTable(JSON.parse(bytes), config, budgetBytes);
  }), budgetBytes);
}
