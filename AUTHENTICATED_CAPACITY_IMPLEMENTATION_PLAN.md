# Prepared-session application-capacity benchmark: implementation plan

**Status:** planning handoff only; no implementation or new benchmark run performed.

**Workspace:** `/root/dev/baas-bench-2`.

**Purpose:** implement and validate a versioned benchmark that establishes real user sessions before measuring application capacity, while preserving the existing arrival/login/application scenario and all historical evidence.

## 1. Read this first: scope, authority, and stopped-run state

The user approved preparing this plan after stopping PocketBase testing. This document is not an instruction to resume the cancelled search. Implementation begins in a new session when the user requests it.

Read, in order:

1. Applicable `AGENTS.md` instructions and this document.
2. The **current** checkpoint at the top of `PROGRESS.md`, then relevant sections of `README.md` and `BENCHMARK_PLAN.md`.
3. The actual files listed in section 10. The checkout contains substantial pre-existing, uncommitted PocketBase work; preserve it. Do not reset, stash, reinstall dependencies, or reconstruct the work from HEAD.
4. The stopped-run records below before any native tests or container work.

### Stopped PocketBase campaign: preserve, do not resume

The checkpoint at planning time records:

- Campaign: `results/pocketbase-enIrHD/`.
- Dispatch/stop evidence: `results/pocketbase-search-sPrWNA/`.
- Completed timed point: `results/social-SmZjyI/`.
- The 300-user point passed the old short-run classifier: 11,819 measured actions, zero logical failures, 300 successful logins and zero authentication failures. It is not certified maximum capacity.
- The user cancelled during subsequent **untimed API fixture cleanup**. The 400-user point was **never attempted**.
- Controller, watcher, owned containers/network and operation/recovery claims were verified stopped/absent in `results/pocketbase-search-sPrWNA/user-stop-verification.json`. Recheck current state before future runtime work; do not treat this historical verification as a current process check.
- `.fixtures/pocketbase.json` is **`deleting`**, with 10,000 credential entries and partially deleted application state. Its offline volume is `baas-bench-2-pilot_pocketbase-enIrHD-1`.
- Ready/used archives do not necessarily equal the current partially deleted fixture. Never replace the latter with an older archive or assume it still describes an intact baseline.
- The final long post-campaign audit/seal was not run after cancellation. Preserve that limitation; do not call the campaign fully audited or completed.

**Do not resume deletion, adopt this database as a fresh baseline, remove the canonical fixture, delete volumes, or rerun old audit/dispatch helpers automatically.** If a future validation path needs the canonical filename, ask for scoped permission first, make a NEW byte-identical private archive of the current `deleting` file, verify preservation and checked shutdown, and release only the filename. Prefer isolated validation namespaces so no such release is needed.

### Authorization boundaries

- This session: write/review this plan only. No implementation, tests, builds, SDK traffic, container changes or new load.
- Future implementation: code changes and their verification, as authorized by that session's user request. The latest stop explicitly deferred further testing; do not infer new runtime-test permission solely from this file.
- Native validation must use fresh, isolated test deployments and explicitly cover its small test-owned fixture cleanup. Do not mount any historical retained database, including the ordinary named pilot volume.
- No full 100/300/1,000/1,500/etc. performance point, search, repetition or soak is authorized by this plan. Select those only after correctness validation and a separate bounded approval.
- No dependency/version upgrade, security tuning, larger resource budget, guard relaxation, remote topology, daemon restart, commit/push, delegation or new session dispatch is included.

## 2. Problem and intended result

The primary question is:

> On the recorded backend budget, how many concurrently active, authenticated users can sustain this application's defined actions, think time and session lifecycle within its latency/error limits?

The existing implementation also imposes a startup login surge:

- `src/k6/social.js` ramps VUs over 30 seconds; each user logs in and immediately starts actions.
- Measurement begins after the fixed 30-second ramp + 60-second warm-up, not after all users are ready.
- Failed logins are retried with 1–5-second pacing until the run ends.
- Global authentication thresholds include startup failures.
- `users_finished` counts VUs leaving their loop, not proof that all configured users authenticated and participated throughout measurement.
- `src/report.js` requires measurement-login samples for overall tail sufficiency, even when a short application test legitimately has no password renewals.

The recorded TrailBase v0.35.4 result illustrates the mismatch: 1,218 successful logins during warm-up and another 282 during measurement, 7,736 failed login attempts, 56,096 zero-failure measured application actions, and a separate measured generator CPU-headroom failure. See `results/server-point-1500-0354-SK1NbD/SUMMARY.md`. These are recorded observations, not a new replay or capacity certification.

Changing only `rampSeconds` would not establish readiness, remove retry amplification, distinguish evidence types, or fix the generator-headroom issue.

## 3. Deliverable and non-goals

### Deliver

1. An opt-in **prepared-session application workload**, versioned separately from `social-mixed-v1`.
2. Controlled, bounded native authentication preparation with a real all-N-ready barrier.
3. The same in-memory SDK client/session per VU through preparation and application activity.
4. Separate application activation ramp, warm-up and full-length measurement.
5. Explicit preparation, participation, authentication and phase-timing evidence.
6. Mode-aware reports/classification, with absent login/refresh traffic labelled accurately.
7. Single-fresh-point entry paths and tiny correctness smoke paths for **both TrailBase and PocketBase**.
8. Regression tests, native validation and provenance/privacy/preservation checks.
9. Updated benchmark specification, commands, limitations and implementation checkpoint.

