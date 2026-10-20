# Progress and restart checkpoint

Read this file first when resuming, then `README.md` for commands and `BENCHMARK_PLAN.md` for the full specification. Update this checkpoint at meaningful milestones/interruptions. Git history and original run artifacts are the evidence; this file is only their summary.

## Current state

**Milestone:** TrailBase conformance, API-only dataset preparation/reset, and the weighted fixed-VU workload are implemented and verified. Both the tiny end-to-end smoke and the full 1,000-account `pilot-small` exploratory run passed. No maximum-user capacity result exists.

**Current implementation:** the fixture/workload milestone and this checkpoint are committed together on `main` in https://github.com/burggraf/baas-bench-2 (public). Resolve its hash with `git log -1 --format='%h %s'` when resuming. The preceding conformance milestone is `e609a22`.

**Publication/checkpoint:** the user explicitly requested committing and pushing this milestone before `/compact`, then resuming with “Read PROGRESS.md and continue from the checkpoint.” Verify `git status --short --branch` and local/remote tips on restart; do not infer publication from prose alone. This authorization does not require automatic commits/pushes for subsequent work.

## Confirmed decisions

- Native BaaS authentication and official JavaScript SDKs for all auth/application operations, seeding, verification, and normal cleanup. No direct database access for workload/users/data.
- Native schema migrations/configuration are allowed for deployment, not data insertion.
- Thin in-process k6 SDK transport. Ask before any HTTP-only/different-runner fallback; no proxy bridge. No fallback has been used.
- Complete backend-stack budget: pilot 1 CPU quota, 4 GiB RAM, no swap. Verify Docker settings **and actual cgroup v2 limits**.
- User-confirmed SLOs: read action p95 <=500 ms; write action p95 <=750 ms; login p95 <=1 s; unexpected failures <1%. Additional plan defaults: action p99 <=2 s, login p99 <=3 s. Low-sample percentiles are not SLO passes.
- Keep it simple: one backend, one local runner, one workload, fixed-VU evidence first. No other adapters, capacity search, dashboards, distributed runners, or remote automation yet.

### Current configuration

`configs/pilot-small.json` freezes `social-mixed-v1`:

| Action | Weight |
|---|---:|
| List public posts | 35% |
| List own posts | 15% |
| Read a post | 15% |
| Create a post | 5% |
| Like a post | **17%** |
| Unlike a post | **5%** |
| Edit own post | 8% |
| Total | 100% |

- Dataset: 1,000 accounts, 10 posts and 10 distinct likes per account (10,000 of each row type).
- Default fixed load: 10 VUs, 30-second arrival ramp, 60-second warm-up, 120-second measurement.
- Think time 1–5 seconds; session length 300–900 seconds; page size 20; 1,024-byte deterministic pseudo-random ASCII post bodies.
- `configs/smoke.json`: four accounts, two VUs, 1+2+12-second schedule, accelerated pacing (0.05–0.1 s) and sessions (3–5 s). This is a correctness test, never a realistic-human capacity result.
- Strict config validation rejects unknown fields/actions, invalid weights/ranges, named-profile count changes, and undersized identity pools. Default seeding concurrency is one; no automatic retries.

### Authentication/storage contract

- Preparation registers and logs in through the SDK; validates actual identities/rows, and logs out.
- Ignored `.fixtures/trailbase.json` contains credentials and API-returned IDs, never JWTs/refresh tokens. Directory 0700, file 0600; excluded from Git **and Docker build contexts**. Workload mounts it read-only and loads via k6 SharedArray; each VU copies only its own state.
- Every run performs fresh native logins, one distinct account per VU. Reuse the SDK client/tokens only in memory between actions; default native refresh remains enabled.
- Session renewal is logout/login as the same account; initial logins belong to warm-up. Renewals/auth HTTP requests are tagged separately; refresh and prerequisites triggered by an action stay inside its latency.
- Reports record actual numeric access-token TTL ranges and observed refresh-request counts, not tokens. Observed TrailBase access TTL is 3,600 seconds. Default sessions are shorter; do **not** claim natural-expiry coverage. Forced refresh remains separately tested in conformance.
- Normal end attempts logout; forced interruption may prevent it. The fixture is marked `used` **before launch**, including failed runs; a second run requires explicit reset/reseed.

## Implemented files

