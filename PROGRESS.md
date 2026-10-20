# Progress and restart checkpoint

Read this file first when resuming, then `README.md` for commands and `BENCHMARK_PLAN.md` for the full specification. Update this checkpoint at meaningful milestones/interruptions. Git history and original run artifacts are the evidence; this file is only their summary.

## Current state

**Milestone:** TrailBase conformance, API-only fixtures, weighted workload, observability, interruption/recovery and **repeated fresh-deployment logical baseline proof** are implemented and verified. Three independent fresh volumes each produced 1,000 accounts / 10,000 posts / 10,000 likes with the same API-verified logical hash and different native identities. No maximum-user capacity result exists.

**Current implementation:** the commit containing this checkpoint adds verified fresh-deployment baseline proof on top of **`5b30028f74bbfe543671fd8478b95355e97e352c`** (observability/recovery); prior independent main updates are preserved. Resolve the publication commit with `git log -1 --format='%h %s'` and verify actual remote tips. Baseline-proof manifests record `5b30028`, dirty true, plus matching source/config hashes. Historical performance runs predate these changes and do not certify the new controller.

**Publication/checkpoint:** the user explicitly requested committing/pushing this completed fresh-baseline milestone, following the earlier observability/recovery publication. This request does not authorize automatic publication of subsequent work. Verify actual git tips/status on restart; do not infer publication from prose alone. Resume with “Read PROGRESS.md and continue from the checkpoint.”

## Fresh-baseline milestone (verified)

New work after `5b30028`: `scripts/baseline.js` creates three isolated labeled external volumes under the unchanged fixed Compose project; no pilot/workload volume guard was relaxed and no volume is deleted. Shared `scripts/client.js` preserves existing controller transport/logout checks. `src/fixtures.js` incrementally hashes API-verified logical user/post/like data, excludes native identities/times, and checks the deterministic like recipe, not just saved IDs/counts. Tests were observed red before implementation, then green. New commands: `npm run test:baseline` (small native correctness integration, pilot stopped/images built) and `npm run baseline:prove` (build images, three full pilot-small preparations). No dependency was added.

The small fresh-deployment proof, full regression and larger three-trial proof all passed. Initial `fresh-baseline-smoke-and-controller-regression` (`proc_240d`) failed in the new baseline integration after its first fresh trial succeeded. `results/baseline-nOp332/` preserves original evidence: trial 2 failed with TypeError before any registered IDs/posts/likes. A second native reproduction (`fresh-baseline-fetch-diagnostic`, `proc_6711`) confirmed **UND_ERR_SOCKET in the very first SDK public-count request after replacing the server** (`results/baseline-dWPXFo/failure.json`), again before any registered IDs. Synchronous Docker teardown/start blocked socket-close processing in the same Node process. Startup/shutdown now use asynchronous native Docker CLI execution so old connections close before the next deployment; no HTTP retry, delay workaround or keepalive/SDK fallback was added. Original CLI stdout/stderr are retained separately. Failure instrumentation records sanitized locations/cause codes, never SDK responses or credentials.

**`failed-baseline-owned-sdk-cleanup` (`proc_39c3`) exited 0**: checked/SDK-cleaned only its generated namespace on the exactly verified `baas-bench-2-pilot_baseline-nOp332-2`, proved zero public posts, archived the original private fixture byte-for-byte at `.fixtures/archive/failed-baseline-nOp332.json`, then stopped its checked backend. **`second-failed-baseline-owned-sdk-cleanup` (`proc_c893`) also exited 0** with the same checked SDK cleanup/zero-post/private archival proof for `baseline-dWPXFo-2` / `.fixtures/archive/failed-baseline-dWPXFo.json`. Both failed proof groups' fresh volumes and public artifacts are retained; no volume was deleted. Private archived credentials remain 0600 under 0700 directories, excluded from Git/build contexts. **`fresh-baseline-fixed-and-controller-regression` (`proc_04d3`) exited 0 after 93 seconds**: all **42 unit tests**, image builds, the new three-fresh-smoke integration, original conformance (45 native SDK / 90 k6 checks), and all six existing social/signal cases passed, followed by pilot shutdown. Original output was read completely. **`results/baseline-jtmVd1/report.json`** records three separately verified 4-user/40-post/40-like deployments, three distinct identity hashes, one common logical hash `4dda0571fa660dc11df1d1b1dc897685d52233cde45306719d47061ea3631350`, zero posts after each SDK reset and unchanged pilot-volume metadata. All trial source/config/override hashes matched current files; `git diff --check` passed.

