# Progress and restart checkpoint

Read this file first when resuming, then `README.md` for commands and `BENCHMARK_PLAN.md` for the full specification. Update this checkpoint at meaningful milestones/interruptions. Git history and original run artifacts are the evidence; this file is only their summary.

## Current state

**Milestone:** TrailBase conformance, API-only fixtures, weighted workload, observability, interruption/recovery, fresh-deployment logical baseline proof and **separate real-TTL automatic refresh/continuity verification** are implemented and verified. Two SDK/k6 users crossed the original one-hour access-token expiry with natural refresh and protected reads. Normal weighted sessions remain 5–15 minutes. **Partial local SDK/k6 read calibration is now verified** (separate synthetic target; not full generator headroom). No maximum-user capacity result exists.

**Current implementation:** the commit containing this checkpoint adds verified partial local SDK/k6 calibration on top of **`45e334ba80411fe14e4d9db17737bb7b4e88f5ef`** (real-TTL authentication), `49fa4c9` (fresh baselines) and `5b30028` (observability/recovery). Resolve the publication commit with `git log -1 --format='%h %s'` and verify actual remote tips. The calibration manifest records `45e334b`, dirty true, and matching implementation/config/bundle hashes. Shared monitor adds an opt-in self-cgroup source for calibration; the original pilot path is unchanged and re-regressed. Historical auth/performance artifacts retain their original provenance and do not certify changed source hashes. Verify actual git tips/status on restart.

**Publication/checkpoint:** the user explicitly requested committing/pushing this completed partial-calibration milestone, following the earlier authentication, fresh-baseline and observability/recovery publications. This request does not authorize automatic publication of subsequent work. Verify actual git tips/status on restart; do not infer publication from prose alone. Resume with “Read PROGRESS.md and continue from the checkpoint.”

## Partial local synthetic generator calibration (verified)

Restart verified clean local/origin/actual remote **`45e334ba80411fe14e4d9db17737bb7b4e88f5ef`**. Host remains M1 Air / 16 GiB / 8 CPUs; current OrbStack reports 8 CPUs and 8,392,929,280 bytes VM RAM. Pilot was stopped. After a plain-language explanation, the user explicitly approved an ephemeral fast-response target for **local official-SDK/k6 calibration only**. No remote access/new hardware, HTTP-only fallback or BaaS capacity claim is authorized. The user subsequently explicitly requested committing/pushing this completed milestone.

