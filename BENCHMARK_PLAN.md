# BaaS capacity benchmark: TrailBase pilot and expansion plan

## 1. Goal and result definition

Build a reproducible, API-only benchmark that answers:

> On a specified hardware budget, how many simultaneously active, authenticated users can this BaaS sustain for this application workload, dataset, and response-time/error budget?

Start with TrailBase on the MacBook Air M1 / 16 GB / OrbStack. Establish a correct, repeatable pilot before adding PocketBase, Supabase, Convex, Nhost, Directus, Appwrite, and possibly Neon, in that order.

The result is **not** a universal maximum user count. It is a measured capacity for a versioned workload under recorded conditions. Distinguish:

- Registered accounts: persistent dataset size, not concurrency.
- Concurrent active users: authenticated virtual users taking actions with think time. Primary capacity metric.
- Actions/second: completed logical user actions, with their actual mix.
- Requests/second: underlying HTTP traffic, including auth and prerequisite requests. An action can require multiple requests.
- Session starts/second: authentication churn, reported separately.

Report a passing/failing bracket, repeated-run variability, and the limiting resource. Never equate these results with DAU, MAU, online-but-idle users, or a managed vendor's cloud capacity.

### Scope of this deliverable

This document is a plan, not an implementation or measured result. The repository was empty when inspected. The user confirmed the proposed read/write/login p95 limits and <1% unexpected errors, a shared resource budget for official multi-container stacks, and a thin in-process SDK transport layer with approval required before any fallback. Other defaults below use delegated judgment: keep the pilot simple, fair, and accurate.

## 2. Non-negotiable benchmark rules

1. All registration, login, token refresh, seed data creation, workload operations, verification, and data cleanup use service APIs. Never connect the runner to a database, insert auth records, manufacture JWTs, or run SQL for application operations.
2. Use the official JavaScript SDK wherever one exists. Bundle it for k6 and use its supported transport customization if needed. A documented SDK gap may use the SDK's low-level request API; any direct HTTP exception must be explicit, scoped, and approved, not silently substituted.
3. Timed traffic uses ordinary user credentials and real authorization enforcement. No superuser/service-role bypass in measured requests.
4. Infrastructure/schema provisioning uses the product's supported configuration/deployment mechanisms or administrative API. Version-controlled native migration artifacts may define schema, indexes, and policies, but must not insert benchmark users or application rows. Prefer declarative service configuration/admin APIs; migration artifacts define deployment structure, not benchmark data. If a product requires an exception involving direct database access, stop and ask rather than bypass the rule.
5. Compare complete required backend stacks under one total CPU/RAM budget. A database, authentication service, gateway, cache, and required workers all count. No hidden external database or unbudgeted auth service.
6. Pin releases, SDK dependencies, image digests, workload, schema, dataset, and runner. Resolve “latest stable” when starting a campaign, then freeze it. Never change versions during a comparison.
7. Validate correctness and permissions before measuring speed. Fast unauthorized or empty responses are not successful work.
8. Record limitations and invalid runs. A load-generator bottleneck is not a BaaS capacity result.

## 3. Research findings and early feasibility gates

### TrailBase

At research time, the GitHub latest-release endpoint returned **v0.35.1**, and the npm registry returned **trailbase 0.14.3**. Recheck both at implementation/campaign start. The Docker registry lists native Linux ARM64 and AMD64 images; verify the actual selected digest and architecture before running.

The inspected release source exposes:

- `initClient(site, { transport })` and a public `Transport` interface with `fetch(path, init): Promise<Response>`.
- SDK registration/login/logout, automatic token refresh, and Record API operations.
- Record API pagination, sorting, filtering, access rules, and CRUD.
- Username-only registration without email verification, subject to configured identifier policy. Email accounts require confirmation before login. Registration can report success for an existing account, so seed validation must confirm login and identity rather than trust the registration response alone.

This makes an SDK-based k6 pilot plausible, **not yet proven**. The first implementation milestone is a compatibility spike, not a capacity run.

### k6 / SDK compatibility

k6 runs JavaScript but is neither Node.js nor a full browser. Bundling an npm package resolves module loading, not missing runtime APIs. Do not assume support for `fetch`, `Response`, `URL`, crypto, storage, streams, or a dependency's Node built-ins; inspect and test what the pinned SDK actually needs.

Pilot approach:

1. Bundle the unmodified official SDK with one bundler, leaving k6 modules external.
2. Implement its supported `Transport` using `k6/http` (including asynchronous APIs where appropriate).
3. Supply only the web-platform pieces actually used on the exercised SDK path. Test response status, headers, JSON/text parsing, empty bodies, timeout/network errors, and non-2xx responses.
4. Keep SDK auth, query construction, decoding, and application behavior intact. Do not replace SDK methods with hand-written REST calls masquerading as an SDK test.
5. Prove separate clients and tokens per VU, genuine server logout behavior, refresh, and useful k6 HTTP metrics. The inspected SDK catches some logout errors; inspect transport results rather than trusting a successful SDK return alone.
6. Compare the same small operation sequence in native Node.js and k6 for equivalent API behavior. Measure transport/serialization overhead and load-generator cost.

Reject a Node HTTP bridge in the primary design: it adds another queue, hop, bottleneck, and failure domain. Reject one browser per user for primary API capacity testing. If compatibility needs a broad runtime emulation layer, stop and ask before any fallback to direct HTTP or a different runner. This approval gate is confirmed. Do not build a general SDK compatibility platform.

