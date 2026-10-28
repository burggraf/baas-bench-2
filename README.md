# BaaS Bench

API-only, SDK-based capacity benchmarks for self-hosted backend-as-a-service systems. Start with [the benchmark plan](BENCHMARK_PLAN.md). To resume development, read [PROGRESS.md](PROGRESS.md) for the current checkpoint, verified work, and next steps.

**Current milestone: API-only fixtures, exploratory weighted workload, observability/recovery, fresh-deployment logical baseline proof, verified fresh-deployment 50- and 100-user sizing pilots and separate real-TTL SDK authentication verification—not capacity certification.** TrailBase conformance and the stateful workload use **17% likes / 5% unlikes**. Two-user natural refresh/continuity and a separate partial local SDK read calibration are verified; neither resource observations nor synthetic reads certify full generator headroom. The bounded local discovery controller is implemented/tested; its first 1,000-user campaign stopped on runner memory safety before measurement. Repeated performance certification and soak remain deferred.

## Requirements

- macOS/OrbStack or Linux with Docker Engine and Docker Compose; the pilot currently verifies **cgroup v2** limits.
- Node.js >=24.11 and npm on the controller host for bundling and test orchestration.
- Git, plus outbound access to npm and Docker registries during installation/build.
- Port 4000 available on localhost. No cloud account or external auth service required.

Pinned runtime: **TrailBase 0.35.4**, official **trailbase SDK 0.14.3**, **k6 2.3.0**, and runner **Node.js 24.11.0**. Container bases are pinned by multi-platform image digest; npm dependencies have an integrity-locked lockfile. Native ARM64 is used on the M1; AMD64 is available on corresponding Linux hosts. No host k6 installation is needed.

## Runner profiling: bounded repeated-read optimization

The user chose profiling before another full load test. Native CPU profiling and isolated phase timings identified repeated URL processing as a hotspot. The shared k6 transport now keeps **one already-validated immutable path's URL metadata per client**; it never caches responses, bodies or authentication headers, and every different path retains the original security validation. SDK behavior, raw evidence, request timeouts, CPU/RAM allocations and safety/headroom rules remain unchanged.

Four uninstrumented ABBA trials at **400 synthetic SDK reads/sec** reduced mean measured-window runner CPU from **2.33 to 1.24 cores (~47%)**, with all **32,003 measured reads** completed and zero drops/failures. This is the repeated-one-path best case on the existing 128-VU/4CPU/2GiB calibration profile, **not proof of the mixed social workload's gain, full generator headroom, authentication success or passing 1,500-user capacity**. No new full point or CPU-budget increase was performed.

Verification passed: **124 unit tests**, **7 complete native calibration integration tests**, 2 CPU-analysis tests, 4 retained-profile decoder tests, production-build identity and diff checks. The real used fixture stayed in place; profiling/calibration sent no TrailBase traffic and mounted no retained data volume. The initial native-validation source-copy omission and its corrected rerun are documented, not discarded. See [`results/runner-profile-289suj/SUMMARY.md`](results/runner-profile-289suj/SUMMARY.md) and its authoritative `completion-verification.json` preservation/privacy proof.

## Completed: TrailBase v0.35.4 and one fresh 1,500-user attempt

The user authorized upgrading to **v0.35.4** and one new fresh 1,500-user point with the original 30-second ramp and unchanged CPU/RAM/swap/nofile/guards/security/workload. The official multi-platform image is pinned to `sha256:cd4ddc4395b550f9d4aeea2438896804b75ecf5b12b4f187195c8435e3583d24`; release/tag/latest metadata are verified. The release explicitly bounds password-hashing concurrency; pinned source places a permit around the actual blocking operation, with parallelism derived from available CPUs. This is relevant to the preceding hypothesis, **not proof of a successful load-test outcome**.

**The single fresh v0.35.4 point completed without a memory safety stop:** backend lifetime peak **~483 MiB**, sampled thread peak **11**, no memory.max/OOM/restart events, versus nearly 4 GiB/348 threads on v0.35.3. The earlier memory blow-up did not recur in this attempt.

The result remains **generator_limited, not passing capacity**. The runner averaged 3.68 of its four CPU cores over a qualifying measured window, exceeding the unchanged headroom rule. Native k6 exited99; 7,736 login attempts failed (HTTP429/504), including 1,238 during measurement. All **56,096 measured social actions** completed with zero logical failures, but that does not erase auth failures or establish generator headroom. Controller exit1 intentionally preserved the failed fixture; its one-use authorization is spent, with no automatic retry.

Validation passed: version RED→GREEN; 121 units/all31 native cases/10 diagnostic-analysis checks, two native collector trials and the source/preservation gate before dispatch; 121 units/12 diagnostic-analysis-privacy checks/build/frozen hashes/diff afterward. Final sealed-evidence verification passed: **180 public files / 110,202 actual passwords**, all 19 historical volumes/21 private archives/prior evidence/maintainer packet unchanged, current used fixture/ready+used archives/offline volume retained. No managed jobs, owned resources or claims remain.

Report: [`results/server-point-1500-0354-SK1NbD/SUMMARY.md`](results/server-point-1500-0354-SK1NbD/SUMMARY.md). Final proof: `results/server-point-1500-0354-SK1NbD/completion-verification.json`. Pipeline: `results/trailbase-0354-1500-wcXl7L/`. All v0.35.3 evidence and its maintainer packet remain historically immutable; read `PROGRESS.md` for the completed checkpoint and constraints on any new test.

## Completed: TrailBase v0.35.3 upgrade, diagnostic fix and fresh 1,500-user attempt

That v0.35.3 attempt used verified official multi-platform digest `91d8115ff58fbb569e94460d006726e83106707c5aa70138367402ac7618cff4`. The corrected read-only collector removes the expensive `smaps_rollup` read that stopped the previous attempt, retaining identity-bound cgroup/RSS/FD/thread evidence and unchanged deadlines. SDK/security, original 30-second ramp, backend 1 CPU/4 GiB/95% guard/nofile 16384 and runner 4 CPUs/16 GiB/85% guard remain unchanged.

**The new attempt stopped on the backend memory guard, not a harness failure.** Its full 10,000/100,000/100,000 baseline was verified twice. The collector delivered 50 complete samples with zero errors; backend anonymous memory grew from ~218 MiB to ~3.47 GiB, with threads increasing from 11 to 342 while file memory stayed nearly flat. Guard-trigger current memory was ~3.87 GiB; the later lifetime peak was only 4 KiB below the 4-GiB limit, with 54 late memory.max events but no OOM/kill/restart. Offered VUs reached 1,500, but only 47 successful-login events and **zero measurement points** were exported. This is not passing capacity or an exact allocation-callsite diagnosis.

Validation passed: 121 units/all 31 native cases/10 diagnostic-analysis checks, two tiny native collector trials and the exact-source/preservation gate before dispatch; 121 units/12 diagnostic-analysis-privacy checks/build/frozen hashes/diff after dispatch. Final sealed-evidence verification passed: 185 public files checked against 100,202 actual passwords, all 18 prior volumes/19 prior archives unchanged, new used fixture/ready+used archives/offline volume retained, no owned resources or claims. No jobs remain. The one-use authorization is spent; no automatic retry.

Report: [`results/server-point-1500-0353-dhXJx6/SUMMARY.md`](results/server-point-1500-0353-dhXJx6/SUMMARY.md). Pipeline: `results/trailbase-0353-1500-G68HFq/`; final proof: `results/server-point-1500-0353-dhXJx6/completion-verification.json`. Prior version-specific results remain immutable.