### Do not deliver in this change

- A dedicated auth-only throughput/storm/recovery benchmark. Preserve the existing mode as the **legacy mixed arrival-surge scenario**, not as a falsely labelled auth-only test.
- A third mixed-traffic mode. Normal session renewal already supplies ongoing auth traffic in sufficiently long prepared-session trials.
- New discovery/refinement automation for the prepared mode. First validate single points; a future search needs new same-protocol reference points and its own bounded approval.
- A new runner framework, traffic proxy, browser-per-user system, xk6 extension, metrics database, third container or new dependency.
- Baseline snapshot reuse, faster seeding, changed application actions, altered hashing cost, disabled authorization, manually minted JWTs, persisted tokens or a manufactured refresh endpoint.
- A claim that prepared sessions solve the independent generator bottleneck or establish maximum capacity.

## 4. Protocol contract

### 4.1 Version and configuration

Keep existing files, CLI defaults, validation and `social-mixed-v1` semantics intact.

Add a named version, **`social-prepared-v1`**, retaining the existing dataset, action weights, payload size, page size, PRNG seed and think/session fields. Add one required object only for this version:

```json
"authPreparation": {
  "loginsPerSecond": 5,
  "timeoutSeconds": 600
}
```

These are proposed common starting parameters, **not measured auth capacity or authorization for a performance run**. They must be identical for competing backends in one comparison. Do not adapt them silently per product.

- Initial preparation has a fixed maximum of **one VU's native login + protected-read sequence in flight**. Do not add a concurrency tuning knob in this delivery.
- The rate is an upper bound; slower login/probe completion reduces achieved rate. The preparation duration is reported.
- The timeout is a hard overall bound for the gate/preparation, including runner startup according to a documented common clock. It never extends automatically.
- Validate positive finite values, exact object keys, and feasible nominal schedule: N admissions at the maximum rate must fit the deadline before accounting for actual service time. Feasible configuration does not guarantee actual completion.
- No retries in initial preparation. A failed/invalid login, protected read, admission or readiness exchange fails preparation and stops the point.
- Use separate named full-baseline and tiny-smoke configuration files, suggested `configs/prepared-social-baseline.json` and `configs/prepared-smoke.json`. Keep named dataset recipes and their logical hash unchanged. Tiny smoke timing/rates are explicitly correctness-only.
- No implicit version inference from a missing field. Reject unknown versions, extra fields and mixed legacy/prepared flags.

### 4.2 Phase sequence

| Phase | Required behavior | Capacity scoring |
|---|---|---|
| Fresh deployment/fixture preparation | Existing API-only seeding and both full API baseline verifications | Excluded; retain existing safeguards |
| Runner initialization and auth preparation | All N VUs exist; bounded admission, fresh native login, identity and protected-read verification | Separate setup outcome/time/resources, not application latency |
| All-N readiness barrier | Every assigned ordinal verified once; no pending initial login; known usable sessions; one common release epoch | Mandatory validity gate |
| Application activation ramp | Release the prepared clients into actions over `rampSeconds` | Warm-up traffic, separately tagged |
| Application warm-up | All N activated; run normal actions for `warmupSeconds` | Excluded from measured action SLOs; failures remain recorded |
| Measurement | Same N user assignments, ordinary weighted actions, native auth/refresh, full `measurementSeconds` | Primary application evidence |
| Logout, end verification, shutdown/cleanup | Existing backend-native semantics and owned-resource checks | Separate outcome; never hide failure |

There are **no business actions during initial authentication preparation**. The one protected readiness read per user is explicitly setup traffic, not a completed weighted application action.

Application ramp/warm-up durations are in addition to preparation. Do not consume their time while authenticating or shorten the measured window to keep the old total wall-clock duration.

### 4.3 Readiness means more than a successful HTTP status

Each VU must:

1. Use its own assigned account, SDK client and cookie jar/auth store.
2. Complete normal password login through that backend's official SDK path.
3. Match the returned identity to its fixture account.
4. Make one protected own-likes read through the same SDK client; validate expected ownership/fixture semantics without mutation.
5. Decode only the numeric token expiry/TTL evidence already available through the adapter. Never send or persist a token.
6. Register readiness exactly once for its assigned ordinal.

Release only after **every ordinal 1..N** has completed this sequence and no admission remains in flight. A count of N events alone is insufficient if ordinals are duplicated or missing.

At release, require enough remaining native token lifetime for each user's scheduled activation plus the existing backend request deadline. Reject expired/insufficient-lifetime sessions rather than declaring them ready. Do not lower hashing security, extend server TTLs, reuse fixture-verification sessions, or perform an unreported password login to repair readiness.

If actual native TTLs make the common preparation policy infeasible, stop and report the constraint. A changed policy or additional preparation-refresh protocol requires a documented follow-up, not an automatic workaround.

### 4.4 Session-age semantics: make the change explicit

Distinguish native token age from the synthetic active-session timer:

- Native token age starts at the real preparation login and is never reset by the barrier.
- In the new version, the initial **active-session** duration begins when that VU is activated into the application ramp, not while it waits at the barrier. This models pre-authenticated users becoming active and prevents preparation time from immediately expiring their synthetic engagement sessions.
- Draw that duration once from the unchanged 300–900-second distribution with its existing independent per-VU PRNG. Subsequent logout/login renewal timers start on successful login as before.
- Retain 1–5-second action think time, normal native refresh behavior and backend-specific logout semantics.
- Do not replace sessions with infinite tokens or seed random session ages to force churn into a short test. That would be another protocol decision.
- Ongoing renewal retains the existing paced behavior; record attempts/failures and do not retry failures out of existence. The strict zero-auth-failure policy continues to disqualify a passing result. Do not add a second retry-policy refactor here.