### Later targets

- Supabase and Nhost are multi-service stacks. Official Supabase documentation currently lists 4 GB RAM / 2 CPU cores as a full-stack minimum; 1 vCPU is an intentionally constrained experiment, not a supported-size claim.
- Convex self-hosting documents a local SQLite default and manual Convex Auth setup. Its application contract will use authenticated query/mutation functions rather than pretending it is a generic REST record store. The backend's own internal DB access is normal implementation behavior, not direct runner DB access.
- Appwrite currently documents a minimum of 2 CPU cores, 4 GB RAM, and 2 GB swap. A strict no-swap / 1-vCPU profile must be labeled below that minimum. Do not enable extra swap for just one competitor in an otherwise identical-budget leaderboard.
- Neon Local is a proxy to a Neon cloud branch, **not** a locally hosted Neon backend. SQL over Neon's HTTP driver is still database access, not this application's BaaS API. Neon needs a separate feasibility decision covering self-hosted auth and record APIs; cloud-backed proxies cannot enter the same-hardware results.
- Latest release, licensing, architecture support, native auth, API/SDK semantics, required services, and minimum viable resources must be rechecked for each adapter when it is added. No compatibility promises for unimplemented adapters.

## 4. Architecture and deployment

### Logical components

```text
Host-side controller (small CLI; no traffic proxy)
  ├── starts/stops isolated deployments and validates configuration
  ├── resolves versions, provisions, seeds, resets, and runs tests
  ├── captures backend/runner/host resource telemetry
  └── produces immutable run artifacts and reports

Runner container: Node.js preparation tools + bundled k6 workload
  └── ordinary authenticated SDK calls ──> BaaS API

Backend scope: TrailBase container + persistent data volume
  └── later: all required containers for the selected BaaS
```

TrailBase initially needs two running containers: backend and runner. The runner image can contain Node.js for untimed SDK seeding/verification and k6 for timed execution; execute them sequentially. Build tooling need not run during measurement. Configuration/schema are versioned, while writable data lives in a named Linux volume rather than the image.

No third metrics database or dashboard is necessary for the pilot. A lightweight host-side collector writes timestamped Docker/cgroup and host metrics. Measure and disclose its overhead.

### Supported topologies

| Mode | Purpose | Important qualification |
|---|---|---|
| Mac / OrbStack, both containers local | Development, conformance, exploratory capacity | ARM64 Linux VM, host contention and thermal limits; not VPS-equivalent |
| Single Linux VPS | Small deployment experiment | Backend and generator compete for real host resources; cap/reserve separately |
| Separate backend and runner hosts | Preferred published capacity | Full backend budget plus OS headroom; independent generator capacity |
| Several runner hosts | Later, only if one runner is insufficient | Explicit identity sharding, synchronization, and raw-metric aggregation required |

The workload receives only an API base URL, identity shard, workload settings, and mounted inputs. It must not assume Docker DNS, localhost, SSH, or a particular VPS vendor. Separate Compose projects/backend and runner profiles support split hosts without rewriting the scenario.

On remote hosts, use existing SSH access and ordinary Docker Compose first. Do not build infrastructure provisioning or Kubernetes for the pilot. Synchronize clocks, use a private network or properly validated HTTPS, and allow API access only from approved runners. Exclude SSH tunneling/proxying from the normal measured path.

## 5. Hardware fairness and resource enforcement

Define a named profile, initially `backend-1cpu-4g`:

- Aggregate backend CPU quota: 1.0 CPU worth of execution time.
- Aggregate backend memory: **4 GiB (4,294,967,296 bytes)**; explicitly not decimal 4 GB. Add other profiles with precise units later.
- Swap policy: disabled for the primary profile; verify actual enforcement. Any swap-enabled profile is separate.
- Data: persistent SSD-backed Linux volumes. Record disk capacity, filesystem, storage class, and available space; disk latency/IOPS are not normalized by a RAM limit.
- Fixed logging level, persistence/durability settings, file descriptor limits, and health checks, recorded with each run. No unsafe durability shortcuts.
- Runner CPU/RAM allocation recorded separately and large enough not to limit offered workload.

For the single-container pilot, Docker CPU/memory limits are straightforward. For later stacks, per-container `cpus: 1` / `mem_limit: 4g` would multiply the budget and is invalid. On Linux use a verified common parent cgroup for the backend project with aggregate limits, or documented static per-service allocations whose totals do not exceed the profile. Static allocations can unfairly strand resources, so disclose them and prefer a shared parent when supported. Validate limits from running containers/cgroups, not merely from Compose YAML. OrbStack support for the selected mechanism is a feasibility check, not an assumption.

A real 4-GiB VPS includes the OS and Docker overhead. Therefore distinguish **container-budget experiments on a larger host** from **whole 4-GiB machine experiments**. For the latter, record actual available backend memory and reserve host headroom; do not claim a 4-GiB container is identical to a 4-GiB VPS.

A quota is not a physical core. Record CPU model, architecture, quota period, affinity if set, frequency/governor, VM/hypervisor, shared-vs-dedicated VPS, CPU steal, kernel, Docker/Compose versions, and backend/runner topology. Compare vendors on the same machine/profile; never combine ARM M1 and x86 VPS results into one ranking.