- Scope: separate `baas-bench-2-calibration` Compose project/network, no published ports, no database, credentials/tokens or persistent data volumes. Synthetic target serves only exact anonymous SDK 20-post list queries, each body 1,024 bytes. Real TrailBase/auth/workload/retained volumes stay untouched. This is deliberately partial client-side calibration, **not** the seven-action authenticated workload.
- Three new unit tests observed red against stubs, then green: real Node SDK exact read-only payload/negative route/auth-header checks; fail-closed delivery/evidence classification without headroom certification; exact image/project/run/service/no-persistent-volume cleanup guards. Native integration observed red for the missing controller command.
- Added bounded calibration entry/controller/Compose file and native integration. Fixed open arrival rates 25/100/400/1,600 iterations/s, 5s warm-up + 1s drain + 20s measurement, 32 preallocated/max VUs, no pacing; smoke is 10/40 iterations/s and 2+1+6s. Open-model VUs/iterations are not active-human capacity. Target 1 CPU/256 MiB, runner 2 CPUs/1 GiB, no swap; actual target cgroup and runner startup cgroup policy checks. Static uncompressed pages isolate neither full SDK cost nor host contention; non-HTTP residual includes connection/queueing, SDK/validation and millisecond quantization.
- Reuses original SDK transport, asynchronous runner, independent monitor/raw stats/cgroups and resource classifier (its `backend` role means the **synthetic target**, not TrailBase). Separate target/network labels and checked container IDs; shared exclusive operation lock prevents concurrent pilot work. Controller refuses existing project containers/networks, active fixture/recovery claims and remote Docker/env overrides. No volume deletion. Catchable cancellation cleans only checked resources; SIGKILL/uncertain cleanup retains a `command: calibration` lock requiring manual inspection, **not supported by social `recover`**. Never blindly remove that lock or apply pilot recovery to this project.
- First native smoke **`proc_fde1` failed**, preserving **`results/calibration-iRD4Xo/`**: k6's `open()` raised EIO on cgroup pseudo-files during init. Isolated same-image diagnostic **`proc_5278`** passed: native `cat` read the same cgroup files while k6 `open` reproduced failure. Moved only resource capture to a native shell bootstrap that writes original limits then `exec`s the **same k6 process/cgroup**; no API/SDK/runner fallback. The initial failed runner also exposed that Compose `down` leaves one-off containers: cleanup now explicitly removes checked exited runners before `down`. Dead owner/monitor + exact image/project/run/exited-state checks allowed explicit no-force cleanup of that failed test before matching-lock removal; no volume/fixture changed. Original diagnostic source/stdout/stderr are preserved.
- Second native attempt **`proc_5753`** passed all 48 units but failed SDK initialization; cleanup now removed all ephemeral resources and released the lock. Isolated no-network SDK diagnostic **`proc_d6c9`** confirmed passing a base URL fails in both init/VU contexts, while `initClient(undefined, {transport})` succeeds in both. Calibration now follows the already-proven conformance/social/auth call pattern: origin belongs to the supported custom transport, not an unused SDK base URL. Original failures including **`results/calibration-aDdyvG/`** and diagnostic source/stdout/stderr are retained.
- **`calibration-native-corrected-sdk-path` (`proc_283a`) exited 0 after 36 seconds**: 48 units and both serialized native calibration tests passed. Initial normal smoke **`results/calibration-YkjM3Y/`** delivered both configured rates, preserved the pilot volume and cleaned up; cancellation retained invalid evidence and removed checked one-off resources.
- **`calibration-original-pilot-regression` (`proc_f4c4`) exited 0 after 103 seconds**: 48 units, image builds, three-fresh-smoke baseline proof, original Node/k6 conformance, all six social/interruption cases, auth smoke and pilot shutdown passed. Subsequent changes are confined to new calibration target/entry/tests: an observed-red refresh-header rejection guard and an observed-red raw warm-up validation counter check. Both are included in the final 48-unit/native calibration rerun below. Auth implementation/transport/social controller are unchanged; auth proof stays historical under original source hashes (new build/package metadata differs).
- User confirmed plugging into power after the host reported battery; **AC power was verified** before timed calibration. **`calibration-final-native-and-ac-rate-ladder` (`proc_f681`)** passed final units/native calibration tests, then stopped invalid after its first full-rate stage: **`results/calibration-t8fJS3/`** preserves 501 successful measured reads at 25/s but an auxiliary cgroup `docker exec` exited **137 at runner exit**, causing `collector_error`. Runner itself exited 0, no OOM was observed, but this does not prove the auxiliary termination harmless: **do not suppress 137 or weaken the existing exact-code-1 terminal-race exception**. Original report remains invalid, all later stages were skipped, and checked cleanup released the lock/removed ephemeral resources. No data/volume repair or automatic retry occurred.
- The explicitly announced independent attempt **`proc_aeaf` stopped invalid after 90 seconds**, **`results/calibration-x9rfN8/`**: 25/100 stages had valid evidence; 400/s completed 8,001 measured reads without SDK failure, but its auxiliary cgroup reader exited **127 with empty stderr at normal container exit**. No automatic retry or skipped validation; 1,600/s was not attempted. Cleanup passed. Both 137/127 failures remain original invalid evidence; no full ladder result was claimed.
- Root-cause fix: **same-container OS-only Node telemetry supervisor** (`src/calibration-runner.js`) starts the **unchanged k6 binary/SDK workload**, samples its actual shared cgroup each second, captures final counters after k6 exits, and propagates its exit/signals. No Node API traffic/proxy, new container, fake counters or exception broadening; Node telemetry cost is inside the runner's fixed 2-CPU/1-GiB budget. `startMonitor` has an optional self-cgroup-file mode for calibration only; default pilot behavior and exact-code-1 race rule are unchanged. External lifecycle/stats remain independent. Original snapshots are ingested with capture/receipt times; missing final data, malformed/truncated/gapped/reordered evidence fails closed. Three new tests observed red, then green, cover real snapshot-file reads, missing counters and parser/final/gap rules; native integration additionally requires final original self-cgroup evidence.
- **`calibration-self-cgroup-native-regression` (`proc_39d8`) exited 0 after 35 seconds**: all **51 units** and both serialized native normal/cancellation tests passed with the new collection mode.
- **`calibration-self-collector-full-regression-and-ac-proof` (`proc_ff89`) exited 1 after 101 seconds only because its subsequent AC precondition failed**. All **51 units**, image builds, three-fresh-smoke baseline proof, original conformance, all six social/interruption cases and native auth smoke passed against the final optional shared-monitor implementation; pilot shutdown also passed. The corrected full ladder **did not start**. A separate immediate `pmset` check confirmed Battery Power at 100%, despite the user's earlier plugged-in confirmation. Do not mislabel this as a code/test regression or run the timed reference experiment on battery without explicit exception approval.