A 120-second measurement after the current warm-up may exercise no password renewal or natural refresh. Report **not exercised**, not a login/refresh SLO pass. Longer verification/certification remains necessary for lifecycle coverage.

### 4.5 Application behavior and timing

Reuse `initialState`, `performAction`, the seven action weights, target selection, prerequisites and independent PRNG streams.

Keep all prepared VUs alive in **one scenario/one long iteration per VU**, preferably the native `per-vu-iterations` executor with `iterations: 1`. Implement activation staggering in the VU body; do not rely on VU reuse across separate preparation and measurement scenarios.

Use deterministic per-ordinal activation offsets across the ramp. This is an activity ramp, not an executor count pretending to be the authenticated population. Report configured executor VUs, authenticated-ready users and actual measured participants separately.

Use one common release epoch and explicit ramp/warm-up/measurement boundaries. Tag logical actions by their start phase and keep prerequisite/refresh work inside their originating action's latency. Do not retag an action halfway through it. Separately record actual HTTP request-start phase where needed so cross-boundary auth requests cannot disappear into setup.

Preserve raw timestamps. Do not clip, rewrite or discard boundary-crossing work. No new actions start after the measurement end; bounded in-flight work and logout get the existing appropriate drain/cleanup treatment. Record whether completion drained beyond the window and invalidate interrupted/incomplete accounting.

## 5. Real readiness coordination in pinned k6

### 5.1 Important constraint

k6 VUs have isolated JavaScript state. `SharedArray` is read-only; a normal global counter/array is not a cross-VU barrier. `setup()` data is marshalled and is not a safe way to share N live SDK clients or a large mutable token pool. Sequential scenarios do not guarantee the same VU/client assignments.

Do not implement a fake barrier with a longer fixed sleep, `users_finished`, aggregate end thresholds alone, or assumptions about scenario VU reuse.

### 5.2 Recommended smallest reliable design

Add a **small Node standard-library admission/readiness gate inside the existing runner container and supervisor process**. No third container, external service or dependency. Backend traffic still goes directly from each k6 SDK client to the backend; Node never proxies application/auth requests.

Suggested placement: `src/prepared-gate.js`, imported by `src/calibration-runner.js` only for the prepared mode. The latter already supervises k6, forwards signals and captures same-cgroup final counters. Preserve its legacy/calibration paths.

The gate contract:

- Bind an ephemeral port on **127.0.0.1 only**, with no host/container port publication and no enabled public k6 REST API. Pass only its loopback origin/run identity to the child.
- Know the expected N, rate, deadline and run identity before accepting traffic.
- One admission request per ordinal. Bound queued/admitted/ready records by N; validate method, route, run, numeric ordinal, body size and allowed fields. Reject duplicate, foreign or out-of-range registrations without advancing readiness.
- Admission responses are paced and serialized. The next permit is not issued until the previous user's login/protected read has finished and readiness has been accepted. Enforce the minimum interval; never release accumulated late slots as a catch-up burst.
- After receiving admission, the VU performs its native SDK preparation, then sends a readiness request containing only bounded numeric/boolean evidence and its ordinal. No credential, token, account/native ID, response body or raw SDK error crosses this interface.
- Hold successful readiness responses until all N are ready. Then return the same immutable release epoch to every VU, with a small fixed **two-second release lead** before application activation starts. The lead is part of the new protocol, not measurement time.
- Use bounded long-held requests, not N polling loops. Control-request deadlines must cover the finite preparation wait. Those are **loopback control deadlines only**; backend SDK HTTP timeouts remain 10 seconds.
- Fail closed on missed deadline, failed user preparation, disconnected pending participant, invalid expiry evidence, server error, child exit or cancellation. Cancel queued waiters, do not issue more backend permits after failure, and do not reuse a permit when underlying password work may still be running.
- A local `preparation_failed` signal/response may carry only an allowlisted reason. If that notification fails, the VU must still abort via the verified pinned k6 path; supervisor exit/deadline must close the gate.
- Close held connections and the server on success/failure/shutdown. Account for a small bounded release tolerance and invalidate missing/late participant evidence rather than silently proceeding with fewer users.
- Retain an append-only sanitized admission/readiness/release/failure ledger with ordinal/timing/reason data; no HTTP bodies or headers by default. Keep preparation observations even if k6 aborts before a summary exists.

Clock handling must be proven: use monotonic time for deadlines/rate enforcement, record wall-clock anchors for correlation, and establish a tested mapping to the k6 execution clock. Do not use independent per-VU relative sleeps as the supposedly common epoch. Reject material clock inconsistency rather than normalizing evidence.

### 5.3 First implementation gate: tiny native feasibility proof

Before the full workload refactor, prove on pinned **k6 2.3.0** that:

1. Two VUs each retain their own client/local state across admission, a delayed all-N barrier and subsequent work in one iteration.
2. The first VU cannot execute a business action while the second is unready.
3. A missing/failed second VU causes finite failure, not a partial-population run or an endless wait.
4. Long-held loopback requests respect explicit control timeouts without altering backend timeouts.
5. Common release/phase timing and direct SDK traffic work through the existing container mounts/user and supervisor lifecycle.
6. Native abort exit behavior, summary availability, signal forwarding, final cgroup evidence and connection cleanup are captured exactly.