### Mac pilot procedure

Use native ARM64 images for both backend and runner. Do not silently use AMD64 emulation. Keep OrbStack CPU/RAM settings fixed with enough VM and host headroom for backend, runner, Docker, and macOS. Use a named data volume rather than a macOS bind mount for database files. Prevent idle sleep, close heavy workloads, and record thermal throttling where available. For this local MacBook Air M1 workflow, the user explicitly disabled power-source verification; do not query power state or gate execution on AC. The fanless M1 Air needs sustained runs and cooldown checks; a short burst can overstate durable capacity.

## 6. Application contract and data model

### Minimum shared model

| Entity | Fields and constraints |
|---|---|
| User | Service-native auth identity; deterministic benchmark handle; credentials outside public artifacts |
| Post | Native ID, author identity, title, body, created timestamp, updated timestamp |
| Like | Native ID if required, user identity, post identity, created timestamp; unique `(user, post)` |

All pilot posts are public. Public reads expose only selected post fields and an opaque author ID, never auth data or email. A user's own posts are filtered server-side, not downloaded from the entire feed and filtered in the runner. Likes are user-owned for mutation; the pilot's own-like listing is private. Private posts, profiles, attachments, comments, search, and realtime are future workloads, not hidden requirements.

Required semantics:

- Authenticated users can create posts and edit only their own posts.
- A client cannot spoof the author on creation or transfer ownership on edit.
- Users can like a visible existing post once and remove only their own like.
- Anonymous users cannot mutate; public feed/detail reads can be allowed anonymously, although primary workload users remain authenticated.
- Server-enforced constraints prevent duplicate likes and invalid references.
- Latest feed and own-post list return 20 records, stable descending `(created_at, id)` order, equivalent selected fields, and no total-count query or relationship expansion in the baseline.
- No precomputed like totals in the baseline. Like-count aggregation would be a separately specified workload.
- Creation time is immutable. Use service-generated timestamps where possible; any adapter-specific native-ID tie-break behavior is documented. Preserve equivalent ordering semantics rather than forcing identical ID representations.

Indexes: latest posts `(created_at, id)`, own posts `(author, created_at, id)`, unique likes `(user, post)`, and any additional foreign-key/own-like access index the implementation needs. Record exact native indexes and query configuration. Service-native differences are allowed; data volume, returned fields, authorization, and logical work must stay equivalent.

For TrailBase, use native auth identities, native Record APIs, table constraints, and ownership access rules. Include a read rule for own-like access and create/update/delete rules that cannot be defeated by modifying owner fields. No custom high-speed benchmark endpoint or server-side seed shortcut.

## 7. Dataset and API-only preparation

Two initial dataset profiles:

| Profile | Accounts | Posts | Likes | Purpose |
|---|---:|---:|---:|---|
| `pilot-small` | 1,000 | 10,000 | 10,000 | Correctness and quick local iteration |
| `social-baseline` | 10,000 | 100,000 | 100,000 | First repeatable capacity campaign |

These are starting sizes, not claims about typical production data. Give each account 10 owned posts and 10 distinct likes initially so every mutation has realistic targets. With a fixed random seed, generate roughly 1-KiB post bodies, bounded titles, and service-generated creation timestamps. Seed in deterministic logical order; record native timestamp precision and actual seed time span. Do not add a historical-import mechanism or force hidden DB writes just to backdate fixtures.

Keep account count and initial dataset fixed while searching concurrency. If the search reaches the identity pool limit, report `capacity >= pool size` and start a separately identified campaign with a larger, reseeded dataset. Do not quietly grow the DB between candidate loads. Later vary account/data size independently of concurrency to study cache and dataset effects.

### Preparation sequence

1. Resolve and freeze server/SDK/runner versions; build images/bundle.
2. Start an isolated deployment and provision schema/policies using the supported mechanisms.
3. Register real accounts using native auth SDK calls. Use username-only TrailBase accounts if confirmed for the pilot; for email-only adapters use their documented verification/admin-auth flow, never auth-table edits. Record verification policy; do not weaken password hashing.
4. Log in as users and create their posts/likes via normal SDK operations with bounded seed concurrency. No measured phase overlaps seeding.
5. Persist API-returned native IDs and identity mapping in a local fixture manifest. Generate an equivalent logical dataset across vendors without requiring matching native IDs.
6. Validate successful logins, row ownership, field sizes, own-list counts, and expected fixture totals by APIs. Use admin APIs for full enumeration only during untimed verification if normal APIs cannot expose it safely. Registration responses alone are insufficient proof.
7. Record seed duration, retries, errors, final counts, and hashes. Failed or partial seeds do not proceed to capacity testing.
8. Reset all candidates/repetitions to the same baseline. Preferred portable method: fresh isolated deployment and deterministic API reseed. After proving correctness, an optional cleanly stopped whole-volume snapshot may accelerate same-version resets; it must preserve an API-seeded baseline, never modify data, and never run against a live DB. Not portable across vendors/versions. Include a reseed-vs-restore validation before adopting it.
9. Discard **fixture seeding/verification** sessions and temporary tokens before workload traffic. Never reuse those clients/tokens. Legacy workload users log in during arrival; `social-prepared-v1` establishes separate fresh workload SDK sessions and retains those in memory through its barrier/application lifecycle.

