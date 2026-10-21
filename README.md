# BaaS Bench

API-only, SDK-based capacity benchmarks for self-hosted backend-as-a-service systems. Start with [the benchmark plan](BENCHMARK_PLAN.md). To resume development, read [PROGRESS.md](PROGRESS.md) for the current checkpoint, verified work, and next steps.

**Current milestone: API-only fixtures, exploratory weighted workload, observability/recovery, fresh-deployment logical baseline proof, a verified fresh-deployment 50-user sizing pilot and separate real-TTL SDK authentication verification—not capacity certification.** TrailBase conformance and the stateful workload use **17% likes / 5% unlikes**. Two-user natural refresh/continuity and a separate partial local SDK read calibration are verified; neither resource observations nor synthetic reads certify full generator headroom. Capacity search, repeated performance certification and soak remain deferred.

## Requirements

- macOS/OrbStack or Linux with Docker Engine and Docker Compose; the pilot currently verifies **cgroup v2** limits.
- Node.js >=24.11 and npm on the controller host for bundling and test orchestration.
- Git, plus outbound access to npm and Docker registries during installation/build.
- Port 4000 available on localhost. No cloud account or external auth service required.

Pinned runtime: **TrailBase 0.35.1**, official **trailbase SDK 0.14.3**, **k6 2.3.0**, and runner **Node.js 24.11.0**. Container bases are pinned by multi-platform image digest; npm dependencies have an integrity-locked lockfile. Native ARM64 is used on the M1; AMD64 is available on corresponding Linux hosts. No host k6 installation is needed.

## Run the pilot

```sh
npm ci
npm test
npm run pilot:up
npm run pilot:conformance
```

`pilot:up` builds the backend and combined Node/k6 runner, then starts only TrailBase. `pilot:conformance` builds the k6 script, verifies the running backend's Docker and actual cgroup limits, runs native Node SDK conformance in a temporary runner container, then runs the same contract in two concurrent k6 VUs. There are only two running containers at a time. Each SDK client has a separate cookie jar in k6.

Re-run `npm run pilot:up` after changing runner sources/dependencies so its image contains the same contract as the k6 bundle. For automated verification including artifact assertions:

```sh
npm run test:pilot
```

This integration test requires the prepared backend/runner images from `pilot:up`. It is separate from the fast, Docker-free `npm test` suite. Do not run conformance and its integration test simultaneously against the same pilot: each intentionally inserts temporary public posts while checking latest-page behavior.

Stop containers without removing the data volume:

```sh
npm run pilot:down
```

### Configuration changes and reset

The named volume is initialized with schema/configuration from the backend image on its **first** use. Rebuilding the image does not replace files already in the volume. During this pilot, apply provisioning changes by explicitly resetting **only this project's disposable pilot volume**:

```sh
# Destructive: deletes all data in the isolated baas-bench-2-pilot project.
docker compose down --volumes
npm run pilot:up
```

Do not point this conformance suite at a production/shared backend. Successful checks remove their freshly registered accounts and cascade their data through native account APIs; an interrupted/failed test may leave disposable test accounts. The backend also creates its normal bootstrap administrator; the benchmark never uses that account.

## What is tested

One shared contract exercises the unmodified official SDK in Node and k6:

- Native username/password registration and login; independent user identities and tokens.
- Create/read/edit posts; approximately 1-KiB initial bodies; service-generated timestamps.
- Public reads, server-side own-post filtering, 20-record pages, descending timestamp/native-ID ordering, and no requested total count.
- Like, own-like listing, unlike, duplicate-like rejection, and invalid foreign-key rejection.
- Owner spoofing, protected-field mutation, cross-user edits/deletes, private-like access, and anonymous write denials.
- Forced SDK token refresh; server-side session revocation after logout; login again.

All accounts and application rows are created through the SDK. The only SQL is a **native TrailBase schema migration** containing DDL/indexes/a timestamp trigger, not data insertion or a direct database client. Ownership is enforced using native Record API rules. Admin APIs listen only on container loopback; the public API is published only to host loopback.

The SDK's supported `Transport` hook delegates HTTP to `k6/http.asyncRequest`. Core-js supplies URL/URLSearchParams, and k6 encoding supplies the `atob` JWT-decoding primitive. No SDK fork, HTTP bridge, SQL driver, or alternate test API is used. This proves the exercised auth/Record API paths only—not arbitrary SDK exports, uploads, streaming, realtime, or browser features. The SDK's optional `urlSafeBase64Decode` utility encountered a k6 `Uint8Array.from(string)` limitation; the ordering assertion uses the platform `atob` primitive instead, without changing any SDK API operation. The adapter implements only the fetch-response subset those paths need, with redirects disabled and a 10-second timeout.