Use a small self-contained local fixture for coordination mechanics and only the separately authorized tiny fresh backend smoke for SDK continuity. Do not use a full baseline as a feasibility experiment.

If the proposed gate cannot satisfy these properties with the pinned runtime, stop and present the specific limitation. Do not silently add an extension, public control service, traffic bridge, token-file workflow or alternative load generator.

## 6. Metrics, reports and verdicts

### 6.1 Preparation evidence

Add a structured `preparation` section with at least:

- Protocol/version, expected users, distinct admitted/ready counts, completed status and allowlisted failure reason.
- Configured maximum rate, fixed concurrency=1, deadline, actual elapsed time, attempts/successes/failures, protected-read outcomes and achieved admission rate.
- Earliest/latest successful-login times, observed native TTL/remaining-lifetime bounds, common release epoch and phase boundaries.
- Gate ledger path/hash and reconciliation status against original k6 events.
- Lifecycle/cancellation/cleanup outcome, including absence of a k6 summary when applicable.

No initial-login retry amplification is allowed. A preparation failure means **no usable application-capacity result**, even if another user emitted partial work.

### 6.2 Prove participation, not only readiness

Record numeric per-VU lifecycle events in the raw metric stream for first measured action and normal completion. Use the VU ordinal as a **numeric value**, with only fixed event names as tags, rather than tagging every HTTP/action series with an identity.

A streaming post-run reconciliation must verify each expected ordinal appears exactly once for the required events, with plausible timing and no extra participants. Check initial readiness independently against the gate ledger. Keep aggregate counters for readable summaries, but never accept aggregate N alone as distinct-user proof.

Report:

- Requested/configured VUs.
- Distinct authenticated-ready users.
- Distinct users actually entering measured application actions.
- Normal completions/interrupted users and missing/duplicate/late lifecycle evidence.
- Successful and completed logical actions/second using the defined measured duration, plus requests/second and session-start rate.

If N are ready but fewer than N actually participate, the point is invalid for an N-active-user claim. This is a closed human model, not N simultaneous HTTP requests or a count of idle connections.

### 6.3 Separate traffic and authentication outcomes

Gate requests are real native k6 HTTP calls and otherwise contaminate global `http_reqs`/`http_req_failed` metrics. Tag all new-mode traffic explicitly as **backend** or **control**:

- Backend action/auth/protected-read traffic still uses the existing validated SDK transport and origin checks.
- Control calls use a separate exact-loopback path; do not expand the SDK transport's allowed backend origins or API paths to accommodate the gate.
- Retain unmodified overall k6 metrics, but use backend-tagged submetrics for backend request/failure reporting and applicable classification.
- Report control traffic counts/failures separately; a control failure invalidates the point, it is not silently excluded as harmless.
- Do not present long-held barrier latency as backend latency or throughput.

Separate password-login attempts, successes, failures and **successful-login-only duration** by preparation versus subsequent application phases. Preserve all-attempt latency as diagnostic information if useful; fast 429 responses must not masquerade as good successful-login latency.

Retain zero-tolerance unexpected auth failure policy, including native refresh/renewal/logout failures. Show phase and operation so preparation, ongoing auth and cleanup are distinguishable. Preserve PocketBase client-local logout: no synthetic server request or invented server revocation claim.

### 6.4 Evidence sufficiency and classification

- Keep all original legacy classification behavior unless fixing an explicitly tested shared defect is necessary for this change.
- Prepared mode requires valid preparation, reconciled N-user participation, completed accounting/full window, valid resource evidence, no interruption, and an understood native exit.
- Application evidence sufficiency depends on **per-action measured samples**, retaining the >=1,000-per-action tail-evidence policy. Absence of measured password logins must not make otherwise sufficient application evidence inconclusive.
- Authentication evidence is separate: zero attempts = `not_exercised`; too few = `insufficient_samples`; sufficient samples permit evaluation. Zero samples never produce a latency/SLO pass. Do the same for refresh coverage.
- A genuine measured auth failure still prevents a passing application result; separating labels is not permission to ignore the failure.
- For compatibility with the shared planner's verdict enum, represent preparation failure as `invalid` with a reason such as `auth_preparation_failed` and a structured preparation outcome. Do not add a fake backend SLO-failure upper endpoint.
- Preserve `generator_limited` and safety/invalid classifications and all existing headroom thresholds. A clean preparation does not certify the generator.
- Record the new mode/version in reports, manifests, controller results and any history. Never mix legacy and prepared points into a bracket/reference or relabel old artifacts.
- Remain `certified: false`. Short single-point passes do not establish repeated capacity, sufficient tails, a soak result or natural-expiry certification.

Suggested report identity: `kind: prepared-session-fixed-vu-exploratory`, plus explicit workload version and separate `applicationEvidence`/`authenticationEvidence`/`preparation`/`participation`/`phaseTiming` sections. Keep the schema simple; field spelling may follow existing style, but these distinctions are required.

### 6.5 CPU windows and partial failure paths

`measurementStart()` currently finds the first measured action in the gzip. For the prepared mode, use the **verified common phase boundary**, cross-checked against raw lifecycle/action times, to align the full measurement CPU window. Do not shift the window later to avoid an early CPU spike or include gate/auth preparation as measured CPU. Preserve the legacy alignment path for old mode.

Update every caller in `scripts/baseline.js` and `scripts/pocketbase.js`, not only `src/campaign.js`.

