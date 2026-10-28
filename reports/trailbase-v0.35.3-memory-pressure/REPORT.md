# v0.35.3: concurrent-login workload drives anonymous memory near a 4-GiB limit with hundreds of runnable workers

## Summary / question

We are investigating memory pressure during a login-heavy ramp against the official **TrailBase v0.35.3** image, limited to **1 CPU and 4 GiB RAM**, without container swap.

Within approximately 54 seconds of the beginning of observation, the backend crossed our 95% memory safety threshold. During the observed interval:

- TrailBase process anonymous RSS grew from approximately **218 MiB to 3.47 GiB**; total process RSS reached **3.51 GiB**.
- Process threads grew from **11 to 342** at the last sample, with a sampled peak of **348**. Immediately before the guard, **334 threads were named `tokio-rt-worker`, of which 263 were runnable**.
- File-backed/cache memory stayed around **198 MiB**, rather than explaining the multi-GiB increase.
- Backend CPU was approximately saturated at its one-CPU quota.
- Our collector completed **50 samples with zero errors**. This was a backend-memory safety stop, not a collector timeout.

**Our leading hypothesis is excessive concurrent password-verification work and its anonymous working memory.** The source and observed worker buildup support this, but we have not captured native allocation stacks, proved a leak, or isolated a login-only reproducer.

We do **not** expect a one-CPU backend to serve 1,500 authenticated users successfully. The question is whether authentication work can be bounded/backpressured so overload produces predictable rejection or queueing instead of approaching the container's memory limit.

## Environment

| Item | Value |
|---|---|
| Actual server output | `trail v0.35.3-0-g80e1c7ec (2026-10-23)`; SQLite `3.53.2` |
| Official image | `trailbase/trailbase:0.35.3@sha256:91d8115ff58fbb569e94460d006726e83106707c5aa70138367402ac7618cff4` |
| Image/source relationship | Release tag commit `80e1c7ecbd38fad49981f6383591ef990542815d`; runtime version matches its short commit |
| Platform | Native `linux/amd64`, no emulation |
| Host recorded by harness | Linux `6.8.0-147-generic`, Intel Xeon Platinum 8268, 8 logical CPUs, 33,606,881,280 bytes RAM |
| Backend cgroup v2 | CPU quota/period `100000/100000`; `memory.max=4294967296`; `memory.swap.max=0` |
| Backend file descriptors | Actual process soft/hard `16384/16384`; no EMFILE warnings found |
| Server arguments | `/app/trail --data-dir /app/traildepot run --address 0.0.0.0:4000 --admin-address 127.0.0.1:4001` |
| Server configuration | Username/password authentication (`user_identifier: ONLY_USERNAME`); no password-hashing override; attached `config.textproto` |
| Load generator | Separate k6 `2.3.0` runner, 4 CPUs / 16 GiB / no swap; official TrailBase JS SDK `0.14.3` |
| Client request deadline | 10 seconds |

Only the backend is constrained to one CPU; the load generator has a separate allocation. The runner's lifetime peak was **2,675,105,792 bytes (~2.49 GiB)**, far below its budget. No host or runner memory guard was the primary stop.

## Workload and reproduction recipe

This is the **full tested scenario**, not a claimed minimal reproducer:

1. Start a fresh isolated TrailBase deployment with the pinned image, attached configuration and schema. Apply the backend limits above, including no swap and nofile 16384.
2. Through the SDK/API, create **10,000 accounts, 100,000 posts and 100,000 likes**, with 10 posts and 10 likes per account. Post bodies are 1,024 bytes. Verify the logical dataset before load. In this run, preparation and double verification took about 34m48s, with no guard stop and peak backend current memory of **463,069,184 bytes (~442 MiB)**.
3. Run a closed-loop k6 `ramping-vus` scenario: start at 0, ramp to **1,500 VUs over 30 seconds**, hold for 60 seconds of additional warm-up, then plan 120 seconds of measurement. The run stopped before measurement. The ramp is not a fixed HTTP arrival rate.
4. Give each VU a different pre-created account. Each VU uses the official SDK to log in before actions. On failed login, it sleeps **uniformly 1–5 seconds**, then retries while the scenario is active. Thus failed-login retries contribute to offered authentication load; this is not merely 1,500 total login attempts and is not a tight, unpaced retry loop. Successful sessions are configured for 300–900 seconds, longer than this stopped interval.
5. After successful authentication, choose actions with weights: public list 35%, own list 15%, read 15%, create 5%, like 17%, unlike 5%, edit 8%. Lists use page size 20; actions have 1–5-second think time. Most VUs did not get past login successfully in the exported evidence.
6. Observe backend cgroup memory and actual server process RSS/threads. Our safety policy initiates shutdown above **95% of 4 GiB = 3.8 GiB**, retaining evidence. Do not disable the hard limit or rely on this sampled guard to prevent every hard-limit event.