Immediately before publication, `fresh-baseline-precommit-unit-verification` (`proc_779b`) passed all 42 unit tests. Both the smoke and full proof manifests' implementation/config/override hashes were freshly checked against current files and still matched. Only documentation changed after the native verification; private fixtures, raw results and generated bundles are excluded from the commit.

### Full proof: `results/baseline-5ssqUf/`

**`three-fresh-pilot-small-baselines` (`proc_178d`) exited 0 after 500 seconds**, running `npm run baseline:prove`:

| Trial | Accounts / posts / likes | API seed+initial verification seconds | Post timestamp span seconds | SDK reset public posts |
|---|---|---:|---:|---:|
| 1 | 1,000 / 10,000 / 10,000 | 94.589 | 42 | 0 |
| 2 | 1,000 / 10,000 / 10,000 | 95.572 | 47 | 0 |
| 3 | 1,000 / 10,000 / 10,000 | 93.426 | 45 | 0 |

- Three distinct native identity hashes and separately created/labeled volumes `baas-bench-2-pilot_baseline-5ssqUf-{1,2,3}`.
- All three independently reverified logical hashes: **`b816ba86c3e3b771396ecf701a5658f5d836db07105efeea8fa4fbe6c60674fb`**. This hashes observed payloads and verified graph edges, not credentials/native IDs/timestamps or merely a fixture recipe.
- Native SDK registration/login/seed/verification/deletion only; no direct DB access, retries, snapshot restore or alternate API/runner.
- Every runtime/source/config/Compose-override hash matched current files. Actual Docker/cgroup limits and platform/image/version metadata were recorded for each fresh backend. Independent post-run inspection matched all three volumes' names, creation times, local driver/options/scope and ownership labels to saved evidence.
- Retained pilot-volume metadata before/after was identical; each backend mounted only the selected fresh data volume. The pilot data volume was not reset/deleted/mounted during this proof.
- Final report is `valid: true`, `certified: false`. All three SDK resets proved zero public posts before checked backend shutdown. `seedSeconds` includes initial verification, not the second verification/cleanup; none of these durations is a performance-capacity measurement.
- Public evidence had no password/auth-token/refresh-token fields or archived failed-test passwords. Original CLI output, exact overrides, per-trial manifests, original failed attempts and private failed fixtures are retained. No source implementation changed after this verification.

**Current cleanup:** no running managed jobs, project containers/retained runners, monitor/Docker-stats processes, active `.fixtures/trailbase.json`, operation lock or recovery claim. Two original failed-test fixtures remain archived privately under `.fixtures/archive/` (0600 files/0700 directories); their owned namespaces were separately SDK-cleaned and verified empty. New trial volumes are intentionally retained, never deleted; they are API-cleaned and **not pristine reusable baselines**. The original named pilot volume/images also remain. No physical snapshot, cold-host-cache equivalence, workload repeatability or capacity/headroom certification is claimed.

## Previous final verification and resource state

Managed process **`interrupt-recovery-measurement-regression` (`proc_2ca4`)** exited **0 after 95 seconds**:

```sh
npm test && npm run pilot:up && npm run test:pilot && npm run test:social \
  && node --test --test-name-pattern='^API-only' tests/social.integration.js
# Finally: pilot:down; preserve the actual exit code.
```

**39 unit tests passed**, original conformance passed (45 native SDK / 90 k6 checks), **all six social integration cases passed**, and the additional normal SDK smoke passed. Signal tests wait at least six seconds of sampled runner time and require actual measurement actions in partial reports, not only warm-up traffic.

Immediately before publication, **`observability-recovery-precommit-verification` (`proc_645b`) exited 0 after 97 seconds**: all 39 unit tests, image builds/startup, original conformance, all six social integration cases and the additional normal smoke passed again, followed by `pilot:down`. No implementation changed between that verification and publication; only checkpoint publication notes were updated.

Cleanup inspected after completion: **no running managed jobs, no Compose-project containers/retained runners, no monitor/Docker-stats processes, and an empty private `.fixtures/` directory** (no credentials, operation lock or recovery claim). Tests explicitly confirmed zero public posts through the native SDK after each reset/partial-seed cleanup. Named data volume/images and ignored artifacts remain; the volume is not a cold physical baseline.