When preparation fails before measurement:

- Do not call `measurementStart()` expecting an action that cannot exist.
- Do not manufacture empty successful metrics, zero auth failures or a complete measurement.
- Persist a minimal fail-closed report/result from actual gate, native exit and resource evidence, even when the k6 summary is absent.
- Do not run expensive end-count/login verification or API fixture deletion merely to manufacture a normal completion path.
- Continue checked owned-resource shutdown and private state preservation. Secondary capture/cleanup failure must not replace the primary failure; retain the operation claim when shutdown is uncertain.

## 7. Controller and configuration integration

First delivery exposes **one fresh prepared-session point per invocation**, not a new automatic campaign.

Proposed explicit CLI contract for both controllers:

```text
node scripts/baseline.js   --prepared-sessions --smoke
node scripts/pocketbase.js --prepared-sessions --smoke

# Future separately approved performance points; N is not selected/approved here:
node scripts/baseline.js   --prepared-sessions --vus=N
node scripts/pocketbase.js --prepared-sessions --vus=N
```

Rules:

- Exactly one of `--smoke` or `--vus=N`; no duplicate, ambiguous or extra flags.
- Reject combinations with legacy `--search`, `--lower`, `--campaign`, `--workload`, resource overrides or positional legacy configs.
- Both use the new versioned configs and the same phase/preparation policy. `--vus=N` validates against the fixed full-baseline identity pool.
- Prepared mode uses the already existing **backend 1 CPU/4 GiB, runner 4 CPUs/16 GiB, no swap**, normal **85%** container-memory guards and nofile16384 backend setting. Keep health/OOM/host/disk/request/collector/CPU/ownership safeguards unchanged. The old explicit backend95 experiment is not inherited.
- Native smokes use the tiny profile; production points retain `social-baseline` 10,000 accounts/100,000 posts/100,000 likes and both API verifications.
- Keep legacy defaults and all approved historical selectors unchanged. Adding a selectable command is not permission to execute it.
- Retain each controller's existing fixture/volume ownership and shutdown machinery. Do not create a generic new controller abstraction.
- Distinguish single-point assessment from discovery. In `baseline.js`, do not set `campaign=true` merely to get reporting and accidentally activate doubling/fallback. Extract only the minimal shared assessment call if needed.
- Prepared runtime assessment must preserve structured valid SLO failures without treating every native exit99 as a crash; invalid preparation/safety/generator outcomes retain their distinct stop reasons.
- Normal API cleanup of new, successful test-owned points remains explicit and checked. Failed preparation/performance state is retained; no automatic retry or fallback.

`node scripts/social.js run` is currently an unbounded pilot route. **Do not silently add an unbounded prepared mode there.** In this delivery, keep it legacy/auth-correctness only and reject prepared configs early with a clear message directing users to the bounded fresh controllers. Revisit only if a real caller needs it.

## 8. Resource, safety, provenance and privacy requirements

- Gate and held connections run inside the runner's existing cgroup, so their CPU/RAM/FD cost is accounted for. Sample initialization/preparation/ramp/measurement/cleanup; preserve lifetime versus window scopes.
- Account for O(N) held control connections and check that the proof does not leak them into the measured window. Do not raise nofile/CPU/RAM limits automatically if a large population cannot fit.
- Keep the supervisor alive through child shutdown for the final cgroup sample. Preserve native exit and signal distinctions; no fabricated clean exit.
- Reuse existing live safety guards and final resource validation. Preparation is excluded from application scoring, **not from safety monitoring**.
- Include every new helper, config, gate/supervisor source, bundled source and actual runtime entry in manifests and copied-source validation. `runner/Dockerfile` currently does not copy workload helpers; existing supervised paths mount `src/calibration-runner.js` directly. Explicitly mount/copy its new import and hash the actual file used. Do not ship a supervisor that imports an absent or stale helper.
- Cover `scripts/social.js`, `scripts/baseline.js`, `scripts/pocketbase.js`, `scripts/workload-run.js`, bundle generation, native source-copy test harnesses and provenance allowlists as applicable. Hashes must bind the production path, not merely an unused new file.
- No password, token, refresh token, Authorization/Cookie header, user/native record ID, private fixture body or raw SDK response in public gate/control logs or failure objects. Ordinals and numeric TTL/timestamps are sufficient.
- Do not pass credentials/tokens in process arguments, gate URLs, environment variables or setup return data. Keep credentials in existing 0600 fixtures under 0700 directories; sessions stay in VU memory.
- Validate no extra backend origins are accepted by `createTransport` or PocketBase `beforeSend` as a side effect of control traffic support.
- Preserve raw compressed metrics/logs and historical sealed roots. Write new validation evidence into new directories. Never retrofit new-mode fields into an old report to make it comparable.

## 9. Implementation stages and acceptance gates

Implement in this order, writing regression tests before behavioral changes. Keep each stage small; no mandatory commits or delegated reviewers are authorized.

### Stage A — baseline protection and contract tests

- Read current status/checkpoint and inventory existing changed/untracked files without exposing secrets.
- Record the stopped fixture/volume/evidence references and current source/config state in new implementation evidence if runtime validation is approved.
- Add failing config/plan/report tests for version separation, no implicit default switch, exact flag parsing, no legacy history reuse and no unbounded prepared route.
- Add pure tests for the phase schedule, activation offsets, session-timer origin and rate/deadline validation.
- Do not free the current `.fixtures/pocketbase.json` or run a generic reset.