## Evidence and interpretation

Every conformance run creates a unique ignored directory, `results/conformance-<suffix>/`, containing:

- `manifest.json`: source revision/dirty flag, source hashes, server/SDK versions, runtime image IDs/platforms, Docker limits and actual cgroup values.
- `node-stdout.log`, `node-stderr.log`, `node-exit.json`.
- `k6-stdout.log`, `k6-stderr.log`, `k6-exit.json`.
- Original `k6-summary.json` and compressed timestamped `k6-metrics.json.gz`.

Expected success: **45 native SDK checks**, **90 k6 checks**, and **2 completed k6 conformance sequences**. A completion threshold prevents uncaught asynchronous errors from producing a false pass even if all checks reached before the error succeeded. Failed-run evidence is kept.

The suite deliberately sends requests that must be rejected. Consequently, a high `http_req_failed` percentage here is expected; conformance is decided by exact assertions and completion thresholds, **not** by applying the workload's <1% error SLO to negative security tests. Do not interpret these short-run timings as a benchmark or user-capacity result.

Backend limits: **1 CPU quota**, **4 GiB RAM**, **no swap**. The controller verifies both Docker runtime settings and `cpu.max`, `memory.max`, and `memory.swap.max` in the container. These are container limits, not proof of equivalence to a whole 4-GiB VPS. Full generator headroom and sustained performance are not yet verified. Backend logging is bounded and set to warnings so generated administrator credentials are not printed during normal startup.

## API-only dataset and weighted workload

The initial controller is restricted to the local Compose pilot: native SDK preparation talks to `http://127.0.0.1:4000`; containerized k6 talks to the same service at `http://trailbase:4000`. It checks the expected pilot volume and runtime limits. Do not repoint it at a shared service or remote Docker daemon. Native preparation runs on the controller's Node.js; its actual version is recorded. The measured runner remains image-pinned.

```sh
npm run pilot:up
npm run dataset:prepare                      # configs/pilot-small.json
npm run workload:run                         # same config, fresh user logins
npm run dataset:reset                        # deletes only fixture-owned accounts via SDK
npm run pilot:down
```

`pilot-small` creates **1,000 accounts, 10,000 posts, and 10,000 likes**. Each account owns 10 posts and 10 distinct likes. Registration, login, every write, verification, logout, and normal cleanup use official SDK methods. Seeding is sequential (concurrency one), with no automatic retries. Logical payloads are reproducible from the configured seed and logical user/post indexes; passwords, native IDs, usernames, and service timestamps are intentionally not deterministic. Bodies are 1,024 bytes of deterministic pseudo-random ASCII, not padding-only strings. The actual seed span/timestamp precision is recorded.

Before accepting a baseline, the seeder verifies login identity, exact payloads, owned-row counts and IDs, like references/ownership, and the public post total. A nonempty deployment or existing fixture is refused rather than overwritten. It verifies the same baseline again before starting timed traffic.

For a tiny automated end-to-end test (four accounts, accelerated think/session times):

```sh
npm run pilot:up
npm run test:pilot                          # run before fixture preparation
npm run test:social                         # prepares, exercises all actions, resets through APIs
npm run pilot:down
```

Or run the tiny workload manually:

```sh
npm run dataset:prepare -- configs/smoke.json
npm run workload:run -- configs/smoke.json
npm run dataset:reset -- configs/smoke.json
```

Do not run seeding, conformance, or another workload concurrently against the same backend. Controller operations acquire an exclusive local lock, but standalone conformance commands and other machines are not coordinated by it.

### Repeated fresh-deployment baseline proof

With the pilot stopped and no fixture/operation/recovery lock outstanding:

```sh
npm run baseline:prove                       # three fresh pilot-small preparations
# Or a small correctness integration (images must already be built):
npm run test:baseline
```

The proof uses the same fixed Compose project, loopback API, image pins and resource budget, but creates **three separately named, labeled local volumes**. An explicit external-volume override selects each new volume; the retained `baas-bench-2-pilot_trailbase-data` is never mounted or deleted. Existing project containers/networks or active private fixtures are refused. Compose may warn that the retained project volume differs from the override and is left untouched; that is expected—do not follow its generic removal suggestion. The ordinary workload controller's pilot-volume guard is unchanged: this is preparation proof, not a new campaign runner or arbitrary-target option.