Immediately before publication, **`calibration-precommit-verification` (`proc_0eba`) passed all 51 unit tests**. All full-calibration implementation/config/bundle hashes still matched current files; all four resource summaries were freshly replayed and matched exactly. Only documentation changed after native verification. Private fixtures, raw results and generated bundles remain excluded from the commit.

### Full bounded calibration: `results/calibration-lxJZLK/`

**`calibration-corrected-collector-ac-full-ladder` (`proc_b5fb`) exited 0 after 119 seconds**. User reconfirmed AC; it was verified immediately before/after the ladder (22:21:08 -> 22:23:06 UTC, 2026-10-20). Temporary caffeinate assertion ended. No implementation/config/bundle changed during measurement or verification. Exact original controller streams, `power.json` and independent `audit.json` are retained with the original per-rate artifacts.

| Offered SDK page reads/s | Measured completed | Completed/s (20s window) | Dropped measured iterations | Strict zero-drop delivery | Logical p95 ms (descriptive only) |
|---:|---:|---:|---:|---|---:|
| 25 | 501 | 25.05 | 0 | yes (one-iteration endpoint tolerance) | 8 (insufficient samples) |
| 100 | 2,000 | 100.00 | 0 | yes | 6 |
| 400 | 7,999 | 399.95 | 1 | **no** | 10 |
| 1,600 | 21,134 | 1,056.70 | 10,867 | **no** | 50 |