**Gate:** tests fail for missing prepared behavior, not environment/setup errors; existing assertion coverage is retained.

### Stage B — admission/barrier mechanics and native feasibility

- Implement the bounded gate and its lifecycle in the existing supervisor, with a minimal Node-testable state machine/standard-library server.
- Prove admission pacing, one in-flight preparation, uniqueness, all-N release, lifetime checks, monotonic deadline, cancellation and bounded connections.
- Perform the tiny pinned-k6 feasibility proof only under approved runtime-test scope.

**Gate:** two-VU delayed/failing cases demonstrate no early application work, finite failure and complete shutdown/evidence. No SDK fork, response proxy, public listener or token persistence.

### Stage C — prepared VU lifecycle

- Add the opt-in one-iteration prepared execution branch while reusing the existing SDK creation/auth/action code.
- Implement the protected readiness probe, held barrier, common activation schedule, independent active-session timing, phase tagging and participant events.
- Preserve the legacy branch's stage schedule, paced retries, client isolation, action timers and logout behavior.

**Gate:** pure tests and a tiny fresh backend proof show the same clients remain authenticated after the gate, all seven real actions execute, and no startup action bypasses readiness.

### Stage D — reporting, reconciliation and classifier

- Add streaming reconciliation of gate/lifecycle/raw phase evidence, with missing/duplicate/malformed/late events failing closed.
- Separate application/auth sufficiency and successful-login latency.
- Separate backend/control HTTP metrics without discarding overall raw metrics.
- Add minimal premeasurement-failure reports, correct native-exit handling and exact common measurement CPU alignment.

**Gate:** tests distinguish preparation failure, action/auth SLO failure, invalid evidence and generator pressure; no zero-sample authentication pass and no contaminated backend HTTP totals.

### Stage E — both fresh controllers and provenance

- Add the explicit single-point/smoke selectors and versioned configs to both controllers.
- Keep single-point assessment separate from old discovery and PocketBase's historical-reference search.
- Wire correct source mounts/imports, hashes, raw/report paths, signal handling, fixture consumption and preservation.
- Adapt fixture-based controller mocks to the new imports/metadata without weakening original failure assertions.

**Gate:** both controllers reject unsupported combinations before touching data; failed preparation never becomes an upper endpoint or triggers end-count traffic/cleanup/another candidate.

### Stage F — full applicable validation and documentation

- Run the serial applicable suite described in section 12 on fresh isolated namespaces, with raw evidence preserved.
- Verify source/bundle/runtime identity, privacy, preservation of old data and no surviving owned processes/resources/claims/listeners.
- Update `README.md`, relevant `BENCHMARK_PLAN.md` sections and `PROGRESS.md` with exact implemented behavior and checks/failures/missing proof.

**Gate:** new-mode correctness passes for both backends, legacy/native regression coverage remains intact, and no performance/capacity claim or unsolicited full run is made.

## 10. File/caller map

Read connected callers and tests before editing. The following is the expected reach, not an instruction to change every file unnecessarily.

| Area | Existing files | Required reach |
|---|---|---|
| Config/version/timing | `src/workload.js`, `configs/*.json`, `tests/workload.test.js` | Exact v1 compatibility, prepared schema, schedule/session tests; two new named configs |
| VU lifecycle | `src/k6/social.js`, `src/actions.js`, `src/k6/transport.js`, `src/pocketbase.js` | Shared SDK/action reuse, protected readiness, isolation, phases, traffic class; no adapter/security relaxation |
| Gate and supervisor | `src/calibration-runner.js`, `tests/calibration-runner.test.js`, new `src/prepared-gate.js` and focused tests | Same-cgroup gate lifecycle, bounded state/connections and preserved calibration behavior |
| Report/reconciliation | `src/report.js`, `tests/report.test.js`, optional one focused prepared-evidence helper | Mode-aware evidence and streaming original-event reconciliation; avoid a reporting framework |
| Classification/CPU alignment | `src/campaign.js`, `tests/campaign.test.js` | Preparation/participation validity and authoritative new-mode timing without changing legacy planner semantics |
| Shared runner lifecycle | `scripts/workload-run.js`, `scripts/runtime.js`, `scripts/recovery.js` | Correct entry/mounts/hashes/partial-report handling and checked owned shutdown; change shared helpers only if needed |
| TrailBase entry paths | `scripts/baseline.js`, `scripts/social.js`, plan/sizing tests | Single fresh prepared point; no automatic campaign; reject unbounded pilot prepared run |
| PocketBase entry paths | `scripts/pocketbase.js`, `tests/pocketbase*.test.js` | Single prepared point independent of historical search reference; retain all failure/retention assertions |
| Fixture preservation | `src/fixtures.js`, `tests/fixtures.test.js` | Existing API-only/single-use semantics; no need to change data recipes or resume deleted state |
| Bundle/container provenance | `scripts/build.js`, `runner/Dockerfile`, `compose.yaml`, `compose.pocketbase.yaml`, runtime manifest lists | Make actual helper/runtime available, bind hashes, preserve budgets/security; no unnecessary image/schema changes |
| Native regressions | `tests/social.integration.js`, `tests/auth.integration.js`, `tests/fresh-workload.integration.js`, `tests/campaign.integration.js`, `tests/pocketbase.integration.js`, `tests/calibration*.integration.js` | Preserve old cases; add small prepared success/failure/cancellation/phase/privacy proofs |
| Docs | `README.md`, `BENCHMARK_PLAN.md`, `PROGRESS.md` | New versus legacy meaning, exact commands/evidence, cancelled-state preservation and next approval boundary |