## Previous resource-state proof

Managed process **`observability-final-regression-and-pilot-small` (`proc_190e`)** exited **0** after 419 seconds: unit tests, image builds/startup, conformance, expanded social tests, 1,000-account preparation, full workload, native API reset and `pilot:down`.

Inspection confirmed no private fixture/operation lock, no managed jobs, no Compose-project containers (including retained runners), and no monitor/Docker-stats processes left. The named volume/images and ignored artifacts remain; that volume is not a cold physical baseline.

Prior read-only cleanup proof **`observability-final-cleanup-proof` (`proc_cce9`) exited 0**: restarted the retained volume, asserted **zero public posts through the native SDK**, then stopped/removed the pilot again. The newer interruption/recovery verification also completed and cleaned up, as recorded above.

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
- `scripts/runtime.js`: common manifests/limit verification and **asynchronous** runner execution with live, original stdout/stderr files, exit records, abort-before-start guard and bounded Docker-client termination/escalation. All callers await it; conformance runners still auto-remove. Synchronous preflight captures now have a 30-second command timeout.
- New `scripts/recovery.js`: private versioned lock recovery, live-PID refusal, exact run/project/service/name/image checks, and container-ID-pinned SIGINT/10-second stop then removal. Normal shutdown quiesces, records final monitor state, then removes; explicit stale recovery never changes credentials or application rows.
- `scripts/social.js` handles SIGINT/SIGTERM via AbortController, cancels native controller API requests, records interrupted/invalid evidence and exits 130/143. Used fixtures stay used; partial seed status remains failed. Cleanup failure retains the lock; explicit `recover` handles dead owners but refuses live/reused/inaccessible PIDs and unknown/corrupt/insecure records. SIGKILL leaves a stale record; no arbitrary OS PIDs are killed.
- `scripts/monitor.js`: independent Node collector, timestamped stats/cgroup/lifecycle observations for both roles, unchanged raw stats, selected-field inspection (never environment/health-log bodies), bounded commands/stop escalation and parent-IPC-loss shutdown. Verified runner exit between inspection/cgroup read is recorded as a terminal transition, not silently treated as zero counters or a collector error.
- New `src/resources.js`: parser and conservative evidence summary. Observed CPU cores, sampled memory/current vs lifetime peak, OOM/throttling deltas, identity/policy/restart/health/exit checks; missing/bad/gapped samples fail closed. Generator headroom stays **unverified**, even with low utilization.
- Top-level report `valid` combines `workloadValid` and `resources.valid`; it is not capacity certification. k6 exit **99** denotes completed threshold failures, not a runner crash. Other abnormal exits invalidate resource evidence. Raw reason/role records distinguish collector/backend/runner failures.
- `tests/*.test.js`: 42 current Docker-free tests (20,000-pool regression, resource/parser/exit-race tests, asynchronous runner/abort/escalation tests and ownership/stale-lock refusal/recovery tests). `tests/pilot.integration.js`: original Node/k6 conformance. `tests/social.integration.js`: six cases—native exit-99 probe; full SDK/resource smoke; active-workload SIGINT, SIGTERM and SIGKILL+explicit recovery; and SIGTERM during native API preparation. Interrupt artifacts are checked for passwords/tokens, used baselines are refused, credentials survive recovery unchanged, and explicit SDK cleanup confirms zero public posts.

## Interruption/recovery verification (local, passed)