- **All four stages have valid SDK/resource evidence**, zero payload/HTTP failures among started reads (authentication deliberately not exercised), all runner exits 0, no observed OOM/restarts/health/policy loss or missing final snapshots. `report.valid: true` means usable evidence, **not** delivery of every offered rate. `certified: false`, `generatorHeadroom: unverified` remain explicit. Open-model iterations are not active-human users or TrailBase capacity.
- k6 warned that the **fixed 32-VU allocation was exhausted** at 400/1,600 offered reads/s. The 400 stage's one drop still fails the strict zero-drop criterion; the 1,600 stage misses materially. Do not label 100/s a general maximum, infer CPU saturation solely from utilization, or attribute the limit exclusively to SDK/k6, target, host or VU allocation. This single short ladder is not repeatability, soak or full authenticated-workload calibration.
- Independent audit parsed the complete original gzip JSON streams; exact measured started/completed/drop counts and both logical/non-HTTP p95s matched saved summaries. Recomputing each resource summary from **847 original observations** matched exactly. Every ingested runner cgroup source/capture timestamp/elapsed/final flag matched its original self-sampler row, including final counters; no terminal errors were suppressed. All manifest implementation/config/bundle hashes matched current files. Public files (including compressed data and controller streams) passed password/token-field/JWT-shaped-value scans; no credentials or JWTs were used/persisted in calibration.
- Target sampled CPU peaks 0.1200/0.1250/0.1407/0.1093 cores; runner 0.2447/0.5905/1.0888/1.8210 cores. These cover startup/warm-up/measurement/cleanup, not measurement-only. Target CPU-throttle deltas all zero; runner deltas 1,181/3,092/1,758/8,137 microseconds. Low/near-quota utilization is not headroom proof. Actual target/runner CPU/memory/no-swap policies and image/platform/source provenance were checked.
- AC verified at endpoints, **not continuously sampled**; thermal/frequency/host contention remain uncalibrated. The OS-only Node sampler shares the runner budget; main workload/auth paths remain unchanged. Both earlier failed full attempts are retained and **not repaired/promoted**.
- Successful cleanup removed only owned ephemeral containers/network. Pilot volume was never mounted by calibration; before/after metadata matches. No retained volume was deleted. No active fixture/operation/recovery lock, project containers, monitor/Docker-stats process or sleep assertion remains; original private failure archives remain 0700/0600 and ignored. Publication was subsequently explicitly requested by the user.
- Final post-proof `npm test` **`calibration-final-unit-verification` (`proc_62d6`) exited 0**; all 51 units passed. No source changes after the full proof.

## Long-lived native authentication (verified)

Restart confirmed clean local/origin/actual remote `main` at **`49fa4c9e3a43d7c2d613a220b4b7dfc546eeb48a`**. The user subsequently explicitly authorized committing/pushing this completed milestone.

- Added `src/auth.js` with numeric/boolean per-session evidence gates and a fail-closed separate correctness report. Three new unit tests were observed red against stubs, then green: reject short elapsed time, clock/TTL changes, early/absent refresh, unchanged tokens, missing post-expiry reads/identity/logout, failures and missing/partial summaries. Five-second smoke never claims natural expiry.
- Added `tests/auth.integration.js`; native red test **`auth-smoke-red-native-test` (`proc_ad58`)** failed for the expected missing `auth-smoke` command, then its finally block SDK-reset the ready fixture and stopped the pilot. Original logs retained.
- Implemented separate `src/k6/auth.js` entry (two users with the existing smoke fixture; **not** accelerated token/session policy). One login per VU, protected own-like reads every five seconds, SDK automatic refresh only, real 3,600-second TTL and original expiry+30 seconds, identity/row checks, changed/extended token, successful logout. Uses runner elapsed time as well as wall clock; no fake clocks, manual refresh, HTTP-only fallback or alternate runner.
- Pinned SDK source (`node_modules/trailbase/dist/index.js`) confirms automatic refresh when `exp - 60 < now`; natural proof must observe refresh no earlier than this window and subsequent protected reads beyond the original expiry. It is not an expired-JWT rejection test.
- New `auth|auth-smoke` controller paths reuse original fixture, expected pilot volume, lock, runner ownership, resource monitor, cancellation/recovery and single-use guards. Recovery lock command stays the existing generic `run`, with explicit auth kind/mode metadata. Normal workload sessions/weights are unchanged. Build includes the separate bundle; manifests hash its sources/transport/build/bundle. No dependency added.
- **`auth-check-full-native-regression` (`proc_a096`) exited 0 after 104 seconds**: all **45 unit tests**, bundles/images, three-fresh-smoke proof, original conformance, all six social/signal cases, and native auth smoke passed, followed by pilot shutdown. Auth smoke **`results/social-aqEMmo/`**: two logins, zero refreshes, TTL exactly 3,600 seconds, per-session elapsed 5.03 seconds, valid resource evidence, unchanged application counts, `naturalExpiryCovered: false`. Source/config/bundle hashes matched; integration scanned all public artifacts including compressed metrics against actual fresh passwords and proved SDK reset/zero posts.
- **`auth-per-vu-evidence-red` (`proc_5d21`) failed as expected** (missing independent per-VU numeric evidence), with SDK reset/pilot shutdown successful. Added raw `auth_check_session` numeric points, tagged only by VU ordinal and fixed field names: claim times, runner/wall timing, refresh/read/failure counts and identity/logout/token-change booleans. No tokens, credentials/native IDs or raw errors. Missing/non-numeric values use an explicit -1 sentinel, not fabricated zero. **`auth-per-vu-evidence-green` (`proc_dd79`) exited 0 after 18 seconds**: all 45 units and the strengthened native auth integration passed, followed by pilot shutdown. The native test verified both VUs' raw numeric fields and rescanned all public/compressed artifacts against actual fresh passwords.