Use `rg` to find every `validateConfig`, `summarize`, `runWorkload`, `runtimeManifest`, `measurementStart`, `classifyCampaignTrial`, supervisor mount and source-copy/provenance caller. Confirm the final map against actual code rather than treating this table as exhaustive.

## 11. Required regression matrix

### Config and compatibility

- Original three legacy configs validate unchanged; unknown/mixed fields and new fields on v1 are rejected.
- Prepared configs require explicit version/policy and feasible bounds; no default upgrade.
- Prepared mode accepts exactly one single-point/smoke selector; legacy plans retain all old limits and stop rules.
- Prepared configs are rejected early by the unbounded pilot route.
- Legacy or mismatched-version references cannot seed a new-mode bracket/search.

### Gate/state/security

- Delayed last user, ordered/unordered arrival, no readiness until protected read completes, and no business action before all-N release.
- Duplicate/missing/foreign/out-of-range ordinal, extra body field, oversized request, unexpected route/method and invalid expiry evidence.
- Slow login/probe: never more than one in flight, maximum admission rate respected, no missed-slot catch-up burst.
- Deadline, failed login/probe, lost waiter, child crash/spawn failure, SIGINT/SIGTERM, and failure during release.
- No additional permit issued after failure; no leaked server/socket/timer or lost final counter capture.
- All participants receive the same epoch; clock jumps/inconsistent anchors fail closed.
- Control interface never receives tokens/credentials and never broadens SDK transport origin/path permissions.

### Timing/session/action behavior

- Preparation cannot consume ramp/warm-up/measurement time.
- Initial active-session timer begins at that user's activation; native token expiry remains unchanged.
- Native auto-refresh and real logout/login renewals remain in use; no synchronized reset of native token clocks.
- Exact boundary tags and accounting for actions/prerequisites/refresh crossing phases; no mid-action phase mutation.
- Correct independent random streams, unchanged action mix/targets/payloads and no no-op actions.
- Ready users that never perform a measured action are not accepted as N active users.

### Report/classification

- All-ready N but duplicate/missing participant events; wrong ordinal, malformed timestamp/value, incomplete window, request/completion mismatch, absent/corrupt summary/raw ledger.
- Zero measured logins/refreshes = not exercised, not pass; sufficient application samples can stand independently.
- Successful-login percentiles exclude failed fast responses; failed attempts remain visible and disqualifying.
- Control calls do not count as backend requests/latency/errors; control failure still invalidates.
- Preparation failure before any action produces an honest report, not an exception that masks the cause or fake empty success.
- Genuine action/ongoing-auth SLO failure, interrupted run, resource/telemetry failure and measured generator CPU pressure retain their distinct outcomes.
- CPU window uses verified prepared-mode boundaries; legacy gzip alignment still passes original tests.
- `certified:false` and insufficient-tail/headroom limitations remain explicit.

### Native proof for each backend

- Fresh tiny success: distinct real users/clients, native login and protected readiness, deliberate delayed final user, retained sessions through barrier, all actions, full measured window, reconciled evidence, zero secrets and correct backend-specific logout.
- Controlled initial login failure/missing participant: no measured application result, finite stop, used private fixture/volume retained, no end-count/API deletion/next point.
- Cancellation during auth preparation, and during measurement: preserve partial evidence/state, verify checked shutdown and no orphan gate/runner/monitor. Retain existing legacy signal/recovery cases.
- Resource and exact source/bundle/helper-mount provenance, compressed/raw privacy, and untouched historical fixtures/volumes.

Use pure/mocked tests for broad fault coverage and a few focused native cases for real coordination/SDK behavior. Do not multiply full-baseline runs for individual fault cases or weaken assertions to obtain a green suite.

## 12. Verification sequence for the implementing session

### 12.1 Non-runtime checks

Once implementation is requested:

1. Run focused new tests RED then GREEN, preserving the relevant output.
2. Run `npm test` and `npm run build` on the actual final sources.
3. Run `git diff --check` and inspect the scoped diff, including pre-existing PocketBase changes.
4. Verify legacy config/bundle paths and full manifest coverage of actual new runtime imports.

Do not install or upgrade dependencies. Record exact commands/statuses; historical passes do not certify this changed code.

### 12.2 Native checks: isolated and serial

Before executing, obtain/confirm explicit permission for the listed small native regression work and test-owned API cleanup. Ensure there is no other benchmark active and sufficient unchanged host/runner reserves.

Existing native tests frequently hardcode `baas-bench-2-pilot`, the ordinary pilot volume or canonical fixtures. **Do not run those commands directly against retained production state.** Use fresh isolated source/test namespaces with an explicit, recorded project-name mapping, separate private fixture/results roots and uniquely owned new volumes. Prove source/runtime equivalence apart from that mapping; run exact production-entry prepared smokes against new isolated deployments as well. If isolation cannot be established safely, stop and ask rather than unlink old fixtures or reset the pilot.

Applicable existing commands, in serial and in their correctly isolated environment:

```sh
npm test
npm run build
docker compose build trailbase runner
npm run test:baseline
npm run pilot:up
npm run test:pilot
npm run test:social
npm run test:auth
npm run pilot:down
npm run test:calibration
npm run test:fresh-workload
npm run test:campaign
# Separate PocketBase build and serial native suite in its isolated namespace:
docker compose -f compose.pocketbase.yaml build pocketbase runner
npm run test:pocketbase
# Plus the new focused prepared-mode feasibility/integration cases.
git diff --check
```

