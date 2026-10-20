import assert from 'node:assert/strict';
import test from 'node:test';
import { createAtob } from '../src/base64.js';

test('k6 atob compatibility pads raw JWT/ID payloads before using strict std decoder', () => {
  const decode = createAtob((value, format) => {
    assert.equal(format, 'std');
    assert.equal(value.length % 4, 0);
    const bytes = Buffer.from(value, 'base64');
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  });
  for (const text of ['a', 'ab', 'abc', '{"exp":2000,"iat":1000}', '\u0000\u00ff']) {
    const encoded = Buffer.from(text, 'latin1').toString('base64');
    assert.equal(decode(encoded), text);
    assert.equal(decode(encoded.replaceAll('=', '')), text);
  }
  for (const invalid of ['a', 'abc==', '=aaa', '!@#$']) assert.throws(() => decode(invalid), /base64/);
});