The exact command in our benchmark checkout was:

```sh
node scripts/baseline.js --campaign --vus=1500 --runner-memory=16g --backend-memory-stop=95
```

That command is **specific to our harness**, not a TrailBase CLI option. Its workload implementation is `src/k6/social.js`, with transport in `src/k6/transport.js`. This packet includes the effective workload settings in `evidence.json`, the exact public server configuration and the schema migration. It does not contain a standalone account seeder/load generator. Reproduction requires generating fresh credentials and using a fresh disposable volume; do not run against an existing retained failed fixture or a production deployment.

## Memory/thread timeline

All memory values below are **GiB (2³⁰ bytes)**. Times are relative to the first complete diagnostic sample, not necessarily k6 scenario start. Full-precision values for all 50 samples are in `memory-timeline.csv`.

| Elapsed seconds | Backend cgroup current | Cgroup anonymous memory | Process threads |
|---:|---:|---:|---:|
| 0.000 | 0.430 | 0.213 | 11 |
| 10.176 | 1.521 | 1.222 | 105 |
| 19.566 | 1.096 | 0.862 | 178 |
| 30.528 | 1.923 | 1.616 | 329 |
| 40.299 | 3.241 | 2.872 | 348 |
| 50.261 | 2.907 | 2.419 | 342 |
| 53.650 | 3.835 | 3.296 | 342 |
| 54.792, after guard | 3.999 | 3.465 | 342 |

The authoritative guard fired at **53.728 seconds**, recording **4,154,036,224 bytes (3.869 GiB)**. The sample at 53.650 seconds completed 78 ms before that guard; it is not the guard's own capture. Its process RSS was **3,581,341,696 bytes**, with 334 Tokio-named threads, 263 of them runnable, and 1,390 open FDs. Observed aggregate thread CPU usage near this point was approximately 0.95 cores.

Memory fluctuated significantly rather than rising monotonically. This is compatible with transient work/allocator retention and is **not evidence of an unbounded memory leak**. The observed dominant increase was anonymous memory in the actual TrailBase server process, not the container init process or the separate runner.

Cgroup memory.stat, process RSS and cgroup current overlap and were read sequentially; they are not an atomic, exactly additive decomposition. Thread names also do not distinguish Tokio async workers from blocking workers. We do not attribute 19 MiB to each observed thread.

## What stopped, and what did not

- **Primary stop:** our authoritative `backend_memory_guard`, initiating controlled test shutdown.
- At the guard capture, `memory.events.max=0`, `oom=0`, `oom_kill=0`.
- During shutdown, the backend lifetime peak reached **4,294,963,200 bytes**, only **4 KiB below the 4-GiB hard limit**. Final `memory.events.max=54`, `oom=0`, `oom_kill=0`.
- These are late hard-limit pressure events, not 54 OOM kills or necessarily 54 failed allocations. The backend did not restart; final Docker evidence reported it running/healthy before removal.
- The observer had **zero errors**, maximum combined capture **580.656 ms**, and maximum sampling gap **1,582.931 ms**, within its unchanged 2,000/5,000-ms limits.

A previous v0.35.1 attempt was stopped by our expensive `/proc/<pid>/smaps_rollup` read timing out. We removed that read and verified the corrected collector before this run. **We do not submit that earlier collector failure as proof of TrailBase memory exhaustion, or claim a controlled version-to-version performance comparison.** This report concerns the successfully observed v0.35.3 backend memory stop.

## Source-supported hypothesis

The following are pinned source observations, not native allocation attribution:

1. [`check_user_password`, v0.35.3 release commit](https://github.com/trailbaseio/trailbase/blob/80e1c7ecbd38fad49981f6383591ef990542815d/crates/core/src/auth/password.rs#L93-L139) runs verification through `tokio::task::spawn_blocking` and wraps the JoinHandle in `tokio::time::timeout`. [`HASHING_TIMEOUT`](https://github.com/trailbaseio/trailbase/blob/80e1c7ecbd38fad49981f6383591ef990542815d/crates/core/src/auth/password.rs#L197) is five seconds. There is no explicit concurrency permit in this inspected function; we have not exhaustively audited route-level admission controls.
2. The [extension password implementation](https://github.com/trailbaseio/trailbase/blob/80e1c7ecbd38fad49981f6383591ef990542815d/crates/extension/src/password.rs#L45-L54) uses `Argon2::default()`. The [pinned Cargo.lock](https://github.com/trailbaseio/trailbase/blob/80e1c7ecbd38fad49981f6383591ef990542815d/Cargo.lock) selects Argon2 **0.6.0**; its [default memory parameter](https://docs.rs/argon2/0.6.0/argon2/struct.Params.html#associatedconstant.DEFAULT_M_COST) is 19 × 1,024 KiB = **19 MiB**. Verification uses the stored hash's parameters; we did not dump stored credential hashes, so this is the source default for the account-creation path, not a database-level audit of every stored hash.
3. The [main runtime builder](https://github.com/trailbaseio/trailbase/blob/80e1c7ecbd38fad49981f6383591ef990542815d/crates/cli/src/bin/trail.rs#L809-L811) does not set a custom `max_blocking_threads`. Cargo.lock selects Tokio **1.54.1**. Its checksum-verified source has a default maximum of **512 blocking threads**. The [`spawn_blocking` documentation](https://docs.rs/tokio/1.54.1/tokio/task/fn.spawn_blocking.html) explains that the pool grows toward its limit and that already-started blocking tasks cannot be aborted. It specifically cautions about CPU-bound work and suggests bounding parallel execution.

A plausible sequence is therefore:

> Login demand and retries exceed the one-CPU verification service rate → more blocking verification jobs are admitted and workers become runnable → multiple memory-hard hash computations overlap → anonymous resident memory grows → caller timeouts do not necessarily stop already-started hash work → memory pressure persists while requests fail/retry.

For scale only, **512 × 19 MiB = 9.5 GiB** of nominal hash working memory, before database/process overhead. That arithmetic is **not** a measured allocation breakdown, a claim that 512 hashes ran, or a safe-concurrency estimate. It illustrates why a general-purpose blocking-thread cap can be much larger than a 4-GiB container's memory budget allows for memory-hard work.

The correlated anonymous-memory/worker growth strongly motivates investigating this path. It does not prove that all the anonymous memory belongs to Argon2, rule out allocator retention/other allocations, or prove that this is the only cause.

## Authentication results and limits of the claim

The incomplete exported metrics contain:

| Metric | Observed |
|---|---:|
| Offered VU gauge | 1,500 |
| Successful-login counter events | 47 |
| Exported login HTTP points | 3,224 |
| Login status 200 / 504 / 0 | 47 / 13 / 3,164 |
| Exported measurement-phase points | **0** |

Status 0 is not an HTTP response: it includes timeout/network/interruption cases, including effects of forced shutdown. Successful-login events are not a unique-user count. We cannot derive sustainable throughput, p95/p99 SLOs, maximum authenticated users, or a clean capacity result from this stopped run.

## Questions for maintainers / suggested investigation

1. Is there a supported configuration to bound **in-flight password hashing/verification**, independently of the general Tokio blocking pool and without reducing Argon2 security parameters?
2. Would admission control with a bounded queue/explicit overload response be appropriate here? If a permit is used, should it remain held until the **blocking computation actually finishes**, even after the caller times out?
3. Is there an existing mechanism for shedding queued auth work after timeout/disconnect that this deployment should enable?
4. Would a login-only reproduction and an allocation profile be the preferred next evidence? A controlled comparison with failed-login retries disabled could separate initial ramp demand from retry amplification. These follow-up experiments have **not** been run.

## Attachments and evidence provenance

This sharing packet contains only:

- `REPORT.md` — this issue-ready report; paste it into an issue or send it as Markdown.
- `memory-timeline.csv` — 50 allowlisted numeric samples; plot elapsed seconds against memory bytes and thread counts.
- `evidence.json` — effective environment/workload, numeric outcome and SHA256 references to preserved source evidence.
- `config.textproto` — exact public server configuration, without runtime secrets.
- `U1792454400__social_schema.sql` — schema only; no account or application rows.

The full original evidence was sealed and reverified locally. Completion-verification SHA256: `bea5a394aee16872df42d67ac5bc933518839a076f8d200d326a8184bd9de0cf`. The report packet was created afterward from those preserved files; the original sealed run was not edited. Its source references are local repository paths, not automatically public URLs.

**Do not attach credential fixtures, database volumes, `.fixtures/`, private backend/controller logs, tokens or account dumps.** This packet does not include those materials. No new load test or public issue submission was performed to create this report.