Each trial registers/seeds/verifies through the official SDK, then independently verifies again. `verifyFixture` computes an incremental SHA-256 over API-observed post titles/bodies, logical user/post indexes and verified like edges (`api-verified-logical-baseline-v1`). It checks the deterministic like recipe, not just counts or agreement with a possibly modified fixture. Native IDs, passwords, usernames and timestamps are excluded from this logical hash; native identities must differ across the three trials. Seed durations and timestamp spans are recorded separately. Equivalent logical graphs do not promise identical latest-feed ties, physical allocation, host caches or performance.

Evidence is in ignored `results/baseline-<suffix>/`: exact Compose overrides, per-trial runtime/source hashes, API counts/logical hashes, native-identity hashes and a final `report.json`. A success requires three matching logical hashes, separate volumes/identities, unchanged retained-pilot metadata, zero public posts after explicit SDK account deletion, and checked backend shutdown. No JWTs or refresh tokens are saved; credentials remain private until successful API deletion.

**Trial volumes are retained, not deleted.** They have been API-cleaned and are no longer pristine baselines; do not reuse them for performance comparisons. Their exact names/ownership labels are recorded in the report. Interrupted/failed preparation retains private credentials and failed evidence; inspect the recorded trial volume rather than pointing the ordinary reset command at it. Uncertain resource cleanup retains the operation lock. `recover` can release a supported stale lock but does not repair partial data or clean up these trial backends/volumes. No existing volume is automatically removed. This proof does not certify capacity, generator headroom or host/daemon crash recovery.

### Bounded fresh-deployment workload sizing

The approved **50-active-user** sizing pilot and its fresh-deployment path are verified—not capacity discovery. Full proof: **`results/baseline-22AxEE/`** (deployment/preparation/cleanup) and **`results/social-hVkOUc/`** (timed workload). All 55 units and every applicable original/new native suite passed; see **PROGRESS.md** for provenance and limitations.

With both projects stopped and no active fixture/operation/recovery claim:

```sh
npm run build
docker compose build trailbase runner
npm run test:fresh-workload       # normal tiny run, active SIGTERM, non-pilot CLI refusal
# Once all applicable original and new regressions pass:
/usr/bin/caffeinate -i npm run workload:sizing  # macOS idle-sleep prevention; no power check
```

The full command API-seeds a newly created, exactly labeled volume with **1,000 accounts / 10,000 posts / 10,000 likes**, independently verifies it, then runs the existing SDK/seven-action workload at **50 VUs**. It preserves normal 1–5-second pauses, 300–900-second sessions and the **30s ramp + 60s warm-up + 120s measurement**. The generated resolved config is retained; `configs/pilot-small.json` and the ordinary workload command remain unchanged. Runner limits are explicitly **4 CPUs / 2 GiB / no swap**, with original startup cgroup and independent lifecycle checks. TrailBase remains **1 CPU / 4 GiB / no swap**. The existing same-cgroup OS supervisor captures final counters; all API traffic remains direct SDK/k6. The bounded mode currently requires local ARM64 runtimes, no VM changes or remote host.

Implementation reuses `scripts/baseline.js --workload` (one fresh deployment instead of the default three preparation-only trials) and the shared existing workload lifecycle. `--workload --smoke` uses the original two-VU accelerated correctness config; there are no arbitrary target, budget or VU options. The ordinary social CLI still refuses these non-pilot volumes.

The root `results/baseline-<suffix>/` records exact volume/override/preparation/config metadata and links to timed `results/social-<suffix>/` raw evidence. Success requires usable workload/resource evidence, explicit SDK account cleanup/zero public posts, unchanged retained-pilot metadata and checked shutdown. **All volumes remain retained**, and API-cleaned volumes are not fresh baselines for another trial. Failed/interrupted fixtures stay private and are not automatically reset/retried. New locks use **`command: fresh-workload`**, deliberately unsupported by social `recover`: uncatchable death or uncertain cleanup requires manual inspection of the exact recorded owner, runner, monitor, volume and backend. Do not blindly remove claims, adopt the volume with ordinary pilot commands or delete data volumes.

The full pilot completed **1,978 measured actions in 120 seconds (16.48 actions/s)**, zero observed action/auth/HTTP failures, all 50 users finished and no interrupted iterations. Measured public/own/read/create/like/unlike/edit counts: **708/279/294/118/326/116/137**. Descriptive p95s were **7–15 ms**, but **every action had fewer than 1,000 samples**; there were no measurement-phase logins. No per-action/login SLO certification follows. Initial 50 logins had the unchanged 3,600-second TTL; no renewals/refreshes were expected in this short run.

