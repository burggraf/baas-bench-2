# Supabase API benchmark deployment

This profile implements the entire seven-action social benchmark using native Supabase Auth, PostgREST, PostgreSQL row-level security and the official `@supabase/supabase-js` SDK. Its required API stack is adapted from Supabase's coherent Docker snapshot `b046f1257110f6ac9c7fefe820bfac3ff88a3f38`. Native ARM64 image digests and SDK version are in [versions.json](versions.json).

The tested services are Postgres 17.6.1.136, Auth 2.197.0, PostgREST 14.18 and Envoy 1.39.6. Studio, Realtime, Storage, Functions, Analytics and Supavisor are excluded because this workload does not call them. Results are **API-stack capacity observations**, not full-product or full-stack sizing recommendations. Supabase documents two CPU cores/four GB as its full-stack minimum; the one-CPU/four-GiB profile here is an intentionally constrained comparison with the existing backends.

Each deployment creates a fresh, uniquely named cgroup parent. All four backend services run inside its **shared** one-core/four-GiB/no-swap limit; they do not each receive an independent backend budget. Parent CPU/memory/OOM/throttle counters and every child service's health, identity and restart state are observed. The native aggregate proof exercised two independently busy one-core containers under one parent and observed approximately one aggregate CPU core. Parent groups are removed only after checked owned shutdown; data volumes remain retained.

The gateway accepts only the deployment's public anonymous API key and routes native Auth/REST paths. Auth issues one-hour access JWTs; email/password authentication maps deterministic benchmark usernames onto `username@bench.invalid`, with matching username metadata and email autoconfirm enabled. Explicit native SDK refresh is checked within requests, and native global logout revokes refresh sessions; already-issued access JWTs retain their native expiry. Signup and authentication rate limits are configured above fixture/admission rates; the workload itself still admits at five initial logins/second without retries. PostgREST SDK transient retries are explicitly disabled to preserve the benchmark's single-attempt policy.

The schema has public posts, private own likes, immutable ownership, cascade deletion, payload validation, feed/author/like indexes and an authenticated self-deletion RPC. The RPC accepts no account ID and deletes only `auth.uid()`; no service-role key or database credential reaches a VU. Administrative SQL is used only to provision the application schema. All accounts, posts, likes, validation and cleanup use the native API/SDK. Exact count queries are preparation/verification/prerequisite operations; ordinary feeds omit counts and select only their required fields.

Untimed fixture creation and both baseline verifications have **no elapsed-time cutoff**, as requested by the user. Request timeouts, explicit cancellation and host/aggregate memory/OOM/health guards still apply. This setup policy is separate from the unchanged N/5+200-second prepared-login gate and 30/60/120-second application phases. The initial full-dataset attempt hit its former two-hour setup deadline during the second verification and produced no measured capacity point; its original fixture, volume and evidence remain retained.

The controller creates private ephemeral database/signing credentials locally, retains them only in ignored `.fixtures/` namespaces and archives them after shutdown. It refuses existing fixture/operation claims and unowned resources. Do not run it in a used historical workspace.

```sh
# Build the official-SDK bundles and runner, then use a fresh isolated workspace.
npm ci
npm run build
docker compose build runner
node scripts/supabase.js --prepared-sessions --smoke --runner-cpus=9 --runner-memory=48g --runner-gc=150 --payload-cache=480m
# An explicit full point replaces --smoke with --vus=N (100..15000).
```

A local Docker cgroupfs/v2 Linux VM and native ARM64 host are required for this pinned profile. A narrowly scoped privileged setup helper creates and checks the owned parent cgroup; it does not run benchmark traffic. The host/VM/swap/reserve checks and the existing 85% memory and 90%-of-runner-CPU policies remain enforced. A default single-point controller never starts an unbounded search. Failed fixtures and original evidence are retained; no implicit adoption, reset or destructive volume cleanup occurs.

Primary references: [official Docker setup](https://supabase.com/docs/guides/self-hosting/docker), [upstream compose snapshot](https://github.com/supabase/supabase/blob/b046f1257110f6ac9c7fefe820bfac3ff88a3f38/docker/docker-compose.yml), [official JavaScript SDK](https://github.com/supabase/supabase-js).


## Optimized workflow validation

`--optimized-setup` keeps each fixture account's native SDK session in RAM between the likes and baseline-verification passes. It performs an actual password login once before reuse, checks the expected username/ID on every restoration, and refreshes through the official SDK when needed. Tokens never enter fixture files or public artifacts. Every cached setup session is globally revoked before the measured VUs independently password-login. Native Auth rejects restoration after revocation, so post-run verification establishes a fresh session once per account and reuses it through deletion checks. All baseline contents, ownership rules and both complete API verifications remain checked.

Final Supabase sign-outs are deterministically staggered at five/second after the unchanged application deadline. They remain real native global sign-outs and remain subject to the original auth-failure checks. The runner's allowed cleanup time is extended to cover that schedule; application ramp/warm-up/measurement and their latency/failure thresholds are unchanged. This fixes the earlier all-at-once final sign-out burst: the first full-dataset 1,000-user attempt had zero failed measured actions and passed all seven application latency targets, but every final sign-out failed under the burst. Its original verdict and raw evidence are preserved; that cleanup failure does not establish an application-capacity upper bound.

For a fast, explicitly non-comparable workflow check:

```sh
node scripts/supabase.js --prepared-sessions --vus=100 --optimized-setup --validation-dataset=1000 --runner-cpus=9 --runner-memory=48g --runner-gc=150 --payload-cache=480m
```

This validation-only recipe contains 1,000 accounts/10,000 posts/10,000 likes and retains the full 120-second application measurement. The controller marks it `capacityEligible:false`; it must not be compared with the fixed 15,000-account capacity series. The same small fixture supports a subsequent 1,000-active-user workflow point. Full comparison points omit `--validation-dataset=1000` and retain the original 15,000-account recipe. A pristine-baseline cloning prototype was deferred to prioritize a working measured test; it is not enabled in the controller.

## Host-native s6e benchmarks

Use a dedicated s6e project with email sign-up and auto-confirm enabled. Apply
`100-social.sql` as a database administrator so the authenticated account
deletion RPC can delete its caller from `auth.users`. Then run from the repo
root with the project's public anon key in the environment:

```sh
node scripts/s6e-smoke.js 'http://<ref>.supabase.<domain>:55321'
node scripts/s6e-smoke.js 'http://<ref>.supabase.<domain>:55321' --load
node scripts/s6e-smoke.js 'http://<ref>.supabase.<domain>:55321' --vus=500
node scripts/s6e-smoke.js 'http://<ref>.supabase.<domain>:55321' --vus=1000
node scripts/s6e-smoke.js 'http://<ref>.supabase.<domain>:55321' --vus=2000
```

The runner uses the official SDK directly from Node.js. It runs conformance,
seeds and verifies a fixture, measures the seven social actions, and verifies
that fixture cleanup removes all posts. The default smoke profile uses two
users. The load profile uses 50 fixture users and measures 25 concurrent users
for 60 seconds. The 500-, 1,000-, and 2,000-user profiles admit five users per second
and use the same 60-second measurement. Add `--loopback` on the s6e host to connect
to `127.0.0.1:55321` while preserving the project hostname for Envoy routing. The summary goes to `results/s6e-native-*/report.json` and fixture credentials stay under
`.fixtures/`. The existing Compose campaign remains the entry point for the
published capacity series.