Maintainer-ready report: [`reports/trailbase-v0.35.3-memory-pressure/REPORT.md`](reports/trailbase-v0.35.3-memory-pressure/REPORT.md). [Download the sanitized sharing packet](reports/trailbase-v0.35.3-memory-pressure.zip): report, 50-sample CSV, numeric evidence, public configuration and schema only. It separates observed anonymous-memory/worker growth from the unproven password-verification allocation hypothesis; no credentials, private logs or database rows are included.

## Completed prior diagnostic1,500-user point

**The single approved1,500-user diagnostic point stopped on a diagnostic-collector deadline**, root`results/server-point-1500-diagnostic-MVHW3P/`, freshbaseline`results/baseline-gfg77B/`. Read the latest`PROGRESS.md` first;`results/followup-1500-0yh7Lb/HANDOFF.md` preserves the earlier restart contract. Original30sramp, backend1CPU/4GiB/95%/nofile16384 andrunner4CPU/16GiB/85%, allotherguards/security unchanged. **Its one-use authorization is spent; no redispatch or automatic retry.** Full baseline verified twice in~35minutes, then the observer's process`smaps_rollup`read failed under its2sdeadline; dispatcherSIGTERM/controller143. Later`runner_abnormal_exit`is secondary. No valid capacity/SLO result. Lastcomplete samples show risingprocessanonymousRSS andTokio-worker concurrency with essentiallyflatfilecache; finalbackendpeak2.33GiB/max/OOM/restart0. This supports anauth-concurrency mechanism, notanexactallocationcallsite orproof the1500runwould hit95%. Independentoutcome/preservation/privacy audit passed; all17historicalvolumes/17archives/prior evidence unchanged,90202actualpasswords checked, usedfixture/ready+usedarchives/newvolume retained. Finalsealed-evidenceverification passed:90202passwords/229publicfiles, frozenraws/source/bundle/privacy/preservation andnoownedresources/claims. Nojobsremain. See`results/server-point-1500-diagnostic-MVHW3P/SUMMARY.md` and`completion-verification.json`.

Before dispatch, fresh120units/all31nativecases passed with no skips/failures;7diagnostic unit checks andtwo tiny native diagnostic trials passed. Read-only timed observation captures cgroupmemory composition/pressure, realTrailBaseRSS/smaps, FDcounts andthreadCPU/state without backendexec ormemorycontents. Native proof maxcombinedcapture17.142ms; existing timedmonitor remains authoritative. Exact-source gate passed, replaying9proofdirs/16trials/13timedsmokes andall17oldvolumes/17archives/prior evidence; pinnedruntimebits/timedbundle unchanged. Pipeline`results/followup-1500-0yh7Lb/`. OriginalfailedDockercollectioncapture remains invalid andpreserved; do not call it anauthfailure. Independentoutcome/preservation/privacyaudit follows actualexit; rawdiagnosticfailure/partialcapture andallprior data remainpreserved.

### Earlier approved follow-up: one fresh1,500-user point

After the2,000-user nofile16k attempt stopped on backend memory safety, the user explicitly authorized **one fresh1,500-user attempt next**. Budgets and guards stay the same: backend1CPU/4GiB/95%, runner4CPU/16GiB/85%, nofile16384. Complete the previous point's preservation proof before changing the narrow16GiB CLI selection, validate the new1500case, then run once on a fresh isolated baseline. No reuse/deletion of failed data, automatic furtherstepdown, budget increase or guard relaxation. See`PROGRESS.md` for the active stage.

## Completed follow-up: Docker file-descriptor correction and stopped2,000-user point

The previous backend log contained33`EMFILE`/“too many open files” warnings. A fresh container using the exact image on this Docker29host inherited soft/hard limits1024/524288 (the previous process limit itself was not captured). **The TrailBase service now explicitly sets `ulimits.nofile` soft=hard=16384.** This is a per-container test configuration correction, not a Docker/host restart or CPU/RAM increase.

A new native regression failed before the fix and passed afterward, verifying rendered Compose CPU/RAM and an actual Docker process's16k limits. Full preservation/native validation **passed:117units/all31nativecases, zero failures/skips**, under`results/nofile-16k-YxoRtn/`;16oldvolume digests/15archives/108prior evidencefiles unchanged. Its final exact-source gate passed after an initial missing-client-provenance refusal (both source/logs retained; client independently matched prior frozenhash). **The single fresh2,000-user attempt stopped on backend memory safety before measurement** in`results/server-point-2000-nofile-qXW9i6/`, freshbaseline`results/baseline-EJS43T/`, keeping backend1CPU/4GiB/95% guard and runner4CPU/16GiB/85% guard, with all other safeguards unchanged. No old fixture adoption/deletion or automatic retry. The preparation observer **verified16384soft/hard on the actual TrailBase process** between identity-bound native captures. The unchanged Node runner supervisor's child measured524288soft/hard. Full preparation is now **twice verified** (10,000accounts/100,000posts/100,000likes/originallogicalhash) in3110.677s (~51.8min), no preparationstop; timedworkload`results/social-ChVfjY/` then stopped at the95%backend current-memory guard (4105138176bytes). Finalcapture recorded7memory.max events, no OOM/kill/restart, lifetimepeak4294959104bytes near4GiB. Zero measurementpoints: invalid performance observation, not passing2,000-user capacity. Actualnofile16k was effective and the shorterstopped backendlog has0EMFILEwarnings, but login/transport failures remained. Independent outcome/preservation audit passed; source/native budgets/effectiveFDs/late7max events/rawpartialmetrics/private logs/all16oldvolumes+15archives reverified,80202archivedpasswords checked against107publicfiles in the initialaudit. Fresh117unit/build/frozenhash checks passed; final completion artifact records the last preservation/privacy proof. Six normaltimedDELETEs are not fixturecleanup; canonicalusedfixture/ready+usedarchives/offlinevolume retained. No automaticretry or furtherlimit relaxation. See`PROGRESS.md` for the managed job and restart instructions.

## Completed experiment: backend 95% guard, negative SLO result

The user requested a fresh2,000-user attempt with **TrailBase's current-memory stop at95% of its unchanged4GiB hardlimit** (about3.8GiB). This is an explicit opt-in, not a new default: runner stays4CPU/16GiB with85% guard; backend stays1CPU/4GiB, no container swap. Health/OOM/memorymax events, CPU, hostreserve/swap, disk, request/capture/coverage deadlines remain fail-closed. Only204.8MiB separates the backend threshold from the hardlimit; rapid allocation can still cause OOM before sampled shutdown. Such a result is invalid, not a backend capacity bound.

The single approved invocation, `node scripts/baseline.js --campaign --vus=2000 --runner-memory=16g --backend-memory-stop=95`, **completed without a safety stop but classified `slo_failure`**. Controller exit0 is not k6 success: **k6 exited99**, workload report `valid:false` / `workloadValid:true`, resources `valid:true`, certified=false. Of **167 measured actions, 165 failed (98.8%)**; all seven action types had observed p95 around10seconds and insufficient samples. Only18 timed login attempts succeeded overall, zero during measurement, out of30,749 login attempts. The executor offered2,000VUs; it did not demonstrate2,000authenticated active users. Existing timed login retries with pacing explain the repeated attempts; no benchmark retry was launched.

