# Convex authenticated API benchmark

This self-hosted profile runs the official Convex SQLite backend and native Convex Auth in one **1 CPU / 4 GiB / no swap** ARM64 container. Dashboard/frontend, subscriptions and file storage are excluded. It measures official `ConvexHttpClient` HTTP queries/mutations, not realtime WebSocket subscription capacity or Convex Cloud.

The `1cpu4g-bounded-v8-v1` profile caps the native worker pool at16, concurrent queries/mutations at4 each, V8 actions at2 and Node actions at1. These are supported upstream configuration knobs, verified in the running container and recorded in `versions.json`. They bound execution parallelism for the one-CPU/four-GiB budget; request deadlines, native auth, persistence, workload and the85% memory guard are unchanged. The earlier16-query/16-mutation/unbounded-default-worker attempt hit the memory guard at1,000 users and is retained as an interrupted safety stop, not a capacity result. New discovery starts at100 users with the full15,000-account dataset, then doubles while valid and passing.

The official `latest` image was resolved on 2026-11-14 and pinned to its native ARM64 digest in `versions.json` and Compose. The image reports `local_backend unknown`; its immutable digest and OCI source revision identify the actual server. Official SDK 1.50.0 and Convex Auth 2.0.0 are pinned. The app uses the documented native username/password components, unchanged Argon2id password handling/rate limiting, native session minting/rotation/revocation, and a configured 3,600-second access TTL matching the existing comparison. No external authentication service or runner-generated user JWT is used.

Application code is deployed only through the official Convex CLI with an admin key kept under private `.fixtures/archive/`. The admin key is never passed to the VUs. All account/data creation, verification, measured activity and cleanup use the official SDK with ordinary user credentials. Internal app functions use normal Convex database APIs inside server-side transactions.

The seven actions share the existing mixed-social implementation. Server-side validators and live native session checks enforce immutable post ownership, private own likes, valid references and unique `(user,post)` likes. Feed indexes use descending `(created_at,sort_id)`, where `sort_id` is the native record ID; an author-specific index implements own feeds. Offset walks use an indexed bounded `take(offset+limit)` and server-side slicing because Convex does not offer native offset pagination. This work remains in the measured request; responses contain only the requested page. Offsets above 10,000 fail explicitly. Per-user post counters support untimed baseline/end counts without scanning all post bodies; post writes maintain the counters transactionally. No like aggregation is materialized.

Optimized fixture session reuse keeps tokens in RAM and checks restored identity through the native authenticated API. Native refresh and sign-out mutations authenticate with their refresh-token argument, so the adapter clears the SDK access-token header before these calls; an expired access JWT must not block the public native session function. Protected queries/mutations use the new access token. A separate native test issues a three-second token, waits until the server rejects it, then verifies refresh, identity, protected access and logout revocation. The test-only TTL is never used in a capacity point. Setup sessions are natively revoked before fresh VU password logins, paced at five/second. Final native sign-outs use the same five/second cleanup policy as Supabase, outside the application window. The accelerated correctness smoke waits 60 untimed seconds after native runner cleanup before post-run password verification, allowing the unchanged native one-verification/minute bucket to refill after its 3–5-second session churn. Full capacity points use the normal 300–900-second session policy and add no cooldown. Request, host/memory/OOM/health and measured generator CPU safeguards remain in force; untimed fixture setup has no elapsed-time cap.

Own-account cleanup is a bounded authenticated mutation with no user-ID argument. It cascades application rows, removes the native username mapping and revokes all native sessions for that user. Convex Auth 2.0.0 exposes no password-component deletion API: inaccessible orphan password hashes remain in the retained owned volume. This is disclosed rather than bypassing component isolation or directly manipulating the database. Deleted handles cannot authenticate and post cleanup is checked via the API.

```sh
npm ci
npm test
npm run build
docker compose -f compose.convex.yaml build runner
npm run test:convex
# Only after native correctness succeeds and no other benchmark is active:
npm run convex:campaign -- --start-vus=100
```

Each capacity point uses a fresh owned deployment and the full fixed 15,000-account/150,000-post/150,000-like recipe. The campaign starts with a tiny correctness smoke, tries 1,000, 2,000, 4,000, 8,000 and 15,000 while passing, refines valid failures and repeats endpoints. Invalid evidence or generator limitation stops discovery. A passing 15,000 is a dataset ceiling, not an actual maximum. Writing `stop-after-current.json` in the active campaign directory prevents another trial after the active point finishes.

Original failed evidence, private fixture credentials and named volumes are retained. A smaller explicit validation dataset is marked ineligible for the capacity comparison. Native integration success, cleanup/cancellation, full-size data preparation and capacity results must be established from actual reports; source implementation alone is not readiness evidence.

Primary references: [self-hosted configuration](https://github.com/get-convex/convex-backend/tree/main/self-hosted), [official SDK HTTP client](https://docs.convex.dev/api/classes/browser.ConvexHttpClient), [native username/password auth](https://docs.convex.dev/auth/convex-auth/methods/username-password), [native auth session API](https://docs.convex.dev/convex-auth-api/server/).