Sampled memory peaks were **230.2 MiB backend / 273.3 MiB runner**, CPU **0.1557 / 0.3556 cores**; no observed OOM/restarts/policy loss/throttling. These samples span multiple phases and can miss bursts; low usage is not headroom proof. Independent raw-count/p95/p99/resource/final-cgroup/source/policy/baseline/privacy-pattern/cleanup audits passed. SDK cleanup proved zero public posts, the fresh volume is retained and pilot metadata unchanged. Native smoke also checked actual credential values; the full 1,000-account fixture was deleted before the post-run audit, so a separate full per-password comparison was not performed.

This short sizing run cannot certify natural refresh, large authenticated identity pools, full generator headroom or user capacity. A further bounded load increase requires a separately scoped decision; no discovery or publication follows automatically. The user explicitly requested publication of this completed milestone; later work is not automatically published.

### Separate long-lived authentication check

With the pilot stopped and no active fixture/operation, run the native tests first:

```sh
npm run pilot:up
npm run test:auth                 # prepares/resets its own small fixture; about 10 seconds
node scripts/social.js prepare configs/smoke.json
npm run auth:check                # real default TTL; about 61 minutes, not a smoke/performance test
node scripts/social.js reset configs/smoke.json
npm run pilot:down
```

`auth:check` uses the **same guarded k6 runner, official SDK transport, private fixture and recovery/telemetry lifecycle**, with two distinct users. Each logs in once, reads its protected own-like collection every five seconds, lets the SDK automatically refresh, crosses the original token's actual expiry, checks identity/data, then logs out. Default TTLs/clocks, weighted-workload session policy and backend resource settings are unchanged. The pinned SDK refreshes within 60 seconds **before** expiry; this checks natural refresh and continuity past original expiry, not sending an expired JWT or manually forcing refresh.

A separate five-second `node scripts/social.js auth-smoke configs/smoke.json` exercises the path cheaply but **cannot claim natural expiry**. Both consume the fixture before launch. Reports remain `certified: false`; a natural pass requires every VU to verify the one-hour TTL, sufficient elapsed runner time, timely successful automatic refresh, a changed/extended token, protected reads after original expiry, stable identity and successful logout. Missing/failed/resource-interrupted evidence fails closed. Keep the host awake throughout; interrupted/invalid runs require explicit reset/reseed, never a retry on the used fixture. `recover` uses the existing run ownership checks and never repairs application data.

Evidence is under ignored `results/social-<suffix>/`, with `kind: native-sdk-auth-correctness`, explicit `mode`, and `naturalExpiryCovered`. Raw `auth_check_session` points carry per-VU ordinal tags and numeric claim/timing/refresh/read/logout evidence for independent replay. No token values or native identities are added to auth metrics. This is not the weighted workload, a throughput/SLO result, or an overnight memory/soak qualification. The two-user real-TTL proof passed in **`results/social-OO5e3J/`**: 3,600-second TTL, one natural refresh per user, 14 protected reads after original expiry, successful logout and SDK cleanup, zero auth/HTTP failures. Raw-session/source/privacy audits and resource replay passed. See **PROGRESS.md** for exact evidence and source provenance; these ignored artifacts are local, so fresh clones must rerun the check.

### Credentials, sessions, and failure recovery