Backend sampled/lifetime memory peaks were **3,636,240,384 / 3,681,148,928bytes** (~3.39/3.43GiB), runner sampledpeak **4,587,962,368bytes** (~4.27GiB). No max/OOM/oom_kill/restart was observed. This run's sampled rows would also not trigger the old85% guard, despite a lifetime peak briefly above85%; changing the threshold alone is not proven to have caused completion. Generator headroom and a unique failure cause remain unverified.

Before dispatch, **117unit tests/build/images/all30native cases** and an independent exact-source gate passed. Afterward, **117fresh unit tests/build/frozen-hash checks** and independent raw-metric/resource/cleanup/preservation audit passed. All15previous volume digests and14oldcredential archives remain unchanged. The existing controller normally cleaned only this attempt's new namespace (10,000accounts, API-confirmed zero publicposts); its private ready archive, raw evidence and offlinevolume remain retained. No old failed fixture was adopted or deleted. Existing profiles without the95flag retain85%.

Outcome and limitations: [`results/server-point-2000-b95-2BCnYI/SUMMARY.md`](results/server-point-2000-b95-2BCnYI/SUMMARY.md); validation/consent: `results/backend-95-IuiKbp/`. **This is an audited exploratory negative SLO observation, not passing capacity, repeated SLO, soak or generator-headroom certification. No further attempt is authorized.** See `PROGRESS.md` and the completion-verification artifact for restart evidence.

## Default benchmark host: Ubuntu server

New benchmark runs use this checkout on the **Ubuntu 24.04 x86-64 server**, not the MacBook/OrbStack environment. The initial server inventory is **8 KVM vCPUs (Xeon Platinum 8268), 33,606,889,472 bytes RAM (~31.3 GiB), cgroup v2**. Docker Engine **29.1.3**, Compose **2.40.3**, Buildx **0.30.1**, and host Node **24.22.1** were already installed; Docker is active and enabled at boot. Initial installation/build/verification evidence lives in ignored `results/server-setup/`. Historical Mac results and artifact references below remain historical; ignored laptop results/private fixtures/volumes are **not** included in a git clone.

For another Ubuntu host, install the distro Docker packages (this server needs no reinstall):

```sh
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-v2 docker-buildx
sudo systemctl enable --now docker
# Also provide Node >=24.11, npm, Git, and curl.
```

Run from the repository root with the **local Unix Docker socket**, no `DOCKER_HOST`/Compose overrides, and no other benchmark active. Existing pinned multi-platform images select native AMD64 here; controllers reject emulated/mismatched images and record the actual host and image platform. No host k6 or new backend dependency is required. The API stays on **127.0.0.1:4000** and admin access stays inside the container. Do not expose these benchmark endpoints publicly or add a network-accessible Docker socket.

**Explicitly approved larger runner:** backend stays **1 CPU / 4 GiB / no swap**; the new opt-in runner is **4 CPUs / 16 GiB / no swap**, for one fresh 2,000-user point after validation. Ordinary sizing/discovery retain their original 2-GiB default and existing explicit 4-GiB profiles remain unchanged. The 16-GiB profile requires **18.6 GiB available before preparation and again before load** (85% of the runner cap + the full 4-GiB backend budget + 1-GiB host reserve). The live reserve remains 1 GiB, zero used host swap is required, and container memory stops remain at 85% (13.6 GiB for this runner, 3.4 GiB for TrailBase). Original host and runner `/proc/meminfo`, telemetry coverage, health and measured CPU guards remain enforced; macOS retains its additional native pressure check. Implementation/validation evidence: `results/runner-16g-FARYGI/`:113units/all28nativecases passed, including normal/SIGTERM16GiB cases. The approved fresh2000-user attempt completed with **`backend_memory_guard`**, not runner-memory safety: backend triggered at3.43GiB and later peaked3.77GiB; runner peaked3.51GiB under its16GiB cap. Full10000/100000/100000 preparation verified twice in43.7min, all150004controllerrequestsHTTP200. **Zero measurement points/no valid performance/SLO/capacity bound**; noOOMkill/backendrestart. Independent audit preserved all14priorvolume digests/archives and the new usedfixture/database, checked60202actualpasswords; rawinvalidrun remains invalid. Summary: **`results/server-point-2000-16g-CtkLQX/SUMMARY.md`**. No automatic retry or backend-budget increase; timed backend memory composition/cause is still unmeasured. The existing server swapfile remains configured; setup cleared its 12-KiB residue by cycling that exact file. If any swap is used later, preflight/live guards refuse rather than silently relaxing policy. Check `free -h` / `swapon --show` before a run; do not disable swap on a shared server without reviewing its other workloads.

Server verification sequence (serial, never in parallel against the same projects):

```sh
npm ci
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
# Separate bounded anonymous SDK calibration; not TrailBase/user capacity:
npm run calibration:run
# One fresh 2,000-user point, not automatic doubling/refinement:
node scripts/baseline.js --campaign --vus=2000 --runner-memory=16g
```

**Initial server verification:** 82 unit tests and all 24 native integration cases passed, including Linux 4-GiB normal/SIGTERM cases (no skips), with raw logs in `results/server-setup/regression-3/`. Two original failed social smokes remain preserved: Docker 29 can kill/remove an in-flight exec when its runner exits normally. The monitor now recognizes only the verified exact-runner shutdown forms and retains failed capture metadata; backend errors, timeouts, OOMs and telemetry gaps still fail closed.

**Initial anonymous SDK calibration:** `results/calibration-Q20Lk4/` used the original **2-CPU / 1-GiB / 32-VU** calibration profile. It delivered 25 and 100 reads/s, but at 400 and 1,600 offered reads/s achieved **266.4 / 348.4 reads/s**, dropping **2,677 / 25,032** measurement iterations. All started reads and resource telemetry were valid; source/hash/resource replay and 354,625 raw JSON lines were audited. This shows a delivery limit in that small same-host calibration setup—not TrailBase capacity or full-workload generator headroom. The separate 2,000-user run uses the explicitly selected 4-CPU/4-GiB runner, without changing the backend budget.

**First server 2,000-user attempt: stopped before measurement.** `results/baseline-xd9JeH/` failed after ~36 minutes of API preparation on the unchanged **10-second request timeout**. The private failed fixture records 10,000 registered IDs / 100,000 posts / 99,690 likes; final API counts and the exact timed-out endpoint/underlying cause are unverified. No verified baseline, timed k6 workload, or 2,000-user performance result was produced. Original invalid evidence, private 0600/0700 fixture, and exact trial volume are retained; containers/network/claims were checked absent. `results/server-setup/performance-failure-audit.json` preserves the cleanup-state/privacy audit, not a benchmark pass. Do not run the example again until the partial fixture is explicitly resolved; no timeout increase or automatic retry is included.

**Approved read/auth diagnosis of that failed seed:** `results/diagnose-seed-O7SVpq/attempt-2/` used an isolated copy with the exact recorded backend image, 1-CPU/4-GiB/no-swap limits and unchanged 10-second SDK requests. All 24 sequential login/read/logout sessions (100 requests) completed; no timeout or application write request occurred. Native reads repeatedly found **one like for logical account 9969 where the failed client fixture records zero**. This supports a committed-but-unacknowledged write and confirms that blind resume/retry is unsafe; it does **not** explain the original delay or exclude a later logout timeout masking the first error. Reads/auth on a restarted copy do not reproduce the original sustained write-seeding conditions. Original database/archived-fixture hashes are unchanged; application posts stayed 100,000 in the copy. Diagnostic evidence/audit is separate from the original invalid benchmark.