Keep large seed data out of k6 `setup()` return values, which can amplify per-VU memory. Mount fixture files and use k6 shared read-only data facilities where appropriate. Keep each VU's mutable session state separate and bounded. Record fixture-loading overhead.

## 8. First configurable workload: `social-mixed-v1`

The legacy implementation combines arrivals, password-login attempts (with paced retries) and application actions; its fixed ramp/warm-up does not prove that all configured VUs authenticated before measurement. It is not an auth-only throughput test. Prepared-session application capacity is a separate explicit version below; never mix their histories or infer one from the other.

The mix below is a **read-heavy synthetic social workload**, not an empirically established real-world distribution. It is intentionally easy to explain and change. Save the exact configuration and resulting observed mix with every result.

| Action | Probability | Meaning |
|---|---:|---|
| List latest public posts | 35% | First page, 20 records |
| List own latest posts | 15% | Server-side author filter, first 20 |
| Read one post | 15% | Select a known visible post |
| Create a post | 5% | Approximately 1-KiB body |
| Like a post | 17% | Visible post not already liked by this user |
| Unlike a post | 5% | Remove an existing like owned by this user |
| Edit own post | 8% | Update body/title, preserve author/creation time |
| **Total** | **100%** | |

Login is a session event, not another action probability. Post deletion can be added later as a named workload revision with explicit target and referential semantics; it is not needed to exercise the requested pilot operations.

### Human/session behavior

- One active VU represents one active user, not an open socket or registered account.
- Each user issues one logical action at a time.
- Think time is initially uniform random **1–5 seconds**, mean 3 seconds, after each completed action, including failures. Think time is separate from action latency.
- Initial session length is randomized **5–15 minutes**, then logout and a new login for the same assigned account. This models concurrent active sessions without an unconfigured offline population. Report session-start rate and keep this distribution fixed across vendors.
- Stagger initial user arrival during a defined warm-up ramp; include ongoing session renewal in steady-state metrics. A separate login-storm test is optional later and is never mixed into the headline steady-state number.
- Use service token refresh behavior and default TTLs; record TTLs because they change auth overhead. Test refresh explicitly through supported SDK methods. Sessions shorter than a native token TTL may never refresh during the main workload; disclose this rather than claiming a long soak automatically proves refresh. Add a separate long-lived-session check only if needed.
- Seed the workload PRNG per run and user/shard. Keep action selection and think-time random streams independent of API-specific request counts so different SDKs do not silently change the logical mix. Concurrency scheduling still prevents bit-for-bit replay; record seeds, not a promise of identical timing.

### Stateful target selection and mix integrity

Cache a bounded set of recent public IDs, owned post IDs, and own like IDs per user. Seed initial targets, update state after successful actions, and use real API reads to obtain replacements when necessary. Select feed targets using a documented common rule, initially uniformly from the recent visible pool. Popularity-skew/hotspot experiments are separate workload variants.

An unlike must remove a real existing like; an edit must change a real owned post. Never count an in-memory no-op as a completed action. Never silently convert a failed edit/unlike into a feed read. If a chosen action lacks a target, attempt the specified bounded API prerequisite; include its time and requests in the action and record it. If still impossible, record `unavailable_target` and fail the action. Unexpected target depletion is a workload validity issue to fix before publishing capacity.

Record requested action counts, attempted/completed/successful counts, prerequisite calls, target-unavailability, duplicate conflicts, retries, and actual mix. Reject runs whose operation distribution materially departs from configuration beyond expected sampling variation. At low sample sizes report insufficient evidence rather than enforcing a misleading exact-percentage check.

Writes grow the dataset during a trial. Reset between trials and report start/end counts and data size. Use identical trial durations across products. Soaks intentionally reveal growth effects and must not be represented as a fixed-size database measurement.

### Configuration surface

Use one human-readable JSON configuration initially, validated before deployment. Support only necessary fields: backend target, topology/base URL, resource profile, dataset profile, action weights, page/payload sizes, think-time/session ranges, random seed, VU schedule/search limits, warm-up/measurement durations, SLOs, repetitions, artifact directory, and runner identity shard. Secrets are referenced by file/environment, not embedded in shareable config. Reject unknown actions, weights not totaling 100, invalid ranges, overlapping identity shards, missing credentials, and undersized identity pools.

### Opt-in application-capacity protocol: `social-prepared-v1`

Use the same recipe, payloads, weights, independent PRNG streams, target/prerequisite rules, think times and native session renewal. Session starts/second is an authentication-arrival rate; authenticated active-user capacity is the population sustaining application actions. Neither is a count of simultaneous sockets/HTTP requests. Prepared feed-page progression uses page-size-aligned offsets, including after a short page, as required by the native page-based SDK; legacy offset progression is unchanged. This is pagination compatibility, not a changed action mix, fixture recipe or failure tolerance.

Both fresh controllers accept exactly `--prepared-sessions --smoke` or `--prepared-sessions --vus=N`; there is no prepared discovery/search or resource override. The unbounded pilot `social.js` route rejects prepared configs before accessing claims/data. Full profile: `configs/prepared-social-baseline.json`; tiny correctness-only profile: `configs/prepared-smoke.json`. The full policy is identical for both products: `authPreparation: {loginsPerSecond:5, timeoutSeconds:600}`. Nominal N/rate must fit the deadline; actual slow login/probe work can still fail it.