- Credentials and API-returned IDs live only in ignored `.fixtures/trailbase.json` (0600) inside `.fixtures/` (0700). That directory is also excluded from Docker build contexts. It is mounted read-only only for the workload runner; never publish it.
- JWTs and refresh tokens stay in memory and are **not persisted**. Preparation logs out; each VU logs in afresh with a distinct account. k6 `SharedArray` loads the fixture once and each VU copies only its own mutable state.
- Each VU keeps its SDK client between actions. Native SDK token refresh remains enabled. Users renew sessions via logout/login after 5–15 minutes, while think time is 1–5 seconds. Separate deterministic PRNG streams control action selection, pacing, session lengths, and targets.
- User arrivals ramp over 30 seconds, followed by 60 seconds of warm-up and 120 seconds of constant-VU measurement in the default config. Initial login is warm-up; subsequent login/logout/refresh requests are tagged and measured separately. SDK refresh/prerequisite calls triggered during an action remain inside action latency.
- Normal completion attempts logout for every VU. Forced interruption can prevent cleanup. Actual access-token TTL ranges and observed refresh-request counts are reported; the default one-hour token TTL exceeds the weighted workload's configured session lengths, so those runs do not claim natural refresh. Conformance tests forced refresh; the separate long-lived check above verifies natural automatic refresh/continuity.
- The fixture is marked **used before** k6 launches, including failed runs. A second run is refused until reset/reseed. Normal API reset checks *all* fixture identities before deleting any and checks identity again for each deletion. Credentials are retained if cleanup fails.
- `SIGINT`/`SIGTERM` cancel controller API requests and stop the asynchronous Docker client. The controller then checks the runner's exact run label, project, service, name and original image, pins cleanup to its inspected container ID, sends SIGINT with a 10-second stop grace, captures final monitoring state and removes only that runner. Exit codes are 130/143. Normal lock release waits for cleanup; cleanup failures retain the operation lock for explicit investigation/recovery.
- Interrupted workload artifacts include `interruption.json` (`valid: false`), original streamed stdout/stderr and available metrics/failure metadata. A report, if available, cannot be valid after interruption. Force-stopped k6 may leave missing summaries or truncated gzip streams; these remain original failed evidence, not repaired/fabricated results. JWT revocation/logout is best-effort under interruption.
- `SIGKILL` cannot run controller cleanup. The monitor detects parent IPC loss and shuts down; a run-owned container and private operation lock may remain. Use explicit recovery below, never blindly remove the lock. Normal commands also refuse an active/stale recovery claim.
- Interrupted/failed seeds remain private `failed` fixtures and are not resumable baselines. Partial-seed recovery still requires an explicitly approved reset of this project's isolated deployment, then removal of its obsolete private fixture and API reseeding; `recover` does not repair or delete application data. Interrupted deletion can have an uncertain last server commit; identity preflight remains fail-closed rather than guessing an account is gone.

After an uncatchable controller death or failed resource cleanup:

```sh
# Works even if the backend is stopped; Docker must be reachable.
node scripts/social.js recover
# With the backend running, explicitly reset using the fixture's original config:
node scripts/social.js reset configs/smoke.json  # example only; use the actual config
```

`recover` validates the private versioned operation record, refuses a live/inaccessible/reused controller PID or still-live recorded monitor PID, and rechecks all container ownership fields before any stop/remove. It does not kill arbitrary OS PIDs, delete credentials/accounts, reseed or retry a workload. Successful recovery releases only the stale operation lock and writes a separate ignored `results/recovery-*/recovery.json`. A used baseline still requires explicit API reset/reseed. Unknown/empty/corrupt/insecure locks, a stale recovery claim, or ownership mismatch require manual investigation; the controller never infers ownership or force-cleans them. Allow the monitor to finish before retrying recovery if it is still shutting down.

API reset restores logical application counts, **not** database file layout, caches, auth-history state, or a physical snapshot. For comparable performance trials, use a fresh isolated deployment/volume and deterministic API reseed as specified in the plan. Delete no unrelated volumes. Remove a private fixture manually only after confirming its deployment has been reset or its accounts have been deleted.

### Targets, metrics, and interpretation

Actions retain bounded caches: up to 100 owned posts/likes and a page-sized public-ID pool. Reads select uniformly from that visible pool. Unlike uses a real own-like ID; edit changes a real own post with a new payload. Empty caches trigger native list prerequisites. Like checks native own-like state before inserting; its bounded search examines the current visible pool plus at most four feed-page requests, probing at most five uncached candidates per pool. It never substitutes another action or counts an in-memory no-op as a success.

TrailBase does **not** support cursors for our `created_at DESC, id DESC` ordering. Prerequisite feed pagination therefore uses the official SDK's `offset`, independently of latest-feed reads, wrapping after an empty page. Concurrent inserts can shift offset pages; native like checks prevent duplicate writes. Bounded-search exhaustion is recorded as `unavailable_target` and invalidates the workload rather than masquerading as backend capacity failure.

Each run writes a unique ignored `results/social-<suffix>/` with:

- `manifest.json`, shareable `fixtures.json`, exact `config.json`, source/config/fixture hashes, preparation provenance and actual runtime limits.
- Original k6 stdout/stderr, exit record, compressed timestamped metric stream and JSON summary.
- `resources.jsonl`: UTC receipt timestamps and monotonic elapsed milliseconds, with separately labeled backend/runner Docker-stats, lifecycle and cgroup observations. Docker stats stream continuously; lifecycle/cgroup polling sleeps one second between rounds. Collection includes startup, warm-up, measurement and k6 cleanup—not just measurement.
- Exact backend/runner stats streams (including Docker terminal-control bytes), stats/inspector stderr, monitor stderr/exit status and `resources-summary.json`. The timestamped parsed stream is additional evidence, not a replacement for raw stats output. Inspector fields are selected to exclude environment, mounted credentials and health-check log bodies.
- Resources include observed CPU cores (100% = one core), cgroup memory/current and lifetime peak, CPU throttling deltas, OOM counters, restart/start identity, health and final exit state. Missing optional metrics remain unavailable, not zero. The backend lifetime memory peak can predate this run; the reported observed peak uses `memory.current` samples.
- The workload runner is uniquely named/labeled and retained briefly after exit for final inspection, then removed only after full ownership checks. Catchable interruptions use the same checked cleanup; uncatchable death uses explicit stale-operation recovery.
- `report.json` and `report.md`: requested/completed/success/failed counts, observed mix, action p95/p99, login/refresh evidence, and API-verified start/end row counts plus allocated deployment storage. Storage includes auth/WAL/other service files, not just application payloads.

Logical action latency includes payload creation, SDK processing, automatic refresh, and all prerequisites; it excludes think time. Failures are recorded without automatic retries or action substitution. HTTP timing remains separate. Warm-up and measurement tags are separate; in-flight actions retain their start-phase tag. The timers have millisecond resolution. Normal workload traffic contains no deliberate permission-denial probes.

Reports label per-action tails **insufficient samples** below 1,000 observations, and login evidence separately uses measurement-phase logins. A requested-mix sanity check is applied only after 1,000 measurement actions, using a five-sigma binomial bound. `workloadValid` means workload completion/target/mix integrity. `resources.valid` additionally requires usable monitoring of both containers, no evidence gaps over five seconds in the stats stream, unchanged identities/resource settings, no observed OOM/restart/backend health loss, and normal k6 completion (exit 0 or threshold-failure exit 99). A threshold failure is reported as `runnerOutcome: thresholds_failed`, not confused with a generator crash; other nonzero exits invalidate the evidence. Missing/malformed samples or monitoring errors fail closed. Top-level `valid` requires both, **not** an SLO or capacity pass; check failures, thresholds, and evidence labels too. Every report is explicitly exploratory and `certified: false`.

`resources.generatorHeadroom` is always **unverified** at this milestone. Low observed CPU/memory does not exclude per-VU/single-thread limits, host/OrbStack contention, socket pressure, thermal throttling or output/monitoring overhead. Controlled generator calibration and confirmation using a larger/separate runner near a real backend boundary are still required. Sampled stability means no instability was *observed*, not a soak/recovery certification. The pilot collector retains observations in memory while also writing raw files; bounded-memory aggregation is required before overnight soaks.

## Local SDK/k6 calibration (separate synthetic target)

This checks **the traffic generator, not TrailBase**. With the pilot stopped and no active fixture/operation/recovery claim:

```sh
npm run build
# Builds the existing pinned Node/k6 image only; does not start TrailBase.
docker compose build runner
npm run test:calibration          # small native SDK/resource test and SIGTERM cleanup regression
npm run calibration:run           # bounded four-rate experiment, about two minutes
npm run calibration:run -- --compare-vus  # same four rates at 32 then 128 VUs, about four minutes
npm run calibration:run -- --compare-budgets # fixed 128 VUs, 2-CPU/1-GiB then 4-CPU/2-GiB
```

The separate `baas-bench-2-calibration` project has an internal network, no published ports and **no persistent volumes**. It uses the existing image, official SDK and unchanged k6 transport. A small synthetic server returns an uncompressed static page of 20 posts with deterministic 1,024-byte bodies; every field of every returned row is validated. Warm-up as well as measurement validation failures are counted. No users, credentials, JWTs, database, writes or fake authentication are involved. Auth routes, mutations, arbitrary queries and requests carrying auth/cookies are rejected. The real TrailBase deployment/data is never mounted; retained pilot-volume metadata is compared before/after.