Fresh-deployment controllers now retain sanitized `trial-N.controller-requests.jsonl` traces (allowlisted routes/methods, headers versus body stages, timestamps/status/error type; no query values, IDs, credentials or bodies). `failure.json` can link the original transport error's sanitized context. Exact backend logs are captured **before shutdown** into private **`.fixtures/backend-logs/<run>-<trial>/`** (0700/0600); public `trial-N.backend-evidence.json` contains only their hashes plus selected lifecycle/native counters/host observations. Failure to capture still attempts checked shutdown and stops fail-closed. These are controller/preparation/cleanup diagnostics, not an SDK fork, retry, longer deadline, change to timed k6 traffic, or continuous preparation resource certification. The original timeout's underlying cause remains unresolved; that controller-diagnostics revision passed **91 unit tests and all 24 native integration cases**, with zero failures/skips. Raw logs and final source/preservation checks are under **`results/diagnose-seed-O7SVpq/`**, with the checkpoint in PROGRESS.md. No further performance attempt starts without a new scope approval.

**Latest explicitly approved fresh attempt stopped:** `results/baseline-hkLslI/` / `results/social-toXALl/`, dispatch/audit `results/server-point-2000-ZVfE5K/`. Preparation successfully verified **10,000 users / 100,000 posts / 100,000 likes**; all **330,004 traced controller requests returned 200**, zero transport-error rows, maximum observed stage4,491.779ms. Seed/initial verification took3,230.175s. During load startup, backend `docker exec` counter captures exceeded the unchanged2sdeadline (three empty killed-client captures, native CLIexit0 correctly rejected). Guard stopped at16.106s aftermonitorstart, **zero measured/action metric points**. The secondary shutdown-evidence cgroup capture also failed; top-level `PreparationEvidenceError` masks the primary safety stop, which remains independently recorded. This is invalid telemetry, **not a TrailBase SLO/capacity result** or a recurrence of the earlier10sseed timeout. Stop audit checked20,000actual passwords, unchanged original DB/archive, replayed invalid resources and verified host coverage/zero used swap. At that stop, owned containers/networks were absent, while the **used10,000-account active fixture and dead-owner operation claim were deliberately retained**. They were subsequently archived/released only under the explicit collector-diagnosis approval below; never resume, delete failed accounts or invoke generic `fresh-workload` recovery. A scoped collector correction/isolated diagnosis and any new performance attempt require fresh authorization.

**Current collector correction under validation:** `results/diagnose-linux-collector-rUdkwG/`. On an isolated copy, a 200-client auth-only probe reproduced the old empty/killed Docker-exec read at2,011.132ms while host-side collection delivered38native captures/0errors/max26.976ms. Idle host/exec/host cumulative counters were bracket-checked for equivalence. Authentication did **not** pass as a workload:12successful logins/logouts,159HTTP504logins and29client timeouts; no business writes or performance claim. Linux backend collection now reads the same four native cgroup-v2 files from the host with a single2sdeadline, binding the inspected full ID/PID to exact normalized Docker-root membership before/after. Nested/foreign/changed/missing/unreadable membership fails closed; a native local Docker daemon sharing host procfs/cgroupfs is required. No exec fallback, retries or fabricated CLIstatus. macOS and legacy non-backend exec paths remain unchanged. Secondary cleanup/capture errors no longer mask a primary failure; they are recorded separately in `trial-N.cleanup-failure.json` and retain the fail-closed operation claim. The latest used fixture/claim were archived byte-for-byte and the verified dead claim released under explicit approval; originals remain untouched. Final-source validation passed **105 unit tests and all24native integration cases**, zero failures/skips, plus build/images/diff. Final preservation/privacy audit passed: both failed databases and archived fixtures unchanged;20,000actual passwords checked against117public files; no active fixtures/claims/owned containers remain. Raw audit/source checkpoints are in the diagnosis directory and PROGRESS.md. The audit explicitly accounts for setup time before monitoring without rewriting raw samples or relaxing the5sgap guard. No full benchmark retry is included.

**Preparation-memory diagnosis completed:** `results/diagnose-preparation-memory-k5S1cm/DIAGNOSIS.md`, managed profile`proc_ff7f` stopped safely at31min; independent audit`proc_0439`passed. Unchanged85%guard fired during like seeding:3.40GiB chargedtotal,2.90GiB filesystemcache,332MiB reclaimablekernelslab,230MiB actualTrailBaseRSS; max/oom/oom_kill0. File+reclaimableslab94.72%ofchargedtotal, not guaranteed instantly freeable. Retained main.db4KiB/WAL3.21GB makes checkpoint behavior a concrete nexttarget, not a proved root cause of the old unprofiled4GiB peak.15,624core/RSS samples/0collectorerrors;163,054requestsHTTP200 andoneintentionalguardabort (~14ms), no10stimeout. Datasetverification/k6never reached. Partialfailedfixture/volume retained; lastlike may have committed, so no resume/reuse. All3olderDB+archive digests unchanged,40,000actualpasswords checked against30publicfiles, private raw logs/modes verified; owned containers/networks/claims removed. Four diagnostic and105project units passed, benchmark code/images/limits/guards unchanged. No fullperformance retry, forcedcheckpoint/cache drop, counter reset or memory-policy change authorized. The subsequently approved bounded WAL diagnosis is summarized below.

**Approved bulk-preparation validation:** `results/bulk-preparation-xjXY6T/`, native proof `results/diagnose-bulk-VjBS5O/`. User approved official SDK bulk creation **only for untimed fixture preparation**, then **one** fresh2,000-user attempt iff validation passes. Each user/table uses one bounded batch; post/like recipes and exact API row verification, timed single-action SDK traffic, pinned0.35.1, budgets/deadlines/guards remain unchanged. Malformed IDs/counts/duplicates and reordered response mappings fail closed; an unacknowledged batch may have committed, so no automatic retry/resume/fallback. Named social profiles batch10records; one-row custom batches still use the server's single-row path. The stock-server proof independently verified100users/1000posts/1000likes twice with the original sequential algorithm's exact logical hash:1504HTTP200/0errors, checkpoint/reuse sequence2 observed **during seeding**, no SQL/checkpoint/config change. Independent audit preserved8prior original/SDK/synthetic volumes and private archives; new volume/used credentials retained, resources/claim removed.109project units and all24native integration cases then passed on final benchmark source (full raw run829s, zero skips). First regression launcher omitted post-auth teardown; calibration correctly refused existing pilot before starting. That failed evidence remains preserved; only launcher order was corrected and the entire suite rerun. After a provenance-index rebuild mismatch, a second small proof and audit passed on the exact final image; no runtime-bit equivalence with an uninspectable older image was assumed. The independent final gate passed source/resource/budget/privacy/preservation checks (11historical volumes +2diagnostic-copy before-digests). **The one approved fresh2,000-user attempt stopped on `runner_memory_guard`**, `results/server-point-2000-bulk-9Rijq8/SUMMARY.md` / `results/baseline-wyrtw4/` / `results/social-9l38kC/`. Full10000/100000/100000 preparation verified twice with the original hash,150004HTTP200/0transporterrors; total57.25min and sampled peak434MiB cgroup/229MiB actual-serverRSS (overlap, do not add), no preparation guard/max/OOM event. The timed4GiB runner crossed85% at3.46GiB and peaked3.69GiB; no OOM kill, **zero measurement points**, so no valid2,000-user throughput/SLO/capacity result. Original invalid telemetry/2nonnumericCPUstats per container and runner exit105 remain preserved. Independent stopped-outcome audit passed, all13before-volume digests/oldarchives unchanged,50202passwords checked; used10000account fixture/private archives and volume retained, owned resources/claims/jobs removed. No fixture-account cleanup (normal timed unlikeDELETE did occur), retry, resource/guard change, commit or push. Next useful new scope is bounded generator-memory diagnosis, not another fullseed or budget increase. No capacity/headroom certification, version/resource/guard relaxation or automatic performance retry.