1. Keep N distinct VUs, their official SDK clients and private cookie jars/auth stores alive in one `per-vu-iterations` scenario, one iteration per VU. Fixture-verification clients are discarded, not transferred into k6.
2. A Node standard-library gate in the existing runner/cgroup binds ephemeral loopback only. Issue at most one initial native login + protected own-likes probe at a time, spaced by the maximum rate without missed-slot catch-up. No initial retry, setup token pool, polling service, public control API, proxy or third container.
3. Verify SDK identity and own-likes fixture semantics, then register only ordinal/numeric expiry evidence. Release only every distinct 1..N ready with no login in flight. Require native expiry through assigned activation plus the unchanged 10-second backend timeout. Unknown `iat` means unknown observed TTL (PocketBase), not an invented issue time; expiry must still be known and usable. Never extend security TTLs or repair readiness with an extra password login.
4. Return one common wall epoch, two seconds ahead rounded up to a millisecond, correlated with monotonic rate/deadline clocks. Reject material clock inconsistencies. Gate/preparation time includes k6 startup after gate creation and does not consume application time. Close held connections/listener before activity; late/missing recipients invalidate the point.
5. Stagger application activation over 30 seconds, then give all N users 60-second warm-up and 120-second measurement. Initial synthetic 300–900-second engagement age begins at that VU's activation; native token age remains anchored to real preparation login. Subsequent paced logout/login renewals and SDK auto-refresh remain native and failures stay visible. PocketBase logout clears client auth only.
6. Start no new action after measurement end. Keep each action's originating phase through prerequisites/refresh/completion, preserve raw boundary-crossing timestamps and bounded drain, and record actual HTTP request-start phase separately. A ready but idle/nonparticipating user is not proof of an N-active-user point.
7. Reconcile the sanitized gate ledger and numeric ordinal lifecycle events from original compressed output: exactly one readiness/release/first-measured-action/normal-completion event per expected user, plausible common timing, no extras/duplicates/incomplete accounting. Use the verified common measurement boundary for the **full** CPU window, never a conveniently later first action.
8. Report preparation counts/rate/deadline/elapsed/expiry bounds, configured/ready/measured/completed populations, drain, successful/completed actions/sec, measured backend requests/sec and session-start rate. Preserve overall HTTP metrics but distinguish backend from long-held loopback control requests; control failure is invalid, not harmless excluded traffic. Separate initial/ongoing phase login attempts/successes/failures and successful-login-only duration, logout/refresh outcomes, native child exit and cleanup evidence.
9. Application tail sufficiency remains >=1,000 measured samples per action. Password-login/refresh evidence is independent: zero attempts means `not_exercised`, insufficient samples are explicit, and absent or structurally corrupt summaries produce unknown counters/unavailable evidence—not fabricated zero failures; actual preparation failure remains visible and invalid accounting skips end-count traffic. Any genuine auth failure still prevents a passing result. Preparation/participation/control/resource/clock/interruption failure is `invalid`, never a backend SLO upper endpoint. Keep genuine observed SLO failures and `generator_limited` distinct.
10. Retain failed used fixtures/databases and original partial logs, skip premeasurement end-count logins/API deletion, and perform checked owned shutdown; uncertain cleanup retains its claim. Successful test-owned points use existing checked API cleanup. All results remain `certified:false`; no repeated tails, soak, natural expiry or generator headroom are certified by a short point.

Budgets/guards remain backend 1 CPU/4 GiB and runner 4 CPUs/16 GiB, no swap, normal 85% memory guards, backend nofile16384, and existing health/OOM/host/disk/request/capture/CPU/ownership safeguards. The historical backend95 experiment is not inherited. Tiny smoke uses 4 fixture accounts/2 VUs and accelerated 1/2/12-second application phases plus 30-second auth deadline, not production workload timings.

Only implementation and isolated small correctness/regression validation are authorized in this delivery. Performance points require a new bounded approval. Preserve the stopped partially deleted canonical PocketBase fixture, its offline database, historical evidence and legacy defaults; use fresh separately recorded test namespaces instead. See `AUTHENTICATED_CAPACITY_IMPLEMENTATION_PLAN.md` and the current `PROGRESS.md` for evidence/limitations.

## 9. Capacity measurement protocol

### Success criteria

Evaluate **logical action latency**, excluding think time but including SDK work, token refresh, and prerequisite requests. Keep raw HTTP timing separately.

| Criterion | Initial proposal |
|---|---|
| Each read action p95 | <= 500 ms |
| Each write action p95 | <= 750 ms |
| Login p95 | <= 1,000 ms |
| Each application action p99 | <= 2,000 ms |
| Login p99 | <= 3,000 ms |
| Unexpected logical failures | < 1% overall and per action |
| Correctness/authorization | No known violations |
| Stability | No crash, OOM, restart, growing backlog, or persistent late-run degradation |
| Load generator | Verified headroom and no generator-imposed ceiling |

The p95/error limits are user-confirmed; p99 and stability checks are additional conservative defaults selected under delegated judgment. All are configurable policy choices, not industry truths. Timeouts, 429s, 5xx, exhausted retries, invalid payloads, and failed checks are failures. Expected permission-denial tests run separately and do not contaminate normal workload error rates. SDK retries must be identified, bounded, recorded, and included in latency; never silently retry away failures.