Immediately before publication, **`natural-auth-precommit-verification` (`proc_ee97`) passed all 45 unit tests**. The hour-long proof's implementation/config/bundle hashes were freshly compared with current files and still matched; both audited sessions passed `sessionValid` again. Only documentation changed after native verification. Private fixtures, raw results and generated bundles remain excluded from the commit.

### Real-TTL proof: `results/social-OO5e3J/`

**`natural-one-hour-sdk-auth-proof` (`proc_7927`) exited 0 after 3,642 seconds**: pilot startup, four-account fixture preparation, two-VU k6/SDK natural auth check, independent raw-session/source/privacy audit, explicit SDK reset, zero-public-post verification and pilot shutdown. Temporary `caffeinate -i` assertion ended with the job. No implementation/config/bundle was changed during the proof; hashes were rechecked after completion.

| Evidence | Result |
|---|---|
| Native TTL (initial and refreshed) | 3,600 seconds, unchanged |
| Active users / initial logins | 2 / 2, separate clients/jars/identities |
| Actual elapsed per VU | 3,629.594 / 3,629.595 seconds |
| Automatic refreshes | 1 per VU, 2 total; no manual refresh/re-login |
| Refresh timing | about 3,543.358s after login, **56.206s before original expiry** |
| Protected own-like reads | 726 per VU, 1,452 total |
| Reads after original expiry | 7 per VU, 14 total |
| Auth/HTTP failures | 0 / 1,458 requests |
| Completion | both original sessions preserved identity, changed/extended tokens, logged out; zero interrupted iterations |
| Application counts before/after | unchanged: 4 accounts, 40 posts, 40 likes |

- `report.json`: `kind: native-sdk-auth-correctness`, `mode: natural`, `valid: true`, `naturalExpiryCovered: true`, **`certified: false`**. This proves natural SDK pre-expiry refresh plus authenticated continuity beyond the **original** expiry, not sending/rejecting an expired JWT, a weighted-workload capacity/SLO result, or overnight soak qualification.
- `audit.json`: both sessions reconstructed from original compressed raw `auth_check_session` points and independently passed `sessionValid`; all manifest source/config/bundle hashes matched. Before credential deletion, every public artifact/compressed metric was checked against actual current fixture passwords and password/auth-token/refresh-token fields. No JWT/refresh token persisted.
- SDK 0.14.3, runner linux/arm64; backend actual Docker/cgroup budget verified **1 CPU / 4 GiB / no swap**. **26,385** original resource observations; fresh replay with `summarizeResources` exactly matched both saved resource summary and report. No observed restart/OOM/health/policy loss, zero OOM/throttle deltas, final runner exit 0, no rejected coverage gaps; generator headroom remains **unverified**.
- Allocated service storage 239,296,512 -> 241,643,520 bytes while application counts stayed unchanged. This includes auth/WAL/allocation effects, not application payload growth; no specific cause or capacity inference is claimed.
- Final SDK reset removed the generated accounts/application rows and private active fixture; a separate SDK public count proved **zero posts** before shutdown. Inspection confirmed no project containers/retained runners, monitor/Docker-stats processes, active fixture/operation/recovery locks or sleep assertion. Two original failed-baseline credential archives remain private/ignored; no retained volume was deleted.
- Final `npm test` **`natural-auth-final-unit-verification` (`proc_9059`) exited 0** after completion; implementation remains unchanged. Publication was subsequently explicitly requested by the user.

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

