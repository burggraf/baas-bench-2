import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { initClient } from 'trailbase';
import { conformance } from '../tests/conformance.js';

const baseUrl = process.env.BASE_URL ?? 'http://127.0.0.1:4000';
let checks = 0;
await conformance(() => initClient(baseUrl), `node${randomUUID().replaceAll('-', '').slice(0, 20)}`, randomUUID(), (condition, label) => {
  assert.ok(condition, label);
  checks++;
});
console.log(`Native SDK conformance passed: ${checks} checks`);