The open-model experiment offers **25, 100, 400 and 1,600 SDK page reads/second**, sequentially, each with 5 seconds warm-up, 1 second drain and 20 seconds measurement. By default each scenario has 32 preallocated/max VUs. `--compare-vus` runs a fresh runner at **32 then 128 preallocated/max VUs for each rate**, holding the SDK/payload, CPU/memory/no-swap budgets, timing, raw output and monitoring fixed. It records the plan in the manifest and each trial's actual pool allocation; native `vus_max` must match. The two profiles are sequential, not randomized/repeated, so this is an allocation diagnostic, not a controlled statistical attribution of every difference. The target gets 1 CPU/256 MiB; the default runner gets 2 CPUs/1 GiB, both no swap, checked against Docker/cgroup evidence. The separately approved `--compare-budgets` mode fixes **128 VUs** and pairs **2 CPUs/1 GiB then 4 CPUs/2 GiB** at every rate. CPU and RAM change together, so this does not isolate their individual effects. It cannot be combined with `--compare-vus`; no arbitrary budget options are accepted. Exact per-trial budget, manifest plan and original runtime/cgroup limits are retained; caller resource-environment overrides are refused. These allocations are calibration conditions, **not a change to the backend's 1-CPU/4-GiB profile**. `node scripts/calibrate.js --smoke` uses 10/40 reads/s and shorter windows for integration testing; add `--compare-vus` or `--compare-budgets` to exercise the corresponding pair with the same safety/cleanup checks. The 128-VU pool still has only its explicitly selected budget: OOM or missing evidence invalidates the run, never an automatic memory increase or retry. The controller accepts no arbitrary URL/rate/target options and refuses remote Docker or existing resources.

Ignored `results/calibration-<suffix>/` holds source/image/runtime hashes, target limits, original Docker streams, per-rate k6 summaries/compressed raw points/stdout/stderr/exits, runner limits, original `runner-cgroups.jsonl`, monitor evidence and `report.json`. The monitor's `backend` role means **synthetic target**, never TrailBase. Failed evidence is retained. A usable trial requires validated SDK payloads, no logical failures, valid telemetry and normal exit. `rateDelivered` additionally requires no dropped measurement iterations and the scheduled count within one iteration; a delivery miss is not automatically attributed to k6 or TrailBase. Missing evidence remains invalid. Short-window p95s are descriptive, not SLO passes.

Runner cgroups are captured by a small **OS-only Node supervisor inside the runner container**, periodically and after k6 exits, before the supervisor/container exits. Its CPU/RAM cost shares the declared runner budget; all API traffic is still direct SDK/k6, not a Node HTTP bridge. The external collector independently verifies Docker lifecycle/stats and ingests the original cgroup snapshots with capture/receipt times. Missing final snapshots, malformed data or gaps fail closed. This avoids launching short-lived `docker exec` readers exactly when the runner terminates; auxiliary nonzero exits are **not** silently suppressed. Other pilot workloads retain their original collection path.

Prevent idle sleep during the timed experiment. Per user instruction, this local MacBook Air M1 workflow does not inspect power source or require AC; power/thermal conditions are not independently characterized. Logical timing includes SDK work and response validation. The paired per-request **non-HTTP residual** subtracts that request's HTTP duration before aggregation, clips timer-resolution negatives to zero, and includes connection/queueing plus SDK/validation and millisecond quantization. It is **not isolated SDK overhead**; do not subtract unrelated percentiles. Raw output and monitoring remain enabled, so results apply to that configuration.

Every report remains `certified: false`, `generatorHeadroom: unverified`: a fast synthetic page cannot prove the cost of authenticated sessions, writes, stateful target search, host contention or a real BaaS boundary. Open-model VUs/iterations are not concurrent active humans. Larger/separate-runner confirmation near a real backend boundary remains pending; no capacity search follows automatically.

Normal and catchable-signal cleanup checks exact project/run/service/image ownership and removes only ephemeral containers/network. An uncatchable death or uncertain cleanup retains a private **`command: calibration`** operation lock and requires manual inspection of the recorded exact resources and dead owner/monitor. The social controller's `recover` does **not** support this command: never blindly delete the lock, force-remove containers, or apply pilot recovery to calibration resources. No retained volume is removed.

### Local observation (not capacity)

The AC-powered, fixed-32-VU ladder completed with independently audited evidence in **`results/calibration-lxJZLK/`**:

| Offered SDK page reads/s | Completed/s over 20s | Dropped measured iterations | Strict zero-drop delivery |
|---:|---:|---:|---|
| 25 | 25.05 | 0 | yes (one-iteration endpoint tolerance) |
| 100 | 100.00 | 0 | yes |
| 400 | 399.95 | 1 | **no** |
| 1,600 | 1,056.70 | 10,867 | **no** |

All started reads validated; resource evidence was valid, including original final cgroup counters. Raw count/quantile/resource replay, source hashes, public privacy scan and cleanup checks passed. AC was verified before/after, not continuously. Earlier collection failures are retained as invalid evidence, not repaired or promoted.