- `interrupt-recovery-first-regression` (`proc_1f3d`) exited 0 with the initial implementation, original conformance and SIGINT/SIGTERM/SIGKILL recovery tests.
- Expanded `interrupt-recovery-final-regression` (`proc_336a`) passed all 38 then-current unit tests, conformance, native exit probe, all three active-workload signal cases, and early-preparation cancellation. Its normal smoke correctly rejected telemetry due to a **real sampling race**, not application failures: `results/social-BWnIyY/resources.jsonl` recorded a cgroup read after k6 had exited.
- Native diagnostic `runner-terminal-race-diagnostic` (`proc_7981`) proved Docker exec returns exit 1 with `container <id> is not running` for a stopped container; raw output is in **`results/exit-race-KgsJcV/`**. The new unit test was observed red before the fix, then all seven resource tests passed.
- Fix re-inspects the same runner ID and accepts only that exact native error plus verified exited/nonrunning state as a terminal lifecycle transition. Backend failure, timeout, permission error, still-running state and wrong ID remain errors; exit 137/OOM/restart still fail normal stability gates. Native cgroup stderr is now retained separately. Failed evidence is untouched.
- Fake-Docker unit coverage proves exact-label/project/service/image/name ownership, ID-pinned stop/remove, no forced removal, absent-vs-daemon-error distinction, active-PID refusal, stale recovery preserving credential bytes, and legacy/corrupt lock refusal. Runner tests prove event-loop progress and forced termination of an explicitly uncooperative client after SIGTERM.
- **`interrupt-recovery-verified-regression` (`proc_e393`) exited 0 after 83 seconds:** all 39 unit tests, conformance, all six social integration cases and an extra normal SDK smoke passed. The signal cases at this point interrupted active warm-up traffic. All five run manifests matched the current implementation/config/bundle hashes. Normal reports `results/social-9jXhCE/` and `results/social-5bln1m/` were valid/exploratory (283/282 measurement actions); SIGINT/SIGTERM reports `social-dz5Hg3`/`social-cMWwBj` were invalid; killed run `social-otGaqQ` had no success report and explicit recovery in `results/recovery-KiDIxB/recovery.json`. Cleanup inspection found no fixtures/locks/claims/owned containers/monitor/stats jobs.
- Tests were strengthened to interrupt after measurement starts. Final fresh **`proc_2ca4` passed all 39 unit tests, conformance, six social cases and an extra normal smoke**. Current-source evidence:
  - **`results/social-vFFxsr/`**: normal valid/exploratory SDK smoke, 283 measurement actions.
  - **`results/social-Sfwrub/`**: SIGINT, 85 measurement actions, invalid report, controller exit 130 and native k6 external-abort exit 105.
  - **`results/social-HiyJ4o/`**: SIGTERM, 86 measurement actions, invalid report, controller exit 143 and native k6 exit 105.
  - **`results/social-zwsnQn/`**: controller SIGKILL, no fabricated success report; **`results/recovery-1uxvva/recovery.json`** records checked removal of the owned runner/stale lock. Fixture credentials remained byte-for-byte unchanged until explicit SDK reset.
  - **`results/social-Rftms5/`**: second normal valid/exploratory smoke, 281 measurement actions, zero action failures.
  - SIGTERM during native preparation preserved a 0600 `failed` fixture, blocked run/reset, and released its lock. The test then explicitly deleted only its own generated accounts through authenticated SDK calls; the production CLI still refuses partial-seed data repair.
- All five final run manifests matched current source/config/bundle hashes. Checked public text had no password/auth-token/refresh-token fields; integration tests also compared actual live fixture passwords against interrupted artifacts. `git diff --check` and cleanup inspection passed. Original failed evidence/diagnostics were retained unchanged.
- The earlier 1,000-account observability run below predates these controller changes; it is not current-source interruption or capacity certification.

## Prior observability verification (local, passed)

Final process `proc_190e` ran all applicable suites and the larger profile on the unchanged implementation:

- **30 unit tests passed**, zero failed/skipped.
- Original conformance integration passed: **45 native SDK checks and 90 k6 checks across two VUs**.
- Both social integration tests passed: pinned k6's native threshold-exit-99 diagnostic, then the full SDK smoke (about 22 seconds) covering actions/sessions, both resource roles, timestamps/cgroups/final exit, owned-runner removal, artifact privacy, baseline-reuse refusal and API reset.
- Earlier corrected smoke/conformance process `proc_6f43` also exited 0 before the exit-code distinction was added.
- Unit tests were observed red before implementing parsers/evidence gates, then green. They cover missing/malformed/gapped data, counter rollback, OOM/restart/health/policy changes, nonzero exit, and never inferring headroom from low CPU/memory.
- Initial Docker attempts were correctly rejected as invalid monitoring despite successful application actions. Exact diagnostic evidence in `results/social-USDjMo/` exposed native stats terminal controls and Go-template failure on a runner with no health-check field. The parser uses Node's standard `stripVTControlCharacters`; raw bytes remain separate and unchanged. Inspection now guards missing `Health`, and expected pre-creation `no such object` detection is case-insensitive. Both old failed artifacts remain retained.
- A completed threshold-failure exit 99 remains distinct from a crash (137 etc.). The final native k6 Counter-only diagnostic proved pinned exit behavior (and preserved stdout/stderr/exit under `results/threshold-exit-*/`); this is not an HTTP/SDK fallback or performance measurement.