Require adequate samples for each action and login before certifying tail percentiles. Aim for at least 1,000 samples per action per certification trial; extend low-concurrency trials if necessary, or label their per-action tails inconclusive. A percentile without enough samples is not an SLO pass.

### Search and certification

1. **Conformance:** deterministic single-user and two-user lifecycle, ownership, and data checks.
2. **Smoke:** 1–10 VUs for 1–2 minutes to catch configuration mistakes; not capacity evidence.
3. **Generator calibration:** demonstrate the runner's throughput/VU headroom against a controlled fast target with equivalent payloads and exercise SDK overhead. Then validate near the real boundary using a larger/separate runner; a controlled target alone cannot prove absence of generator limits.
4. **Discovery:** independent short trials at 10, 20, 40, 80, ... active users until a likely SLO failure or a safety/pool/search limit. Use fresh baseline state for every candidate. Discovery guides the search, not the published answer.
5. **Refinement:** search between last pass and first fail, resolving to roughly 10% or a configured absolute VU step. Rerun noisy/non-monotonic points rather than pretending capacity is perfectly monotonic.
6. **Certification:** for both boundary candidates, start from baseline, ramp users over ~2 minutes, warm for 3 minutes, then measure at constant active-user count for **20 minutes**. Perform **three independent trials** with fixed documented seeds, repeating baseline reset and readiness checks. Increase duration when sample counts demand it.
7. **Window checks:** evaluate whole measured period and late/rolling windows; use 5-minute windows where sample counts permit. A good global p95 must not conceal deterioration at the end.
8. **Soak:** confirm the highest consistently passing candidate for **60 minutes minimum** to observe longer-term memory/storage behavior. Refresh coverage is verified separately if the configured sessions never reach token expiry. If it fails, lower capacity and repeat confirmation.
9. **Recovery:** after a bounded overload test, verify the backend recovers under normal load. Do not push an already OOMing stack indefinitely.

Suggested publication rule: report the highest tested candidate that passes all certification trials and the soak, plus the smallest reproducibly failing candidate. Keep all individual trials. Mixed outcomes yield an uncertain interval, not a selectively chosen best result. Recheck after a soak-induced lower bound. If there is no failing point before a configured limit, report a lower bound (`>= N`), not “maximum N.” Search precision is not a statistical confidence interval.

Use a **closed model** (`constant-vus` during measurement) for the primary active-human benchmark. As the backend slows, humans issue actions more slowly; this is intentional but can hide overload if only throughput is observed. Always report achieved action rate, latency, and failures together. At low latency, rough action throughput is `N / (mean think time + mean action duration)`; it is not an exact user-to-RPS conversion.

Later add a separate **open arrival-rate** workload to characterize saturation without response-time-driven pacing. Track dropped iterations and allocated VUs. Do not substitute it for the session model or claim its executor VUs equal active human users. No open-model result enters the primary closed-model leaderboard.

## 10. Instrumentation and artifacts

### Runner metrics

- Logical action count, success/failure, p50/p90/p95/p99/max duration, by low-cardinality action and phase.
- HTTP request count/rate, failure status classes, duration, waiting/connection/TLS times, bytes in/out.
- Authentication login/logout/refresh attempts, outcomes, timings, and session-start rate.
- Active VUs, completed iterations/actions, achieved throughput, actual action mix, target-unavailability, retries and conflicts.
- Runner CPU, memory, network, file descriptors/socket pressure, and output-writing overhead.

Normalize HTTP metric names to route templates; do not tag user IDs, post IDs, full dynamic URLs, or tokens. A cardinality explosion can itself limit k6. Preserve response bodies needed for SDK parsing/checks; do not globally discard bodies and accidentally break the workload.

### Backend and host metrics

Sample roughly every second with UTC timestamps and monotonic elapsed time where available:

- Aggregate and per-container CPU, memory/current/peak, OOM events, restarts, CPU throttling.
- Disk space, I/O throughput/latency/pressure where exposed, network bytes, sockets.
- Host available memory, load, CPU steal on VPS, thermal/frequency information if available.
- External health probes at a fixed low rate, distinguished from workload traffic.
- Logs at a fixed bounded verbosity. Stop safely on OOM loops, severe disk exhaustion, or invalid target/config.

Docker/cgroup memory includes relevant page-cache accounting; do not compare process RSS alone. Resource metrics can inspect the OS/container, but do not query application databases for telemetry. Mark unsupported metrics unavailable rather than invent equivalents.

### Run directory

```text
results/<campaign>/<backend>/<run-id>/
  manifest.json         # revision, versions, digests, architecture, topology
  config.json           # resolved non-secret configuration
  fixtures.json         # dataset recipe, hashes, API-verified counts, no passwords
  summary.json          # machine-readable result + explicit validity verdict
  report.md             # human summary, SLO table, limitations
  k6-summary.json       # original k6 end summary
  k6-metrics.json.gz    # original timestamped metric stream, if enabled
  resources.jsonl       # backend + generator + host samples
  backend-logs/         # bounded, access-controlled source logs
```

Preserve original outputs, exit codes, warnings, and failed trials; do not replace raw evidence with lossy summaries. Redact secrets at collection time where possible, restrict access to raw logs, and produce a separate sanitized export. Passwords/tokens/private identity manifests never enter public results or source control.