k6 reported exhausting the 32-VU allocation at the higher rates. **Do not call 100/s a general maximum or equate these reads with active users.** VU allocation, runner/target/host scheduling and output/monitoring effects are not isolated. The paired follow-up below completed that allocation diagnostic; a larger/separate runner near a real backend boundary is still needed before claiming full generator headroom. See **PROGRESS.md** for exact provenance, failed attempts and limitations. Raw artifacts remain ignored/local; fresh clones must rerun.

### 32/128-VU follow-up (not capacity)

The fixed-budget comparison completed in **`results/calibration-k4s6h7/`**, with source/raw-count/quantile/resource/final-cgroup/pool/privacy/cleanup audits passed:

| Offered page reads/s | Completed/s: 32 VUs | Completed/s: 128 VUs | Dropped iterations: 32 / 128 |
|---:|---:|---:|---:|
| 25 | 25.05 | 25.00 | 0 / 0 |
| 100 | 100.05 | 100.05 | 0 / 0 |
| 400 | 400.05 | 400.05 | 0 / 0 |
| 1,600 | 1,055.20 | 1,137.70 | 10,899 / 9,246 |

All started reads validated. At 1,600/s, a fourfold pool increase coincided with only ~7.8% more throughput, logical p95 **50 -> 149 ms**, and sampled runner memory **651.4 -> 960.7 MiB** within the unchanged 1-GiB cap (no observed memory-limit/OOM events). **More VUs alone did not restore delivery.** Do not blindly raise them again or infer an exclusive SDK/CPU/memory bottleneck. Both delivered 400/s in this run, so the original single drop at 400/s is not a stable limit. Initialization `vus_max` samples grow to the configured pool before traffic; they are preserved separately from complete traffic-pool samples, not rewritten.

This is one sequential comparison, not repeatability/soak certification. No power-source inspection/gate was performed, per user instruction; idle sleep was inhibited. This motivated the explicitly approved local `--compare-budgets` follow-up below, not capacity search. The user explicitly requested publication of this completed comparison; subsequent experiments are not automatically published.

### Larger-budget follow-up (not capacity)

The approved fixed-128-VU comparison completed in **`results/calibration-0ImsbL/`**. Both budgets delivered **25, 100 and 400 page reads/s without drops**. At 1,600 offered reads/s:

| Measurement | 2 CPUs / 1 GiB | 4 CPUs / 2 GiB |
|---|---:|---:|
| Completed reads/s | 1,147.15 | 1,524.20 |
| Dropped measured iterations | 9,058 | 1,518 |
| Logical p95 | 146 ms | 67 ms |
| Sampled peak runner memory | 996.5 MiB | 1,126.7 MiB |

The larger combined budget helped substantially but **still did not deliver the highest offered rate without drops**. All started reads validated, with no observed memory-limit/OOM events. The image, dependencies, SDK/payload, k6 hot loop/transport and compiled bundle match the prior VU proof; both new profiles passed exact Docker/cgroup/pool/source/raw-count/quantile/resource/final-snapshot/privacy/cleanup audits. All 53 units and seven native calibration cases passed. No power checks or retained-volume changes.

This is one sequential CPU-and-RAM comparison, not individual resource attribution, full authenticated-workload headroom or active-user capacity. Do not blindly keep raising budgets to reach an arbitrary synthetic rate. The next decision is full-workload generator sizing and confirmation near a real boundary, with separate hardware discussed if needed. The user explicitly requested publication of this completed milestone; subsequent work is not automatically published.

## Next milestone

Repeated fresh-deployment preparation has been verified at both smoke and 1,000-account scale (see [PROGRESS.md](PROGRESS.md)). Separate long-lived native authentication is also verified. The read-only calibration, VU comparison and approved larger-budget comparison above are complete. More resources improved delivery, but full authenticated-workload generator sizing and near-boundary confirmation still precede capacity discovery, repeated performance certification and soak tests. A high anonymous read rate does not establish large authenticated VU pools' memory or seven-action costs; do not apply the calibration-only budget change to the real controller automatically. The approved bounded fresh-deployment sizing path and 50-user pilot above are verified; this is not general campaign/search automation. The ordinary workload controller remains restricted to its original pilot volume. Catchable interruption and SIGKILL recovery have dedicated tests; host/daemon power-loss and exhaustive failure injection are not claimed. Remote-host automation and other BaaS adapters remain deferred.