### New full-profile evidence: `results/social-gJZifM/`

- Native API seeded/verified **1,000 users, 10,000 posts and 10,000 likes in 82.31 seconds**. Native SDK workload: 10 VUs, normal think time, 30s ramp + 60s warm-up + 120s measurement.
- **408 measurement actions, zero logical/action/HTTP/auth failures**. All seven actions executed: public list 142, own list 58, read 79, create 15, like 64, unlike 25, edit 25. All 10 VUs completed without interruption; zero unavailable targets/invalid responses.
- Ten fresh warm-up logins; no measurement-phase logins or natural refresh. TTL remains 3,600s. Shortened-session renewals are covered separately by the tiny smoke.
- `valid: true`, `workloadValid: true`, `resources.valid: true`, `certified: false`; mix/tail evidence remains **insufficient_samples**, and generator headroom remains **unverified**.
- **1,552 timestamped observations**, including 429 backend and 425 runner stats points. Backend cgroup/lifecycle samples: 176/176; runner: 172/174. No evidence gaps rejected, no observed restart/health loss/OOM, unchanged resource settings, final runner exit 0. OOM and observed CPU-throttling deltas were zero for both roles.
- Observed sampled peaks (startup/warm-up/measurement/cleanup combined): backend **0.3733 CPU cores / 262.98 MiB** current memory; runner **3.291 CPU cores / 87.38 MiB**. Do not call the larger cgroup lifetime memory peak a run-only peak, or infer generator headroom from these numbers.
- Native API end counts before reset: **10,030 posts and 10,074 likes**, including warm-up writes. Allocated service storage 519,319,552 -> 242,749,440 bytes; this includes auth/WAL/allocation effects, not just payloads.
- At that observability milestone, source/config/bundle hashes matched its full-profile manifest. Every resource line had valid UTC/monotonic receipt time; recomputing the summary from raw resource rows exactly reproduced the saved summary. The compressed k6 metric stream parsed as JSON lines. Checked public artifacts/raw metric text contained no password/auth-token/refresh-token fields. Normal API reset removed credentials, and owned runner/collector/stats/container cleanup was inspected.
- Original raw logs, failed trials and manifests remain ignored/local. No capacity, sustained headroom, natural-expiry or soak certification is claimed.

## Prior fixture/workload milestone evidence (`06ed6b1`)

Final successful regression command **after** its larger run:

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

At the prior milestone, the full-profile manifest's source/config/bundle hashes matched the then-current files. New observability source is different and needs its own evidence. All 11,043 lines of its compressed raw metric stream parsed as JSON and contained no password/auth-token/refresh-token field names. Git/Docker ignore rules for `.fixtures`, `results` and `dist` were checked. `git diff --check` passed.

Immediately before publication, managed process `workload-precommit-regression` (`proc_e2c3`) reran `npm test`, image builds/startup, `test:pilot`, and `test:social`, then `pilot:down`; exit 0. All 23 unit tests and both integration suites passed again. The full 1,000-account implementation hashes still matched the larger-run manifest; only checkpoint/documentation changed after that run.

These ignored local artifacts/process logs are not present in a fresh clone. Rerun checks before making current claims.

## Prior larger-profile result (`06ed6b1`, before observability)

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

**Prior-milestone cleanup was verified:** benchmark fixture accounts/application data deleted through native APIs, private fixture/lock removed, containers/network removed, no managed jobs left running at that time. The newer observability run has also completed and cleaned up, as recorded above. The isolated named data volume/images and ignored raw artifacts remain. Do not treat the retained volume as a cold physical baseline for future performance comparisons.

## Known limits / traps

