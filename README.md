# BaaS Bench

API-only, SDK-based capacity benchmarks for self-hosted backend-as-a-service systems. Start with [the benchmark plan](BENCHMARK_PLAN.md).

**Current milestone: TrailBase SDK/k6 conformance, not capacity measurement.** The weighted workload, dataset seeder, resource time series, SLO reporting, and capacity search are not implemented yet. The planned workload now uses **17% likes / 5% unlikes**.

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

## Next milestone

Add deterministic API-only fixtures/reset and the configurable social workload, including 17% likes / 5% unlikes, human think time, session renewal, action-level metrics, and a trustworthy fixed-VU report. Capacity discovery and remote-host automation follow only after that is verified. Other BaaS adapters remain deferred.