- Existing deployment: `compose.yaml`, `backends/trailbase/configuration/` (native migration, indexes, timestamp trigger and ownership rules), `runner/Dockerfile`.
- Pinned versions remain TrailBase 0.35.1 / SDK 0.14.3 / k6 2.3.0 / runner Node 24.11.0. Native untimed preparation uses the controller Node version, recorded in metadata.
- `src/workload.js`: strict config, independent seeded PRNGs, weighted selection, deterministic payload recipe.
- `src/fixtures.js`: API-only seeding/verification, atomic private storage, preflight-guarded account deletion/reset. Partial seed records are retained and rejected as baselines.
- `src/actions.js`: all seven real SDK actions, bounded caches, real edit/unlike targets, bounded native prerequisites and explicit unavailable-target failures.
- `src/k6/social.js`: staged arrivals + constant-VU measurement, isolated identities/jars, native sessions, action/auth/HTTP metrics, completion/validity/SLO thresholds, best-effort logout.
- `src/base64.js`: tested browser-compatible atob padding over k6's strict decoder; shared with conformance.
- `src/report.js`: observed mix, failure counts, action/login tails, insufficient-sample labels, TTL/refresh evidence. Reports are always exploratory, `certified: false`.
- `scripts/social.js`: `prepare|run|reset` controller with private operation lock, expected pilot-volume checks, baseline verification/consumption, raw artifacts, backend Docker stats, API start/end row counts and allocated storage, JSON/Markdown report.
- `scripts/runtime.js`: common source/runtime manifests, actual resource-limit verification and runner output preservation. Existing conformance runner now reuses it.
- `tests/*.test.js`: 23 current Docker-free tests. `tests/pilot.integration.js`: original Node/k6 conformance/artifacts. `tests/social.integration.js`: real four-account API seed, static pagination, all actions, fresh sessions/renewal, artifact privacy, used-baseline rejection, API reset.

## Verified evidence

Final successful regression command **after** the larger run:

```sh
npm test
npm run pilot:up
# Native SDK public count confirmed zero posts after the full-profile API cleanup.
npm run test:pilot
npm run test:social
npm run pilot:down
```

Managed process `social-final-regression-and-cleanup-proof` (`proc_da18`) exited 0. The earlier pre-profile full regression (`proc_4d93`) also passed:

- 23 unit tests passed.
- Original conformance integration passed: 45 native SDK checks and 90 checks across two k6 VUs.
- Social integration passed (about 21 seconds), including private-file permissions, distinct accounts, all seven actions, session renewal, nonempty raw metrics, no passwords/token fields in checked public artifacts, baseline reuse rejection and SDK-only cleanup.
- Earlier passing smoke run `results/social-smKuZv/`: 286 measurement actions, 8 successful logins, no logical failures or target-unavailability, recorded access TTL 3,600 s. A later successful run also includes the final pseudo-random payload recipe; consult the newest matching manifest/source hashes instead of treating an older pass as proof of changed code.
- Native backend/runner verified `linux/arm64` on OrbStack. Limits: quota/period 100000/100000, memory.max 4294967296, memory.swap.max 0.

Original failures are retained in ignored `results/social-*/` (not rewritten):

1. Missing base64 padding caused TTL inspection to fail after successful SDK login. A standalone constant-payload k6 diagnostic proved strict std decoding rejects unpadded input. Added pure regression tests and shared padding adaptation; no SDK API method was replaced.
2. Like-target depletion revealed that TrailBase omits cursors for custom sorting. Confirmed in upstream v0.35.1 `list_records.rs`; the official SDK exposes offset pagination. Changed prerequisites to native SDK offsets, retained `created_at DESC, id DESC`, and added static nonoverlapping-page plus exhausted-offset regression tests. No HTTP-only fallback.
3. Added a regression ensuring the first edit cannot reproduce a seed payload; workload sequence starts above the seed-post sequence range.

The full-profile manifest's source/config/bundle hashes were compared to current files and matched. All 11,043 lines of its compressed raw metric stream parsed as JSON and contained no password/auth-token/refresh-token field names. Git/Docker ignore rules for `.fixtures`, `results` and `dist` were checked. `git diff --check` passed.

Immediately before publication, managed process `workload-precommit-regression` (`proc_e2c3`) reran `npm test`, image builds/startup, `test:pilot`, and `test:social`, then `pilot:down`; exit 0. All 23 unit tests and both integration suites passed again. The full 1,000-account implementation hashes still matched the larger-run manifest; only checkpoint/documentation changed after that run.

These ignored local artifacts/process logs are not present in a fresh clone. Rerun checks before making current claims.

## Larger-profile result and resource state

Managed process **`pilot-small-api-seed-and-workload` (`proc_0b95`)** exited **0** after 383 seconds. It ran native API preparation, the default fixed-VU workload, API cleanup and `pilot:down`.

Raw evidence: **`results/social-gADSpc/`**, including `report.json`, `report.md`, runtime/preparation manifests, k6 summary/raw metrics/stdout/stderr, and backend Docker-stats samples.