**Post-baseline cleanup (before the active authentication work above):** no running managed jobs, project containers/retained runners, monitor/Docker-stats processes, active `.fixtures/trailbase.json`, operation lock or recovery claim. Two original failed-test fixtures remain archived privately under `.fixtures/archive/` (0600 files/0700 directories); their owned namespaces were separately SDK-cleaned and verified empty. New trial volumes are intentionally retained, never deleted; they are API-cleaned and **not pristine reusable baselines**. The original named pilot volume/images also remain. No physical snapshot, cold-host-cache equivalence, workload repeatability or capacity/headroom certification is claimed.

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
- Reports record numeric access-token TTL ranges and refresh-request counts, not tokens. TrailBase access TTL is 3,600 seconds. Default weighted sessions are shorter; do **not** infer their refresh coverage from duration. Forced refresh is tested in conformance; the separate two-user real-TTL check above now verifies natural automatic refresh/continuity.
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
- `tests/*.test.js`: 51 current Docker-free tests (20,000-pool regression, resource/parser/exit-race tests, asynchronous runner/abort/escalation tests and ownership/stale-lock refusal/recovery tests). `tests/pilot.integration.js`: original Node/k6 conformance. `tests/social.integration.js`: six cases—native exit-99 probe; full SDK/resource smoke; active-workload SIGINT, SIGTERM and SIGKILL+explicit recovery; and SIGTERM during native API preparation. Interrupt artifacts are checked for passwords/tokens, used baselines are refused, credentials survive recovery unchanged, and explicit SDK cleanup confirms zero public posts.

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

- No capacity discovery, repeated performance certification, soak or headroom proof yet. Natural refresh/continuity is verified only in the separate two-user real-TTL correctness check; default weighted sessions do not themselves reach expiry. Short fixed-VU evidence is not a maximum-user result.
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

1. Long-lived native authentication is complete and committed at the user's request. Confirm publication against actual git tips/status; preserve original proof/audit/raw evidence and private failure archives/retained volumes. Do not automatically commit/push subsequent work.
2. **Partial local read calibration is complete and committed at the user's request**; confirm actual publication against git tips/status and do not automatically publish subsequent work. Next bounded experiment: isolate the observed fixed-32-VU delivery limit (e.g. a separately recorded larger preallocated pool at the same offered rates and 2-CPU/1-GiB budget, with enough memory and unchanged SDK/payload/output/monitoring), not a backend capacity search. Do not assume a bigger pool fixes it. Keep current results/failed attempts intact; no statistical/headroom claim from one short ladder.
3. Larger/separate-runner confirmation near a real backend boundary remains required for **full generator headroom**. Discuss actual available hardware; ask before remote automation/new runner topology or any HTTP-only/different-runner fallback. Partial anonymous reads, low sampled CPU or the two-user auth check cannot replace that confirmation.
4. Complete that evidence before capacity search/other adapters. Future performance campaigns need explicit owned fresh-deployment integration; the ordinary workload controller still deliberately refuses these non-pilot proof volumes. Never bypass that guard or reuse the API-cleaned proof volumes as pristine baselines. Utilization is not headroom/capacity certification. Host/daemon power-loss, exhaustive fault injection and overnight-soak support remain unverified.
5. Run applicable suites after code changes, avoid overlapping tests/workloads, preserve original evidence, update this checkpoint with exact resource state and do not print secrets. Historical passes do not certify changed source.

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