For multiple runner processes, never average p95/p99 values. Merge raw samples or compatible histogram buckets before calculating quantiles, align windows, and weight counts correctly. The first implementation uses one runner, with sharding fields reserved only where needed for portability.

Final comparison rows include server/SDK version, hardware/architecture, topology, resource profile, dataset/workload hash, duration, repetitions, capacity bracket, per-action SLO verdicts, throughput, failures, peak memory, CPU/throttling, storage growth, and validity notes. Show full curves, not just one winner number.

## 11. Small implementation structure

Use a small Node.js/TypeScript controller and preparation tools, plain versioned JSON, Docker Compose, and k6. One package manager, one lockfile, one bundler. No plugin marketplace, distributed scheduler, custom database abstraction, or web dashboard.

```text
README.md
BENCHMARK_PLAN.md
package.json + lockfile
src/
  cli.ts                  # validate, prepare, smoke, run, search, report, clean
  config.ts               # validation + resolved configuration
  prepare.ts              # API seeding and verification
  report.ts               # evaluate SLOs; preserve source outputs
  adapters/trailbase.ts   # official SDK operations and native-ID mapping
  k6/
    social.ts             # session state, weighted actions, metrics
    trailbase-transport.ts
configs/
  social-mixed-v1.json
  resources/backend-1cpu-4g.json
backends/trailbase/
  compose.yaml
  configuration/          # native schema/access/deployment artifacts
runner/Dockerfile
scripts/                   # only necessary host orchestration/telemetry
 tests/                    # contract, workload, transport, reporting checks
```

The layout is illustrative, not a requirement to create empty files. Add files only when their phase needs them. Begin with TrailBase-specific code, extracting the small shared action contract when PocketBase is added. SDK calls remain backend-specific; workload/session/metrics logic stays shared. Do not implement adapters for products not yet under test.

Proposed commands (future interface, not available yet): `bench validate`, `bench prepare trailbase`, `bench smoke trailbase`, `bench run trailbase --vus N`, `bench search trailbase`, `bench report <campaign>`, and `bench clean <deployment-id> --confirm`. Cleaning can only affect labeled benchmark-owned resources and must refuse unrelated volumes or arbitrary URLs.

## 12. Test strategy and acceptance gates

Write tests alongside each behavior; no performance ranking until these pass.

### Pure unit tests

- Configuration validation, weight totals, target ranges, identity-pool/shard checks.
- Deterministic action/think-time selection; distribution sanity with fixed seeds.
- Session lifecycle, bounded state, target selection, and no silently substituted/no-op actions.
- Metric classification including timeouts, 429s, invalid data, retries, and insufficient samples.
- Phase/window boundaries, pass/fail bracket logic, uncertain/non-monotonic runs, and lower-bound reporting.
- Aggregation from known samples; never average percentiles. Secrets excluded from manifests.

### SDK transport/conformance tests

- Official SDK registration, login, list/read/create/edit/like/unlike/logout.
- Real refresh, CSRF/header handling, error responses, network timeout, JSON/text/empty-body behavior.
- Isolated clients and sessions for multiple VUs.
- User A cannot modify B's post or like, spoof owner fields, or read private own-like data.
- Anonymous writes fail; public reads behave as configured.
- Duplicate likes and invalid foreign references are rejected as intended; stable ordering/page size/projection are correct.
- Read-after-write checks by APIs; validate every returned own-post author and edit target. Keep security tests untimed.
- Startup, preparation failure, partial seed handling, cleanup guards, actual CPU/memory limits, and reset equivalence.

### Performance harness checks

Run smoke tests on changes to SDK, adapter, transport, schema, auth, or workload. Run a full boundary certification after changes affecting measurement; old results do not certify new code. Test runner saturation behavior and invalid-result classification deliberately. Keep CI small/functional; variable shared CI hardware is not the reference benchmark machine.

## 13. Delivery phases

### Phase 0 — Confirm the measurement contract

Record the confirmed SLOs, complete-stack resource scope, and SDK incompatibility approval gate. Adopt the simple workload/dataset/session defaults in this plan, username-only pilot auth, and supported declarative schema provisioning. Freeze `social-mixed-v1` and initial resource/dataset profiles; ask only if feasibility requires an exception.

**Exit:** unambiguous versioned benchmark specification with unresolved decisions explicitly recorded.

### Phase 1 — Prove TrailBase + official SDK + k6

Resolve current stable server/SDK versions and native ARM64 images. Run an isolated two-container deployment. Bundle the SDK, implement only its required k6 transport support, and execute registration/login plus every requested action with real ACLs. Test forced refresh, separate VUs, errors, and Node-vs-k6 conformance.

**Exit:** SDK compatibility is demonstrated, or a concrete blocker and approved alternative are documented. No capacity automation before this gate.

### Phase 2 — Reproducible fixtures and correctness

Version schema, indexes, auth policy, and Record APIs. Implement API-only seeding/reset, credential handling, deterministic fixtures, conformance tests, and cleanup safeguards. Start with `pilot-small`.

**Exit:** one command can prepare a verified isolated baseline repeatedly without database data access.

### Phase 3 — Workload and single-run evidence

Implement configurable sessions, weighted stateful actions, delays, phase separation, per-action SLO metrics, resource collection, and source artifacts. Verify actual limits and runner headroom. Produce a smoke report and an exploratory fixed-VU run on OrbStack.