**Statement-completion mechanism reproduced:** `results/diagnose-sqlite-completion-TXnaXy/DIAGNOSIS.md`. A standalone pinned SQLite 3.53.2 pair completed in **2.342 seconds**: 1,000 first-row/reset inserts left **1,669 frames, zero backfill and 4-KiB main.db**; stepping through DONE produced a checkpoint/reuse cycle and a larger main file. A subsequent fully completed read backfilled all 1,669 deferred frames without a manual checkpoint; both cases verified exactly 1,000 rows. This is controlled engine-level evidence, **not a tested TrailBase fix or capacity result**. Native 1-CPU/4-GiB/no-swap guards passed; independent audit preserved all four original failed databases, two SDK-case volumes and archives. The failed preflight (private executable incompatible with the image's default non-root user) and its empty volume remain preserved; only a fresh, networkless/capability-dropped scratch container's UID was corrected. Supported SDK bulk creation uses explicit server transactions; its later explicitly approved preparation-only adoption and native validation are recorded above. It changes request/transaction boundaries, not logical data or timed actions. No backend image, seeding protocol, timed workload, SQLite settings, guard or resource budget was changed.

**Bounded WAL diagnosis completed:** `results/diagnose-wal-BH70sJ/DIAGNOSIS.md`. Two independent fresh SDK cases finished in **31.387 seconds**, each with one account and 1,000 acknowledged post creates; only the initial empty-posts GET's `count:true` versus omitted count differed. Both produced exactly **24,456,352 WAL bytes / 5,936 committed frames reported by the index / zero backfilled frames / 4-KiB main.db**, so the count flag alone does not explain the growth. All 2,008 SDK requests returned HTTP 200, no retries/timeouts/guard stops; source and guards unchanged. Pinned source identifies a more concrete lead: single-record inserts read the first `RETURNING` row and reset, while bundled SQLite's WAL callbacks run after a DONE step. This suggested deferred automatic-checkpoint processing; the subsequent standalone controlled comparison and preparation-only bulk validation are recorded above. Independent audit replayed request/WAL/native memory/process/coverage evidence, preserved all four prior databases and archives, and checked 40,002 actual passwords; both new case volumes/credential archives remain retained. Four diagnostic and 105 project unit tests passed. Checked shutdown removed owned resources/claims, no active canonical fixture or jobs remain. No manual checkpoint, SQL/configuration/guard change, full seed, k6 or automatic third case. At that checkpoint a bounded statement-completion reproducer—not a blind full-seed retry—was the recommended next scope; subsequent approvals/results are recorded above.

**Latest corrected-collector attempt:** `results/baseline-cKxHp3/` / planned `results/social-XWeteB/`, dispatch/audit **`results/server-point-2000-hostcg-DHx33Z/`**. Preparation verified10,000/100,000/100,000;330,004controllerrequestsHTTP200/0transporterrors. **k6 never launched**: first native host-cgroup sample found lifetime `memory.events max=64`, peak4GiB, current1,672,601,600bytes, zeroOOM/oom_kill. Initial preparation sample hadmax0, so limit events occurred before timed load; exact time and anon-versus-file-cache cause were not observed. The unchanged `backend_memory_events` guard aborted before runner creation. Collector worked (3nativecaptures/0errors); checked final evidence/shutdown succeeded. Independent stop audit verified allraws/source hashes/30,000actualpasswords/unchanged prior originals. Current used10,000-account fixture remains private, its volume retained; no containers/networks/claims remain. **Not a2,000-user capacity/SLO result and not an OOM kill.** Do not blindly retry, restart to erase lifetime counters, relax the memory guard or reuse the fixture. Preparation-memory diagnosis was subsequently approved as described above; no further performance benchmark is authorized.

No `caffeinate` is needed on Ubuntu. The last command API-seeds **10,000 accounts / 100,000 posts / 100,000 likes**, then runs the unchanged **30s ramp / 60s warm-up / 120s measurement**. It retains raw evidence and its uniquely labeled volume; successful usable runs SDK-delete only their fixture accounts and verify zero public posts. Failed runs retain private state for explicit inspection; do not blindly reset, delete locks, retry, or reuse a volume as fresh. Keep `.fixtures/` private (0700 directory / 0600 files), preserve `results/`, and do not commit either. This is a **new hardware baseline**, not a continuation of the laptop's local eight-attempt ledger or a causal comparison with ARM64. Shared KVM/PI WEB activity and host contention remain possible; short same-host observations are not capacity certification or proof of generator headroom. Other BaaS adapters and overnight soaks are still not implemented.

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

The approved **50- and 100-active-user** sizing pilots and their fresh-deployment path are verified—not capacity discovery. Prior 50-user proof: **`results/baseline-22AxEE/`** and **`results/social-hVkOUc/`**. New 100-user proof: **`results/baseline-jOIn75/`** (deployment/preparation/cleanup) and **`results/social-twawIx/`** (timed workload). All **56 units** and every applicable original/new native suite passed for the new option; see **PROGRESS.md** for exact provenance and limitations.

With both projects stopped and no active fixture/operation/recovery claim:

```sh
npm run build
docker compose build trailbase runner
npm run test:fresh-workload       # normal tiny run, active SIGTERM, non-pilot CLI refusal
# Once all applicable original and new regressions pass:
/usr/bin/caffeinate -i npm run workload:sizing  # 50 users; macOS idle-sleep prevention, no power check
# Separately approved and verified 100-user follow-up:
/usr/bin/caffeinate -i npm run workload:sizing -- --vus=100
```

The full command API-seeds a newly created, exactly labeled volume with **1,000 accounts / 10,000 posts / 10,000 likes**, independently verifies it, then runs the existing SDK/seven-action workload at **50 VUs by default**, or exactly **100 VUs with `--vus=100`**. It preserves normal 1–5-second pauses, 300–900-second sessions and the **30s ramp + 60s warm-up + 120s measurement**. The generated resolved config is retained; `configs/pilot-small.json` and the ordinary workload command remain unchanged. Runner limits are explicitly **4 CPUs / 2 GiB / no swap**, with original startup cgroup and independent lifecycle checks. TrailBase remains **1 CPU / 4 GiB / no swap**. The existing same-cgroup OS supervisor captures final counters; all API traffic remains direct SDK/k6. The bounded mode currently requires local ARM64 runtimes, no VM changes or remote host.

Implementation reuses `scripts/baseline.js --workload` (one fresh deployment instead of the default three preparation-only trials) and the shared existing workload lifecycle. `--workload --smoke` uses the original two-VU accelerated correctness config and cannot be combined with `--vus=100`. The separately approved 100-user option changes only active users; there are no arbitrary target, budget or VU options. The ordinary social CLI still refuses these non-pilot volumes.

The root `results/baseline-<suffix>/` records exact volume/override/preparation/config metadata and links to timed `results/social-<suffix>/` raw evidence. Success requires usable workload/resource evidence, explicit SDK account cleanup/zero public posts, unchanged retained-pilot metadata and checked shutdown. **All volumes remain retained**, and API-cleaned volumes are not fresh baselines for another trial. Failed/interrupted fixtures stay private and are not automatically reset/retried. New locks use **`command: fresh-workload`**, deliberately unsupported by social `recover`: uncatchable death or uncertain cleanup requires manual inspection of the exact recorded owner, runner, monitor, volume and backend. Do not blindly remove claims, adopt the volume with ordinary pilot commands or delete data volumes.

The full pilot completed **1,978 measured actions in 120 seconds (16.48 actions/s)**, zero observed action/auth/HTTP failures, all 50 users finished and no interrupted iterations. Measured public/own/read/create/like/unlike/edit counts: **708/279/294/118/326/116/137**. Descriptive p95s were **7–15 ms**, but **every action had fewer than 1,000 samples**; there were no measurement-phase logins. No per-action/login SLO certification follows. Initial 50 logins had the unchanged 3,600-second TTL; no renewals/refreshes were expected in this short run.

Sampled memory peaks were **230.2 MiB backend / 273.3 MiB runner**, CPU **0.1557 / 0.3556 cores**; no observed OOM/restarts/policy loss/throttling. These samples span multiple phases and can miss bursts; low usage is not headroom proof. Independent raw-count/p95/p99/resource/final-cgroup/source/policy/baseline/privacy-pattern/cleanup audits passed. SDK cleanup proved zero public posts, the fresh volume is retained and pilot metadata unchanged. Native smoke also checked actual credential values; the full 1,000-account fixture was deleted before the post-run audit, so a separate full per-password comparison was not performed.

The separately approved **100-user** follow-up completed **3,974 measured actions / 33.12 actions/s**, **zero observed action/auth/HTTP failures**, all 100 users finished with no interruptions. Public/own/read/create/like/unlike/edit counts: **1,431/558/580/228/666/220/291**. Descriptive p95s remained **7–15 ms**. Public list alone exceeds the 1,000-sample minimum and meets the numerical short-run policy; all other action tails and measurement-login evidence remain insufficient. There were 100 initial warm-up logins, zero measured logins/renewals/refreshes; TTL unchanged at 3,600s.

| Observation | 50 users | 100 users |
|---|---:|---:|
| Measured actions/s | 16.48 | 33.12 |
| Backend sampled peak memory | 230.2 MiB | 231.4 MiB |
| Runner sampled peak memory | 273.3 MiB | 385.8 MiB |

New sampled CPU peaks **0.2390 backend / 0.5449 runner cores**, no observed OOM/restarts/policy loss/throttling. Same images/SDK/dependencies/workload/transport/bundle/budgets; resolved config differs only in VUs. Raw counts/quantiles/resource replay/final source/policy/baseline/hash/cleanup audits passed. A one-off non-API observer kept all **1,000 actual fixture passwords in memory only** and checked them against all public root/timed/compressed outputs and original controller streams before discarding them; that comparison passed. The new run's SDK cleanup proved zero posts and cleared active credentials/resources/claims; fresh volume retained, pilot metadata unchanged.

These are two short sequential observations, not repeated or causal memory/throughput scaling estimates. Neither certifies natural refresh, large identity pools, full generator headroom or user capacity. A further load increase or discovery campaign requires a separately scoped decision. The user explicitly requested publication of the completed 50-user and subsequent 100-user milestones; later work is not automatically published.

### Bounded local discovery/refinement (implemented; first campaign safety-stopped)

The next approved campaign starts at **1,000 users**, doubles through **2,000 / 4,000 / 8,000 maximum**, and permits **eight total performance trials**, including refinement. If the first 1,000-user trial has usable evidence but fails numerical backend SLOs, it falls back to **100 / 200 / 400 / 800** before refining a usable bracket to roughly 10%. No candidate is automatically retried. If every approved load passes, the result is **search ceiling reached**, not a maximum.

This campaign uses the fixed **`social-baseline` dataset: 10,000 accounts / 100,000 posts / 100,000 likes** on a new API-seeded deployment for every candidate. It is a new dataset campaign, not a controlled comparison with the earlier 1,000-account sizing observations. Normal SDK/k6 actions, pacing, sessions, seed, pinned versions and **30s ramp / 60s warm-up / 120s measurement** remain unchanged. Preparation/verification/cleanup may take many minutes per trial; allow several hours for a full eight-trial campaign.

```sh
# Only after all applicable regressions pass, with both projects stopped:
npm run test:campaign                  # tiny two-trial correctness + SIGTERM tests
/usr/bin/caffeinate -i npm run workload:campaign
# Correctness-only controller mode: node scripts/baseline.js --campaign --smoke
```

The existing fresh-deployment controller supplies ownership, exclusive locking, SDK preparation/verification/cleanup, per-trial immutable configs and raw evidence. Runner **4 CPUs/2 GiB/no swap**, backend **1 CPU/4 GiB/no swap**, unchanged local ARM64 topology. Ordinary 50/100 sizing and pilot-volume guards remain separate. No budget/search-limit/dataset/target overrides are accepted by the campaign CLI.

Safety is conservative: stop on memory at **85%** of either container's cap, memory-limit/OOM events, backend health loss or collector errors. The optional campaign guard consumes the existing monitor's original OS observations over local IPC, never API traffic; its overhead is part of this campaign. Startup CPU peaks alone do not trigger a limit. Original measured action timestamps align runner self-cgroup observations; a measured window of at least five seconds averaging **>=3.6 cores** stops escalation as possible generator pressure. Low usage still does not prove headroom. Require **5 GiB available service-filesystem space before each seed**. These safety rules are not backend-capacity thresholds and cannot guarantee prevention of every between-sample burst/OOM.

Completed numerical SLO failures (including native exit 99) remain original failed workload reports but may guide discovery if correctness/resource evidence is usable. Invalid telemetry, missing metrics/quantiles, unavailable/invalid targets, runner limits or uncertain cleanup stop the campaign—not a backend fail bracket or lower-load fallback. Failed/interrupted/private state is retained; no automatic data repair or retry. Normal usable trials receive SDK account cleanup/zero-post verification. All volumes remain retained. `fresh-workload` claims remain unsupported by automatic recovery.

Root **`results/baseline-<suffix>/report.json`** links candidates, classification, logical/native baseline evidence, retained volumes and timed **`results/social-<suffix>/`** originals. `valid` means usable completed campaign evidence, not that every candidate passed. `certified: false` and generator headroom unverified remain explicit. Certification/repetitions/soak, larger/separate-runner confirmation, new budgets/hardware and publication are **not included** in this approval. See **PROGRESS.md** for current verification/execution status.

#### First real campaign: stopped before measurement

**`results/baseline-6a7167/` / `results/social-kWIGFj/`** retain the first approved full-dataset attempt. SDK seed/initial verification took **841.504 seconds**; independent verification confirmed **10,000 accounts / 100,000 posts / 100,000 likes**. The 1,000-VU allocated pool crossed the conservative runner memory guard during arrival ramp: **1,769.1 MiB sampled**, above **85% of its 2-GiB cap**. Final original lifetime peak **1,791.2 MiB**; no observed OOM or restart. The sampled active-VU gauge reached 339, but that is partial ramp progress with a **1,000-VU allocated pool**, not a maximum-user result.

The controller aborted and stopped the campaign as approved: **no measurement traffic, doubling, fallback or refinement**. Preserved raw partial output has 767 actions, 1,252 HTTP requests and 342 initial logins, all warm-up; no exported failure points. Native runner/Docker client/controller exits **105/130/1** remain original, and the run/resource verdict remains **invalid**. This is **not a TrailBase SLO failure or a valid 1,000-user result**. The fallback rule does not apply to generator/safety stops.

Independent checks matched source/config/bundle hashes, original resource replay/final cgroups, actual budgets, guard source/time, raw partial counts, baseline/volume identities and privacy audits against all **10,000 actual passwords**. All **63 units** and applicable native suites passed; a new test's initial whitespace-only assertion failure and its original evidence were preserved before the correction/rerun. See PROGRESS.md for exact provenance and limitations.

The user subsequently explicitly approved exact-volume SDK cleanup/private archival plus **one separately identified fresh 1,000-user sizing trial with a 4-CPU/4-GiB runner**. Cleanup preflighted all identities and SDK-deleted **10,000 accounts**; public posts went from **100,044 to zero**, independently checked again. The original used fixture is privately archived byte-for-byte (0600), the exact volume retained, active fixture/resources/claims absent. Finalizer initially refused shutdown because a one-off assertion compared Docker's abbreviated ID with the verified full ID; diagnosis and exact-owned shutdown did not repeat SDK deletion. Original failure and completion/audit evidence remain under `results/baseline-6a7167/explicit-sdk-cleanup*.json`; the original benchmark remains invalid. All 10,000 actual passwords passed another public-output scan. Ordinary pilot commands must not adopt this retained volume. No further discovery/doubling or publication was approved.

#### Separately approved one-point 1,000-user / 4-GiB sizing (audited short-run success)

```sh
# Only after original + new native regressions pass and exact cleanup is independently verified:
/usr/bin/caffeinate -i npm run workload:sizing -- --vus=1000 --runner-memory=4g
# Correctness-only, not a sizing observation:
node scripts/baseline.js --workload --smoke --runner-memory=4g
```

This exact argument pair selects **one fresh deployment**, not a resumed campaign: same social-baseline **10,000 accounts / 100,000 posts / 100,000 likes**, 1,000 VUs, original seed/actions/pacing/sessions and **30/60/120-second timing**. TrailBase stays **1 CPU/4 GiB/no swap**; only the explicitly selected runner profile is **4 CPUs/4 GiB/no swap**, independently enforced by Docker, startup cgroups and first/final lifecycle evidence. No arbitrary budget/VU combination is accepted. Ordinary 50/100 sizing and discovery keep their **4-CPU/2-GiB** default. Current 4-GiB host guards are macOS-only; no VM resizing/topology change, power-source check, automatic retry/fallback or commit/push.

Two 4-GiB caps plus the OS exceed this VM's physical memory; caps are not reservations. Start only with normal macOS pressure, **zero VM swap use** and **at least 4.4 GiB VM MemAvailable** (85% of runner cap plus 1 GiB reserve), rechecked after API preparation. During the timed run, retain original `/proc/meminfo` alongside runner self-cgroups and original macOS memory-pressure command outputs: stop on **less than 1 GiB VM available**, any VM swap use, non-normal macOS pressure, missing/bad/gapped telemetry, existing 85%-of-container-cap guards, OOM/health loss or measured sustained runner CPU pressure. No safety gate changes VM or swap settings. Initial cleanup review saw **7.22 GiB VM available**, no used VM swap and normal macOS pressure; this is only a snapshot, not future headroom proof. Checks cannot guarantee prevention of between-sample bursts or host pressure.

Successful sizing still requires original workload/resource checks, exact SDK cleanup/zero posts and retained-volume shutdown. Failure retains private state and original invalid evidence; no automatic fresh trial follows. A short result does not establish capacity, natural refresh, sustained generator adequacy or a causal comparison with the aborted attempt. **69 units and all applicable original/new native suites passed for this implementation**, including normal/interrupted 4-GiB host-guarded correctness smoke. An initial operator test-order error (pilot left running before calibration) and complete failed logs were preserved; corrected sequencing passed without source/assertion changes.

The real trial **completed and independently audited**, **`results/baseline-QwtjRC/` / `results/social-mmERtr/`**: all1,000users finished, no interruptions; **40,001 measured actions /333.34actions/s**, zero observed action/auth/HTTP failures. All seven action counts exceeded1,000 and met numerical short-run latency/error policies; p95s **3–7ms**, p99s **5–26.73ms**. There were1,000initial warm-up logins but **zero measured logins**, so overall evidence remains insufficient for full SLO certification. TTL3600/no refresh; no repetitions/soak or sustained-headroom proof.

SDK preparation/initial verification **833.347s**, independently reverified10,000/100,000/100,000 baseline and logical hash matching the earlier2GiB experiment. Independent original1,067,530metricpoint/count/quantile replay and1,819resource-row/189host-sample checks passed; minimum sampled VM available4.20GiB, normal host pressure and no used VM swap. Backend sampled peak **0.8884cores/472.6MiB**, runner **2.9026cores/2.995GiB**; no observed OOM/restart/guardstop. CFS throttling occurred (0.775s backend/0.004s runner total), so not a zero-throttling claim. No measured sustained3.6-core runner window, but headroom remains unverified. SDK end counts103,268posts/108,080likes reconciled; cleanup independently checkedzero public posts. All10,000actual passwords passed output scans. Private active fixture/claims/owned resources gone, volume retained, original source snapshot preserved. See PROGRESS.md for full provenance and limits.

#### Larger-load continuation stopped: invalid 2,000-user telemetry

The user requested continuing larger runs after successful1,000. Retain **2,000 ->4,000 ->8,000 ceiling**, roughly10% backend-bracket refinement and **eight 4-GiB performance trials maximum including the completed1,000**. No budget/VM increase, automatic retry, certification/soak or publication. A generator/unsafe/invalid/uncertain-cleanup stop ends the search, **not a backend fail bracket**; all-pass through8,000 means ceiling reached, not maximum found.

```sh
# One candidate only, after all gates and the previous candidate's audit/cleanup:
/usr/bin/caffeinate -i npm run workload:campaign -- --vus=2000 --runner-memory=4g
# Tiny normal/interrupted 4-GiB campaign correctness cases are included in:
npm run test:campaign
```

The explicit 4-GiB discovery form accepts **one integer `--vus=N` from1,000..8,000** and **runs just that candidate**; ordinary2GiB discovery and exact1,0004GiB sizing remain unchanged. A durable audited ledger (`results/discovery4g-oj2SY7/state.json` for this local campaign) carries the prior1,000pass, global eight-trial count, distinct candidates, audit hashes and `nextCampaignTrial` selections between invocations. Original usable exit99/numerical backend SLO failures may guide refinement and receive SDK cleanup; generator/invalid/safety stops preserve private state and forbid further trials. Every point uses a newly API-seeded10,000-account baseline with unchanged workload/timing and all4-GiB host/VM/container/CPU guards above. **70 units and all applicable original/new native groups passed**, including four campaign cases (original plus4GiB normal/SIGTERM), with complete raw regression evidence retained. Only the controller plan changed from audited1,000; all other runtime/config/compiled SDK hotpath hashes and both images matched. The **2,000-user candidate stopped before measurement**, proof **`results/baseline-p5D7mB/` / `results/social-HNy5Ut/`** (globaltrial2of8). Fresh10,000/100,000/100,000 API baseline verified, matching the1,000-user logical graph; seed/initial verification822.397s. During the first few seconds of ramp the backend cgroup collector captured **empty stdout** on its normal Docker-exec return path. The guard correctly stopped on **`invalid_telemetry`**; another final backend capture was empty. At the original stop, why output disappeared was unresolved—successful exec stderr/explicit command metadata were not retained. No source fix, replay, budget increase or retry was attempted then. The later focused diagnosis below reproduced the timeout/false-success mechanism; it does not retroactively validate this failed benchmark.

**This was not the predicted runner-memory guard, a measured generator ceiling, or a valid backend SLO failure.** Runner lifetime peak was about2.48GiB, below the3.4GiB guard; backend Docker memory displays rose to2.321GiB, but missing final native cgroups prevent complete backend memory/OOM attribution. Lifecycle samples remained healthy/OOMKilledfalse, which does not prove absent cgroup OOM events. Native runner/Dockerclient/controller exits105/130/1 and invalid resource/benchmark verdicts remain original.

Only partial warm-up exported:20logins,26requested/20completed actions,6prerequisites,46HTTPrequests, no exported failure points, **zero measurement points**. Peakactive gauge201/configuredpool2,000 is **not a201-user limit**; interrupted/in-flight work may be omitted. An independent stopped-evidence/resource/hash/identity/host/volume audit and all10,000actual-password scans passed; post-stop70units passed. An audit-only mistaken requirement for normal-completion pilot-after metadata was corrected after inspecting the aborted path, with failed audit evidence preserved and actual retained-pilot metadata independently checked. The benchmark remains invalid.

**Search stopped: 1,000 short-run pass, 2,000 invalid, backend upper limit unknown.** No4,000/refinement/retry follows. At the original stop, the used10,000-account private fixture and volume were preserved with no post-run counts. **Subsequently approved SDK cleanup passed**:10,000identities preflighted/deleted, independent public posts100,002→0, original used fixture privately archived byte-for-byte0600/0700, exact volume **`baas-bench-2-pilot_baseline-p5D7mB-1`** retained. Original benchmark remains invalid. A600-capture isolated idle/CPU-only investigation did not reproduce the empty output. The subsequently approved **200-account auth-only reproduction did**, proof **`results/baseline-nDyLPR/` / `results/social-P3Wo4U/`**: partial/empty native cgroup output at the unchanged2s command deadline while Docker-client exit was reported0. Plain `promisify(execFile)` can resolve after its timed-out child handles SIGTERM and exits0, despite `child.killed=true`; a real child-process regression independently reproduced this, and original2,000-user capture timing also matches the2s deadline. Shared async command handling now rejects such killed commands while retaining partial streams/status; backend cgroup reads stay in one shell using builtins rather than scheduling four additional `cat` processes in the CPU-throttled backend. No retries, deadline/guard/resource changes or SDK traffic bridge. **77units/build/diff passed**; the full native run passed baseline/SDK/social/auth/calibration/fresh-workload groups but campaign smoke correctly failed on a separate **41.9s host-observer telemetry gap**, with zero collector command errors. That exact4-account fixture was subsequently SDK-cleaned under explicit approval (public posts57→0), with private archive/volume/failed evidence retained. The unchanged complete native rerun then **passed77units/build/images/all native groups**, including2GiB/4GiB normal/SIGTERM fresh-workload and campaign cases; source hashes/cleanup/archive modes were independently verified. No coverage rule was relaxed. Auth-load verification of the corrected collector has **not** been performed; no further reproduction/full2,000-user run follows automatically. Initial diagnostic cleanup stopped before deletion on macOS pressure2; after a fresh normalpressure1 check, all200identities were SDK-deleted, public posts0→0, exact used fixture privately archived0600/0700 and diagnostic volume retained. Original failed report/evidence remain unchanged. The user requires reproduced cause/verified correction before any full2,000-user rerun. Later requested Docker cleanup removed only35obsolete successful/API-cleaned smoke volumes and3unreferenced old images; important/published/performance/failed/recovery volumes, current images and privatearchives remain protected. No blanket prune. See PROGRESS.md for exact evidence, private hash, recovery boundaries and search ledger.

#### Corrected-collector 2,000-user retries: repeated host-memory safety stops

Two explicitly approved fresh retries consumed global performance attempts **3 and 4 of 8**. Both verified new **10,000-account / 100,000-post / 100,000-like** API baselines with the same logical graph and unchanged SDK, workload, resource limits and guards:

| Attempt | Root / timed evidence | Stop |
|---|---|---|
| 3 | `baseline-pJ4TZ9` / `social-NTwPbd` | macOS pressure `2`, **3.687s** after monitoring began |
| 4 | `baseline-hOJx16` / `social-BMFFtE` | macOS pressure `2`, **3.652s** after monitoring began |

Both passed normal-pressure preflight, then stopped during runner startup with **zero measurement points**. Each retained six complete backend cgroup captures, no collector errors/empty backend frames and zero native container OOM deltas. Neither container's 85% memory guard triggered. The later attempt's native lifetime peaks were approximately **1.07 GiB backend / 2.12 GiB runner**, including preparation/startup; these are not full-load memory requirements or measurement-only peaks. Startup CPU peaks are not sustained measured generator-pressure evidence. VM samples showed no used swap, but the cause of overall macOS pressure was not isolated.

**No valid 2,000-user throughput/latency result or backend upper limit follows.** The corrected collector's authenticated-load behavior remains unverified because both runs stopped early. Original invalid evidence/audits/source snapshots remain retained. Attempt3's used fixture was privately archived byte-for-byte to allow the explicitly requested fresh retry, with **zero accounts deleted** and its volume untouched. Attempt4's used10,000-account fixture remains private/active; both failed volumes/cohorts are preserved, no post-run API counts or SDK cleanup claimed. Expanded actual-password scans and ownership/private-hash checks passed. Four of eight performance attempts are now used; no automatic retry, larger run, failed-performance cleanup, resource/guard change or publication is authorized. See `PROGRESS.md` for exact hashes, artifacts and current recovery boundaries.

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

Repeated fresh-deployment preparation has been verified at both smoke and 1,000-account scale (see [PROGRESS.md](PROGRESS.md)). Separate long-lived native authentication is also verified. The read-only calibration, VU comparison and approved larger-budget comparison above are complete. More resources improved delivery, but full authenticated-workload generator sizing and near-boundary confirmation still precede capacity discovery, repeated performance certification and soak tests. A high anonymous read rate does not establish large authenticated VU pools' memory or seven-action costs; do not apply the calibration-only budget change to the real controller automatically. The approved bounded fresh-deployment sizing path and 50/100-user pilots above are verified. A subsequent approval covers the bounded 1,000-first `social-baseline` discovery/refinement campaign described above; its current gate/execution state is recorded in PROGRESS.md. Near-boundary generator confirmation must precede certification, not be inferred from short discovery. The ordinary workload controller remains restricted to its original pilot volume. Catchable interruption and SIGKILL recovery have dedicated tests; host/daemon power-loss and exhaustive failure injection are not claimed. Remote-host automation and other BaaS adapters remain deferred.
