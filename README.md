# BaaS Bench

API-only, SDK-based capacity benchmarks for self-hosted backend-as-a-service systems. Start with [the benchmark plan](BENCHMARK_PLAN.md). To resume development, read [PROGRESS.md](PROGRESS.md) for the current checkpoint, verified work, and next steps.

**Current milestone: API-only fixtures and an exploratory fixed-VU workload, not capacity certification.** TrailBase conformance and the stateful workload are implemented, using **17% likes / 5% unlikes**. Capacity search, repeatability certification, natural-expiry coverage, and generator-headroom verification remain deferred.

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

Backend limits: **1 CPU quota**, **4 GiB RAM**, **no swap**. The controller verifies both Docker runtime settings and `cpu.max`, `memory.max`, and `memory.swap.max` in the container. These are container limits, not proof of equivalence to a whole 4-GiB VPS. Runner headroom and sustained performance are not yet measured. Backend logging is bounded and set to warnings so generated administrator credentials are not printed during normal startup.

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

### Credentials, sessions, and failure recovery

- Credentials and API-returned IDs live only in ignored `.fixtures/trailbase.json` (0600) inside `.fixtures/` (0700). That directory is also excluded from Docker build contexts. It is mounted read-only only for the workload runner; never publish it.
- JWTs and refresh tokens stay in memory and are **not persisted**. Preparation logs out; each VU logs in afresh with a distinct account. k6 `SharedArray` loads the fixture once and each VU copies only its own mutable state.
- Each VU keeps its SDK client between actions. Native SDK token refresh remains enabled. Users renew sessions via logout/login after 5–15 minutes, while think time is 1–5 seconds. Separate deterministic PRNG streams control action selection, pacing, session lengths, and targets.
- User arrivals ramp over 30 seconds, followed by 60 seconds of warm-up and 120 seconds of constant-VU measurement in the default config. Initial login is warm-up; subsequent login/logout/refresh requests are tagged and measured separately. SDK refresh/prerequisite calls triggered during an action remain inside action latency.
- Normal completion attempts logout for every VU. Forced interruption can prevent cleanup. Actual access-token TTL ranges and observed refresh-request counts are reported; the default one-hour token TTL exceeds the configured session lengths, so natural refresh is not claimed. Conformance tests forced refresh separately.
- The fixture is marked **used before** k6 launches, including failed runs. A second run is refused until reset/reseed. Normal API reset checks *all* fixture identities before deleting any and checks identity again for each deletion. Credentials are retained if cleanup fails.
- Interrupted/failed seeds are not resumable baselines. A stale `.fixtures/operation.lock` also blocks operations. Inspect active Node/k6/runner processes before removing a stale lock. Recovery for a partial seed requires an explicit reset of this project's isolated deployment, then removal of its obsolete private fixture and reseeding; no destructive recovery happens automatically.

API reset restores logical application counts, **not** database file layout, caches, auth-history state, or a physical snapshot. For comparable performance trials, use a fresh isolated deployment/volume and deterministic API reseed as specified in the plan. Delete no unrelated volumes. Remove a private fixture manually only after confirming its deployment has been reset or its accounts have been deleted.

### Targets, metrics, and interpretation

Actions retain bounded caches: up to 100 owned posts/likes and a page-sized public-ID pool. Reads select uniformly from that visible pool. Unlike uses a real own-like ID; edit changes a real own post with a new payload. Empty caches trigger native list prerequisites. Like checks native own-like state before inserting; its bounded search examines the current visible pool plus at most four feed-page requests, probing at most five uncached candidates per pool. It never substitutes another action or counts an in-memory no-op as a success.

TrailBase does **not** support cursors for our `created_at DESC, id DESC` ordering. Prerequisite feed pagination therefore uses the official SDK's `offset`, independently of latest-feed reads, wrapping after an empty page. Concurrent inserts can shift offset pages; native like checks prevent duplicate writes. Bounded-search exhaustion is recorded as `unavailable_target` and invalidates the workload rather than masquerading as backend capacity failure.

Each run writes a unique ignored `results/social-<suffix>/` with:

- `manifest.json`, shareable `fixtures.json`, exact `config.json`, source/config/fixture hashes, preparation provenance and actual runtime limits.
- Original k6 stdout/stderr, exit record, compressed timestamped metric stream and JSON summary.
- Raw backend Docker-stats samples and stderr. These samples are ordered but do not yet include per-sample timestamps or generator utilization; they are not a headroom/stability certification.
- `report.json` and `report.md`: requested/completed/success/failed counts, observed mix, action p95/p99, login/refresh evidence, and API-verified start/end row counts plus allocated deployment storage. Storage includes auth/WAL/other service files, not just application payloads.

Logical action latency includes payload creation, SDK processing, automatic refresh, and all prerequisites; it excludes think time. Failures are recorded without automatic retries or action substitution. HTTP timing remains separate. Warm-up and measurement tags are separate; in-flight actions retain their start-phase tag. The timers have millisecond resolution. Normal workload traffic contains no deliberate permission-denial probes.

Reports label per-action tails **insufficient samples** below 1,000 observations, and login evidence separately uses measurement-phase logins. A requested-mix sanity check is applied only after 1,000 measurement actions, using a five-sigma binomial bound. `valid` means workload completion/target/mix integrity, **not** an SLO or capacity pass; check failures, thresholds, and evidence labels too. Every report is explicitly exploratory and `certified: false`.

## Next milestone

Verify generator headroom, timestamped backend/runner resource collection, stability/interrupt recovery, and longer-lived authentication before adding capacity discovery, repeated fresh-baseline certification, and soak tests. Remote-host automation and other BaaS adapters remain deferred.