- No capacity discovery, repeated certifications, soak, headroom proof, or natural-expiry coverage yet. Short fixed-VU evidence is not a maximum-user result.
- Reports require >=1,000 samples **per action** and measurement-phase login evidence for tail conclusions; tiny/default fixed-VU runs intentionally remain insufficient evidence. k6 can show green percentile thresholds with zero samples; the report must still say insufficient.
- Requested-mix sanity is only checked after 1,000 measurement actions (five-sigma binomial bound). Tiny runs exercise the generator but cannot certify exact percentages.
- Like target search is explicitly bounded (current visible pool plus <=4 feed-page requests, <=5 native own-like probes per pool). It can report unavailable targets despite eligible rows elsewhere; such a run is invalid, not a backend capacity loss. Unlike fetches real own-like targets; no silent action substitution/no-op counting.
- Custom-order feeds use offsets, not cursors. Concurrent inserts can shift pages; native checks avoid duplicate like inserts. This common target-selection rule must remain documented across adapters.
- New resource collection uses timestamped receipt/monotonic time, selected lifecycle snapshots and native cgroup counters, plus separate unmodified stats bytes. Stats gaps >5 seconds invalidate evidence; this is a coverage guard, not a headroom threshold. Samples cover startup/warm-up/measurement/k6 cleanup; lifetime cgroup peaks can predate the run. Generator calibration, host/VM/socket/thermal contention and monitoring overhead remain unverified. Allocated storage includes auth/WAL/service files, not only payloads.
- The pilot collector retains observation records in memory as well as writing raw files; use bounded-memory aggregation before overnight soaks. No overnight-soak support is claimed.
- SIGINT/SIGTERM now cancel API calls, stop only checked run-owned resources and release the operation lock after cleanup. SIGKILL requires explicit `node scripts/social.js recover`; monitor parent-loss shutdown is tested. Unknown/empty/legacy/corrupt/insecure locks and stale recovery claims require manual investigation. PID reuse/live/inaccessible PID checks refuse rather than guessing. No power-loss/daemon-loss/exhaustive failure-injection guarantee is claimed.
- Controller supports only the local pilot and expected named volume. Remote Docker contexts/arbitrary targets are not supported. Do not repoint it at production/shared services.
- API reset restores logical data, not cold caches/file layout/auth-history equivalence. Comparable performance trials need fresh isolated deployments/volumes plus deterministic API reseeding, not just deletion/reinsertion.
- Partial seeds are fail-closed and not resumable; explicit isolated-deployment reset is required. Deletion progress is private/persisted, but a crash between a successful server deletion and saving its progress can require manual isolated-deployment recovery.
- A stale private operation lock blocks continuation. Prefer explicit `node scripts/social.js recover` for supported dead-owner records; it does not change fixture credentials or application data. Wait for a still-live monitor to shut down first. Recovery itself uses an exclusive private recovery claim; a crash during recovery can require manual inspection of that claim. Never blindly delete locks or private fixtures. An uncertain last API deletion remains fail-closed, not an inferred success.
- Existing named volumes keep their original schema/config after image rebuild. Provisioning changes need an explicitly approved project-only volume reset, never deletion of unrelated volumes.
- Rebuild runner images after shared conformance/dependency changes; the Node conformance copy lives in the image. k6 bundles are rebuilt by controllers.
- SDK compatibility is limited to exercised auth/Record paths. Optional `urlSafeBase64Decode` still hits k6 `Uint8Array.from(string)`; ordering assertions use atob. Uploads/realtime/streaming remain untested.
- Conformance deliberately issues denied requests; its `http_req_failed` is not the workload's unexpected-failure rate.

## Next actions

1. Fresh-deployment logical baseline proof is complete and committed at the user's request. Confirm publication against actual git tips/status; preserve raw evidence/private failure archives and retained volumes. Do not automatically commit/push subsequent work.
2. Next bounded milestone: **long-lived native authentication**, preserving the default 3,600-second TTL and official SDK refresh behavior. Shortened smoke sessions/forced conformance refresh are not natural-expiry coverage; do not fake clocks/TTLs to claim it. Keep it separate from capacity certification and preserve the SDK/fallback approval boundary.
3. Then generator calibration/larger-or-separate-runner confirmation before capacity search/other adapters. Future performance campaigns need explicit owned fresh-deployment integration; the ordinary workload controller still deliberately refuses these non-pilot proof volumes. Never bypass that guard or reuse the API-cleaned proof volumes as pristine baselines. Utilization is not headroom/capacity certification. Host/daemon power-loss, exhaustive fault injection and overnight-soak support remain unverified.
4. Run applicable suites after code changes, avoid overlapping tests/workloads, preserve original evidence, update this checkpoint with exact resource state and do not print secrets. Historical passes do not certify changed source.

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