- API prepared and verified **1,000 users, 10,000 posts and 10,000 likes in 84.59 seconds**. Sanitized inspection confirmed 1,000 distinct IDs, fixture mode 0600, and no token fields persisted.
- 10 VUs, 30-second ramp + 60-second warm-up + 120-second measurement, normal 1–5-second think time.
- **653 completed logical actions overall; 404 during measurement. Zero logical failures, unavailable targets, invalid responses, HTTP failures or auth failures.** All 10 VUs completed, with no interrupted k6 iterations.
- All seven actions executed. Measurement counts: public list 140; own list 57; read 80; create 15; like 63; unlike 25; edit 24.
- 10 fresh logins in warm-up, zero measurement-phase logins/refreshes. Observed access TTL 3,600 seconds; no natural-refresh claim. Shortened-session renewal is separately covered by the tiny smoke integration.
- API end counts: **10,030 posts and 10,073 likes**, including warm-up writes. Counts are start/end deployment totals, not only measurement-phase growth.
- `valid: true`, `certified: false`, mix and tail evidence **insufficient_samples**. Do not promote green k6 thresholds or these low-sample timings into capacity/SLO certification.
- Allocated service storage fell from 494,678,016 to 235,741,184 bytes despite logical row growth. This is deployment-wide allocated storage (including auth/WAL/files), not an application-payload size measure; do not call it negative application growth or infer a specific cause without further evidence.

**Cleanup verified:** all benchmark fixture accounts/application data were deleted through native APIs, private fixture and operation lock removed, pilot containers/network stopped and removed, and no managed jobs left running. The isolated named data volume/images and ignored raw artifacts remain. Do not treat the retained volume as a cold physical baseline for future performance comparisons.

## Known limits / traps

- No capacity discovery, repeated certifications, soak, headroom proof, or natural-expiry coverage yet. Short fixed-VU evidence is not a maximum-user result.
- Reports require >=1,000 samples **per action** and measurement-phase login evidence for tail conclusions; tiny/default fixed-VU runs intentionally remain insufficient evidence. k6 can show green percentile thresholds with zero samples; the report must still say insufficient.
- Requested-mix sanity is only checked after 1,000 measurement actions (five-sigma binomial bound). Tiny runs exercise the generator but cannot certify exact percentages.
- Like target search is explicitly bounded (current visible pool plus <=4 feed-page requests, <=5 native own-like probes per pool). It can report unavailable targets despite eligible rows elsewhere; such a run is invalid, not a backend capacity loss. Unlike fetches real own-like targets; no silent action substitution/no-op counting.
- Custom-order feeds use offsets, not cursors. Concurrent inserts can shift pages; native checks avoid duplicate like inserts. This common target-selection rule must remain documented across adapters.
- Backend Docker stats are raw ordered samples without per-sample timestamps; generator utilization/headroom and restart/OOM/stability validation are not yet complete. Allocated storage includes auth/WAL/service files, not only payloads.
- Controller supports only the local pilot and expected named volume. Remote Docker contexts/arbitrary targets are not supported. Do not repoint it at production/shared services.
- API reset restores logical data, not cold caches/file layout/auth-history equivalence. Comparable performance trials need fresh isolated deployments/volumes plus deterministic API reseeding, not just deletion/reinsertion.
- Partial seeds are fail-closed and not resumable; explicit isolated-deployment reset is required. Deletion progress is private/persisted, but a crash between a successful server deletion and saving its progress can require manual isolated-deployment recovery.
- A stale private operation lock blocks continuation. Inspect active jobs before removing it. Normal command completion releases its lock; normal successful reset removes credentials.
- Existing named volumes keep their original schema/config after image rebuild. Provisioning changes need an explicitly approved project-only volume reset, never deletion of unrelated volumes.
- Rebuild runner images after shared conformance/dependency changes; the Node conformance copy lives in the image. k6 bundles are rebuilt by controllers.
- SDK compatibility is limited to exercised auth/Record paths. Optional `urlSafeBase64Decode` still hits k6 `Uint8Array.from(string)`; ordering assertions use atob. Uploads/realtime/streaming remain untested.
- Conformance deliberately issues denied requests; its `http_req_failed` is not the workload's unexpected-failure rate.

## Next actions

1. Confirm the clean/published checkpoint and inspect current code/callers. The fixture/workload milestone is finished; do not repeat its implementation or mistake the 10-VU run for capacity certification.
2. Continue with a bounded observability milestone: timestamped backend **and runner** resource monitoring, runtime stability evidence (restart/OOM/exit), and honest generator-headroom validity reporting. Reuse existing Docker/k6 facilities, preserve raw source samples, and add regression/integration coverage. Do not jump to capacity search or another adapter.
3. Then address interrupt cleanup, fresh-deployment baseline repetition proof, and long-lived authentication coverage before capacity certification. API reset is not a cold physical baseline.
4. Run applicable suites after any code changes; avoid overlapping tests/workloads, preserve original artifacts, update this file with exact evidence/resource state, and do not print secrets. Historical passes do not certify changed code.

## Restart commands

```sh
git status --short --branch
npm ci
npm test
npm run pilot:up
npm run test:pilot
npm run test:social
# Optional larger exploratory run (prepare -> run -> explicit reset):
npm run dataset:prepare
npm run workload:run
npm run dataset:reset
npm run pilot:down
```
