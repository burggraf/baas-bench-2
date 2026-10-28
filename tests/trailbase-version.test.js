import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

test('TrailBase v0.35.4 is pinned to the verified multi-platform image without changing provisioning',()=>{
  assert.equal(readFileSync('backends/trailbase/Dockerfile','utf8'),'FROM trailbase/trailbase:0.35.4@sha256:cd4ddc4395b550f9d4aeea2438896804b75ecf5b12b4f187195c8435e3583d24\nCOPY configuration/ /app/traildepot/\n');
});