**Exit:** trustworthy single-run report, including failures and validity conditions. No “maximum users” claim yet.

### Phase 4 — Local capacity campaign

Implement bounded discovery/refinement, independent baseline resets, repeated certifications, soak, and capacity bracket reporting. Run `social-baseline` if preparation time and host headroom permit; otherwise label the smaller dataset explicitly.

**Exit:** repeatable TrailBase ARM64/OrbStack capacity interval with source evidence and known local limitations.

### Phase 5 — Linux / remote deployment validation

Run unchanged workload on a Linux VPS, then separate backend and runner hosts. Validate isolation, aggregate resource enforcement, networking/TLS, clock alignment, artifact transfer, and larger-runner confirmation. Prefer a dedicated backend machine for published results.

**Exit:** a portable TrailBase reference campaign; local and VPS results remain separate.

### Phase 6 — Add one BaaS at a time

1. **PocketBase:** native auth collections, collection rules/indexes, official SDK, same contract and fixtures.
2. **Supabase:** stable tested self-hosted stack snapshot rather than mixing independently newest component images; native Auth, RLS, database API, official SDK, and aggregate limits.
3. **Convex:** self-hosted backend + manually configured Convex Auth; authenticated equivalent query/mutation functions and official SDK; explicitly exclude subscriptions from this request/response workload.
4. **Nhost:** native auth, GraphQL authorization, official SDK, and all required services in scope.
5. **Directus:** native users/auth, role policies, ownership, public API, official SDK, and required storage/database scope.
6. **Appwrite:** native account auth, document/row permissions, official SDK, dependencies/workers, and resource-minimum qualification.
7. **Neon, only if eligible:** prove a supported entirely self-hosted API/auth stack under the budget without direct database workload calls or cloud-backed execution; otherwise report unsupported for this benchmark and consider a separate cloud experiment.

For each addition: research current deployment, prove SDK runtime compatibility, implement native schema/auth/API mapping, pass the shared conformance suite, verify seed equivalence and resource scope, then repeat the same campaign on the reference host. A product that cannot start correctly within a profile is `not viable at this profile`, not “0 concurrent users.” A product that cannot satisfy the API/auth contract is `unsupported contract`, not a performance loss.

Avoid installing all services during the pilot. Add larger hardware profiles only as explicitly separate comparisons; do not quietly give larger stacks extra resources.

## 14. Confirmed decisions and simplicity boundaries

- **Confirmed:** reads p95 <=500 ms, writes p95 <=750 ms, login p95 <=1 s, unexpected failures <1%.
- **Confirmed:** official multi-container backend stacks are allowed under one shared CPU/RAM budget.
- **Confirmed:** try a thin in-process SDK transport layer; ask before any fallback.
- **Delegated judgment:** use the dataset sizes, 1–5-second think time, and 5–15-minute active sessions above. Start with username-only TrailBase auth; keep email-verification flows out of the timed workload. No VPS-provider choice is needed for the local pilot.
- **Keep the first version small:** one backend, one runner, supported declarative provisioning, API reseeding, one workload, one fixed-VU run, local raw artifacts and a Markdown report. Build automated search only after that evidence is trustworthy.
- **Defer:** stopped-volume snapshot optimization, multiple runner hosts, open-model tests, additional datasets/hardware profiles, and dashboards until demonstrated need. API reseeding is the initial reset path.
- **Ask only on a real blocker:** SDK incompatibility, direct-DB provisioning requirements, unavailable native architecture, or an inability to enforce the declared resource profile. No extra questionnaire is needed before starting the pilot.

## 15. Primary sources and verification status

Consulted during planning; moving docs are evidence for design decisions, not substitutes for validating the pinned runtime:

- TrailBase latest stable release: https://api.github.com/repos/trailbaseio/trailbase/releases/latest and https://github.com/trailbaseio/trailbase/releases
- TrailBase SDK published package: https://registry.npmjs.org/trailbase/latest
- TrailBase Docker tags/platforms: https://hub.docker.com/r/trailbase/trailbase/tags
- TrailBase auth/verification: https://trailbase.io/documentation/auth/
- TrailBase Record API: https://github.com/trailbaseio/trailbase/blob/v0.35.1/docs/src/content/docs/documentation/apis_record.mdx
- Inspected SDK client/transport source: https://github.com/trailbaseio/trailbase/blob/v0.35.1/crates/assets/js/client/src/client.ts and https://github.com/trailbaseio/trailbase/blob/v0.35.1/crates/assets/js/client/src/transport.ts
- k6 module/runtime compatibility: https://grafana.com/docs/k6/latest/using-k6/modules/
- k6 open/closed model: https://grafana.com/docs/k6/latest/using-k6/scenarios/concepts/open-vs-closed/
- Supabase self-hosting, requirements and stable stack updates: https://supabase.com/docs/guides/self-hosting/docker
- Convex self-hosting and manual auth setup: https://github.com/get-convex/convex-backend/blob/main/self-hosted/README.md
- Nhost self-hosting: https://docs.nhost.io/platform/self-hosting
- Appwrite requirements: https://appwrite.io/docs/advanced/self-hosting/installation
- Neon Local cloud-proxy behavior: https://neon.com/docs/local/neon-local

No dependencies were installed, containers started, runtime compatibility proven, resource isolation measured, or benchmarks executed as part of writing this plan.