Adapt only the test namespace/launcher as necessary, not the original assertions or suite coverage. Use the process tool for long builds/suites and readiness/exit notifications; do not run competing suites or performance traffic in parallel on this host.

The existing natural-auth test command is a short correctness smoke; the historical separate hour-long natural-expiry proof remains historical. No new hour-long proof, synthetic throughput ladder or capacity point follows automatically. Clearly report what changed code has and has not revalidated.

### 12.3 Final independent evidence reconciliation

On final source, independently recompute from original new artifacts:

- Distinct ready/participant/completion sets, phase boundaries, attempts/outcomes and logical/HTTP counts.
- Per-action tails/success rates, preparation outcome and successful-login-only statistics.
- Backend/control traffic accounting and common CPU-window alignment.
- Runtime resource limits/guards/coverage/final native counters and actual helper/bundle/source hashes.
- Privacy against actual new test passwords plus token/header/JWT patterns, including compressed output and failure/control logs. Never print the password corpus.
- Preservation of historical sealed roots, stopped partially cleaned fixture, old private archives and old volume contents without mounting their databases into a backend. Use approved read-only inventory/digest methods; do not rerun write-once historical helpers.
- No surviving owned containers/networks/claims/gate listeners/runner or monitor processes. Retain new test volumes, and handle only explicitly authorized test-owned API cleanup.

Keep all failed verification output and all original benchmark verdicts. Missing proof must remain visible in the final report/checkpoint.

## 13. Documentation updates and completion criteria

Update `BENCHMARK_PLAN.md` to distinguish:

- Session starts/sec from active-user application capacity.
- Untimed **fixture-verification sessions** (still discarded) from the new **workload's prepared sessions** (retained in memory through its measurement lifecycle). Do not accidentally reuse seeding clients/tokens.
- Legacy arrival/login/application behavior versus prepared-session protocol.
- Preparation policy/readiness, active-session timer origin versus native TTL, independent application/auth evidence and unchanged certification requirements.

Update `README.md` with exact new single-point/smoke commands, safety/permission boundaries, traffic accounting and limitations. Keep historical recorded results linked to their versions; label any new entries as implementation/correctness evidence, not capacity.

Update `PROGRESS.md` only after meaningful implementing-session milestones, with current source/check status, new evidence paths, remaining work and precise permissions. Do not overwrite the stopped-run records or mark its cancelled cleanup complete.

The implementation is complete only when:

- Both backends can run the explicit prepared correctness smoke with the same protocol and unchanged budgets.
- All-N real readiness is enforced before business traffic, and measured participation reconciles to N.
- Initial preparation cannot generate an unbounded login/retry storm.
- Application/auth evidence, control/backend traffic and phase/CPU windows are separated correctly.
- Existing legacy scenarios, security, failure handling, raw evidence and required tests remain intact.
- Native failure/cancellation proofs preserve data and shut down only owned resources.
- New results are explicitly versioned and remain exploratory/uncertified.
- The final reply states exact checks, failures and missing proof, and asks for a new bounded approval before any real performance point.

## 14. Research references and pinned-runtime caution

Motivating conversation: <https://chatgpt.com/share/6ae37426-7800-83e8-b5cb-59b9d546f4bb>.

The planning session consulted official k6 documentation through Context7 (`/websites/grafana_k6`) for lifecycle, SharedArray, per-VU iterations, execution variables and abort behavior:

- <https://grafana.com/docs/k6/latest/using-k6/test-lifecycle/>
- <https://grafana.com/docs/k6/latest/javascript-api/k6-data/sharedarray/>
- <https://grafana.com/docs/k6/latest/using-k6/scenarios/executors/per-vu-iterations/>
- <https://grafana.com/docs/k6/latest/javascript-api/k6-execution/>
- <https://grafana.com/docs/k6/latest/using-k6/thresholds/>

These are current documentation, not proof of every behavior in pinned k6 2.3.0. The native feasibility/regression gates must establish the actual runtime behavior. This plan deliberately avoids depending on a public k6 REST API, mutable SharedArray, extensions or undocumented VU reuse.

## 15. Suggested fresh-session kickoff

The user may use this prompt when ready to authorize implementation:

> Implement `AUTHENTICATED_CAPACITY_IMPLEMENTATION_PLAN.md` in this checkout. Read the current `PROGRESS.md` and preserve all existing uncommitted work, historical artifacts and the stopped PocketBase `deleting` fixture/database. Implement the opt-in prepared-session mode for TrailBase and PocketBase, beginning with failing regression tests and the small readiness-gate feasibility proof. You may run unit/build checks and the plan's small serial native regression/smoke tests only in fresh isolated namespaces, including their own explicitly scoped test-data cleanup; do not touch retained data or release canonical historical fixtures. Do not run a capacity point/search/soak, install dependencies, change versions/resources/security/guards, restart a daemon, delegate, commit or push. Stop and ask if safe isolation or the pinned-runtime readiness contract cannot be achieved. Finish with exact verification evidence and the next bounded performance-test proposal, not an automatic benchmark run.

**Planning-session verification:** repository/caller/test/manifest/checkpoint inspection only. No implementation, runtime checks, performance traffic, fixture release or historical cleanup was performed. The gate design and proposed preparation defaults still require implementation-time proof; generator headroom remains an independent unresolved risk.
