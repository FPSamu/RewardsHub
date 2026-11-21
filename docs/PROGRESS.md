# Progress — docs/PLAN-pending-architecture.md

Order for this session: P0.4 → P0.5 → P0.6 → P0.1 → P0.2 → P0.3, then **stop**.
Later sessions: P1.1–P1.7, P2.1–P2.3, P3.1–P3.4, P4.1–P4.5, P6.1–P6.3, P5.1–P5.3.

If the session restarts: read this file and continue from the first task not marked ✅.

## Environment notes
- Node 22 (v22.23.5) via nvm in WSL; every node/npm/npx command is prefixed with `. ~/.nvm/nvm.sh && ` (CLAUDE.md). `node_modules` reinstalled with Linux `npm ci`.
- **Deviation:** Ubuntu 22.04 has no OpenSSL 1.1, and `mongodb-memory-server` 8.16 defaults to mongod 5.0.19 (`libcrypto.so.1.1` missing → every in-memory suite failed). Pinned mongod **6.0.14** in `package.json` → `config.mongodbMemoryServer.version`. 6.0 also supports transactions on `MongoMemoryReplSet` (P1.1).
- No `.env` in this checkout (fine: tests use `mongodb-memory-server`).

## Plan deviations / decisions
- Plan updated (2026-11-20): added P0.4–P0.6; P1.3 (membership unique index + read-only duplicates script, `resolveBranchId` before the points write), P1.5 (`stripeSubscriptionId` index), P2.3 (UTC days, `TZ=UTC`, `revenueWithPoints` + `revenueAllAdds`, `newClients`).
- Plan said Claude may run `terraform plan`; CLAUDE.md forbids it → plan text aligned with CLAUDE.md.

## Baseline (before any change)
Not captured before P0.4 (`node_modules` was a broken Windows install at the time). First full run after P0.4 + the mongod pin: typecheck ✅; suites `auth.refreshGrace`, `business.nearby`, `queue.processor` ✅; `auth.user`, `auth.business` ❌ "Test suite failed to run — Neither apiKey nor config.authenticator provided" (no `stripe` mock, and they need `TEST_MONGO_URI`) → fixed in P0.5.

## Tasks

### P0.4 — ✅ done
Files changed:
- `src/services/business.service.ts`: `InternalBusiness` type + `toPublicResponse()` (drops `passHash`, `branchPassHash`); `getAllBusinesses` (no coordinates) uses it.
- `src/controllers/business.controller.ts`: `addLocation`, `updateLocation`, `removeLocation` answer with `toPublicResponse(...)`. `getBusinessesByCategory` is covered through `getAllBusinesses`. `updateBusiness` / `uploadLogo` unchanged.
- `src/controllers/adminPin.controller.ts`: `generatePin` → 403 when `ADMIN_SECRET` is unset or doesn't match.
- `src/routes/auth.routes.ts` + `src/controllers/auth.controller.ts`: `GET /auth/:id` requires `authenticate`; `canViewUser` (same user, or business with a `UserPoints.businessPoints` entry or a transaction) else 404; invalid ObjectId → 404 (was 500). Response shape unchanged.
- `tests/security.publicDto.test.ts` (new): secret-key scan on `/business/all`, POST/PUT/DELETE `/business/locations`, `getBusinessesByCategory`, `PUT /business/me` shape; admin-pin 403/403/200; `/auth/:id` 401 / self 200 / other user 404 / business with points 200 / with transaction 200 / unrelated 404 / invalid id 404.
- `package.json`: `config.mongodbMemoryServer.version = "6.0.14"` (see Environment notes).
Test results: `npm run typecheck` ✅. `npm test`: `security.publicDto` 16/16 ✅ (one fix: serialize the body in the direct-handler test); `auth.refreshGrace`, `business.nearby`, `queue.processor` ✅; `auth.user` / `auth.business` ❌ pre-existing → P0.5.
[MANUAL]: none.
Note for front/mobile: `/auth/:id` now needs the Bearer token (the web front already sends it); `POST /business/admin-pin/generate` needs `ADMIN_SECRET` set on Render if support uses it.

### P0.5 — ✅ done
Files changed:
- `tests/auth.user.test.ts`, `tests/auth.business.test.ts`: rewritten on `MongoMemoryServer` (no `TEST_MONGO_URI`), mocking `stripe`, `../src/services/firebase.service` and `email.service`, against the real API: `/auth/register` (`idToken` + `role`), unified `/auth/login`, `/auth/me`, `/business/me`, `/auth/refresh`, `/auth/logout`, cross-role isolation.
- `tests/helpers/fakeFirebase.ts` (new): fake `firebase.service`; `idToken` = `fake:<uid>:<email>`.
**Deviation:** the old suites tested routes that no longer exist (`/business/register`, `/business/login`, `/business/refresh`, `/business/logout`, email/password `/auth/register`), and refresh/logout are unified under `/auth`. Those cases were dropped or moved to `/auth`; "business refresh token rejected on `/auth/refresh`" no longer applies and was replaced by "refresh keeps role: business". No suite moved to `tests/legacy/`.
- `tests/helpers/db.ts` is now unused; left in place (delete it if nothing else needs it).
Test results: `npm run typecheck` ✅; `npm test` ✅ 6/6 suites, 68/68 tests.
[MANUAL]: none.

### P0.6 — ✅ done
Files changed:
- `src/middleware/error.middleware.ts` (new): `notFoundHandler` → `404 { message: 'not found' }`; `errorHandler` keeps `err.status` / `err.statusCode` when 400–599 (e.g. 400 invalid JSON) and answers `{ message: err.message }`; anything else → `500 { message: 'internal server error' }` (internal message only logged). Delegates to Express if headers were already sent.
- `src/app.ts`: mounts both after the last router.
- `tests/app.errors.test.ts` (new): 404 JSON, `/health` unchanged, invalid JSON → 400 JSON, `next(err)` from `/delivery/claim` → 500 JSON without internals, CORS rejection in production → 500 JSON, handler unit cases.
Behaviour change (status codes unchanged, body becomes JSON instead of Express HTML): unknown routes, invalid JSON bodies, CORS rejections, `next(err)`. Membership handlers without try/catch: an async error there is still an unhandled rejection under Express 4 (not routed to `next`); P1.3 rewrites them.
Test results: `npm run typecheck` ✅; `npm test` ✅ 7/7 suites, 76/76 tests.
[MANUAL]: none.

### P0.1 — ✅ done
Files changed:
- `infra/aws/variables.tf`: `lab_db_name` (default `"rewardshub_lab"`, `""` = DB from `MONGO_URI`; validation requires a name ending in `_lab|_test|test`, the same rule as `assertNonProductionDb`).
- `infra/aws/compute.tf`: `local.common_user_data.db_name`.
- `infra/aws/user_data.sh.tftpl`: `DB_NAME=${db_name}` in `/etc/rewardshub.env` (omitted when empty).
- `infra/aws/terraform.tfvars.example`, `infra/aws/README.md` ("Qué cambió en el código", "Requisitos").
- `src/db/mongoose.ts` already passes `dbName` → no code change. `*_COLLECTION` overrides are collection names → unaffected.
Test results: `npm run typecheck` ✅; `npm test` ✅ 7/7, 76/76; `terraform fmt` ✅ (no changes); `terraform init -backend=false && terraform validate` ✅.
Note: `terraform init` created `infra/aws/.terraform.lock.hcl` (new, not ignored — usually committed) and `.terraform/` (ignored).
[MANUAL] (after P0.3, when you next start the lab): `cd infra/aws && ./lab.sh up && ./lab.sh roll`, then check `./lab.sh logs api` shows `Connected to MongoDB` and Atlas → Collections shows writes only in `rewardshub_lab`.

### P0.2 — ✅ done
Files changed:
- `src/db/mongoose.ts`: `buildConnectOptions(env)` (exported) → `{ dbName: DB_NAME, maxPoolSize: MONGO_MAX_POOL_SIZE }`; `maxPoolSize` only when it's a positive integer, so the driver default is unchanged when unset.
- `infra/aws/variables.tf`: `mongo_max_pool_size` (default 20). **Deviation:** the plan hard-codes 20; a variable makes it adjustable without editing the template.
- `infra/aws/compute.tf`, `infra/aws/user_data.sh.tftpl` (`MONGO_MAX_POOL_SIZE=…`), `terraform.tfvars.example`, `README.md`.
- `tests/db.connectOptions.test.ts` (new).
Test results: `npm run typecheck` ✅; `npm test` ✅ 8/8, 83/83; `terraform fmt` ✅; `terraform validate` ✅.
[MANUAL]: same `./lab.sh up && ./lab.sh roll` as P0.1 (one roll covers both).

### P0.3 — ✅ done
Files changed:
- `src/db/safety.ts` (new): `assertNonProductionDb(dbName = active connection's DB)` + `ProductionDbError`. Allows names matching `/(_lab|_test|test)$/`, or anything with `ALLOW_DB_WRITES=I_KNOW` (logs a warning). Throws when there's no connection.
  **Deviation:** a bare `test` only passes when `DB_NAME=test` is set explicitly. `test` is what the driver picks when `MONGO_URI` has no DB path, so it could be production.
- `src/db/seed/labDataset.ts` (new): pure, seeded generator. Defaults: 50 businesses with 1–3 branches around Guadalajara/CDMX (~101 branches); 1 points system + 1–2 stamps systems each; rewards; 2,000 users with 1–4 favourite businesses; 50,000 transactions over 90 days (≈42k add / 6.6k redeem / 1.1k subtract), including small purchases that earn 0 points so the two revenue rules differ. Balances are derived from the generated ledger in chronological order: never negative, `userpoints` == Σ ledger. Builds in ~0.7 s.
- `src/db/seed/writeLabDataset.ts` (new): calls `assertNonProductionDb()`; `--reset` empties the 6 seeded collections; without reset it refuses if seed data exists (idempotent); creates indexes, then bulk inserts in batches of 5000 (keeps historical `createdAt`).
- `scripts/seed-lab.ts` (new) + `package.json` `"seed:lab"`: options `--reset --businesses --users --transactions --days --seed`; checks the DB before generating anything. All seed accounts use password `lab12345` (`@seed.rewardshub.test`).
- **Deviation:** the generator and writer live in `src/db/seed/` (inside tsconfig `include`, so `npm run typecheck` covers them); `scripts/seed-lab.ts` is only the CLI.
- `tests/db.safety.test.ts`, `tests/seed.labDataset.test.ts` (new): name rules, the `test` special case, the override; dataset invariants (ledger == balances, totals == Σ systems, never negative, valid reward ids, date range); writer refuses DB `rewardshub`, no duplicates without reset, reset regenerates. All on the in-memory DB.
- `infra/aws/README.md`: "Datos de prueba en la base del lab".
Test results: `npm run typecheck` ✅; `npm test` ✅ 10/10 suites, 108/108 tests; `terraform fmt -check` ✅; `terraform validate` ✅. The seed script was **not** run (it writes to MongoDB).
`npm run lint` doesn't work in this repo (pre-existing: no ESLint config file).
[MANUAL] see "Manual steps after P0" below.

## Manual steps after P0 (in order)
1. Start the Learner Lab and refresh `~/.aws/credentials` `[academy]`.
2. `cd infra/aws && terraform plan` (check: launch template user data now has `DB_NAME=rewardshub_lab` and `MONGO_MAX_POOL_SIZE=20`).
3. `./lab.sh up && ./lab.sh roll`
4. `./lab.sh logs api` and `./lab.sh logs worker` → `Connected to MongoDB`.
5. From the repo root: `DB_NAME=rewardshub_lab npm run seed:lab` (`-- --reset` to regenerate).
6. Check the guard: `DB_NAME=rewardshub npm run seed:lab` must print `⛔ La base "rewardshub" no parece de lab/test…` and exit 1 without writing.
7. Atlas → Collections: only `rewardshub_lab` grows.
8. `./lab.sh down` when done.
Render/front follow-ups from P0.4: set `ADMIN_SECRET` on Render if support uses `/business/admin-pin/generate`; `/auth/:id` now needs the Bearer token (the web front already sends it; check the mobile apps).

(P0 finished; P1 continues below.)

### P1.1 — ✅ done
Files changed:
- `src/db/withTransaction.ts` (new): `withTransaction(fn: (session) => Promise<T>)` on `mongoose.connection.transaction()` → driver `session.withTransaction()` (retries only `TransientTransactionError` / `UnknownTransactionCommitResult`; any throw aborts). `supportsTransactions()` asks `hello` once per connection (replica set or mongos).
  **Deviation:** on a standalone mongod (some local setups, the standalone `MongoMemoryServer` suites) `fn` runs once with `session = undefined` and a one-time warning, instead of failing. Per-document atomicity (P1.2's conditional `$inc`) still holds; only cross-document atomicity is lost there. Atlas (Render, lab) is always a replica set → always transactional.
  The "no session" value is `undefined`, not `null`: mongoose's update option types accept only `session?: ClientSession`.
- `tests/helpers/replset.ts` (new): `startReplSet`, `useReplSet(dbName)` (single-node `MongoMemoryReplSet`, wiredTiger), `ensureCollections(...)`. Collections must exist before the first transaction touches them.
- `tests/db.withTransaction.test.ts` (new, replica set): commit, rollback on throw, retry on `TransientTransactionError` (only the committed attempt's write remains), no retry on normal errors.
- `tests/db.withTransaction.standalone.test.ts` (new): fallback on a standalone server.
Test results: `npm run typecheck` ✅; `npm test` ✅ 12/12 suites, 114/114 tests.
[MANUAL]: none.

### P1.2 — ✅ done
Files changed:
- `src/services/userPoints.service.ts`:
  - `addPointsAndStamps` / `subtractPointsAndStamps`: same validations, messages and `PublicUserPoints` result; new **optional last param `session?: ClientSession`** (existing callers unchanged).
  - Helpers: `ensureEntries` (upsert of the user doc, ignoring a racing duplicate key; `$push` of the business entry and of each system entry, each guarded by `$ne` so parallel first visits don't duplicate); `buildIncUpdate` (one `updateOne` with `$inc` on `businessPoints.$[bp]` and `…rewardSystems.$[rsN]`, `$set` of `lastVisit` / `lastUpdated`); `mergeDeltas` (a system repeated in one request becomes one `$inc`, otherwise two array filters on the same element would conflict).
  - Subtract: `checkSubtract` re-runs the old checks in the old order on a fresh read (same messages, including a repeated stamp system validated against what's left after the first). Then one conditional `updateOne` whose filter requires `>=` the validated amount per system **and** for the business totals. No match (a concurrent request spent the balance) → re-read, which throws the usual `Insufficient …`. At most 3 attempts, then `Points were updated concurrently, please retry`.
  **Deviation:** if old inconsistent data has a business total below the sum being subtracted, it now throws `UserPoints validation failed: business total would become negative` (before: mongoose's own `min: 0` ValidationError from `save()`). Either way it's a 400 with nothing written.
- `tests/atomic.userPoints.test.ts` (new, replica set): first visit, repeat visit without duplicate entries, repeated stamp system, every old error message (add and subtract), the legacy-total guard. Concurrency (P1.6, service level): 50 parallel adds for a brand-new user → exact sum, one doc; 20 parallel `subtract 10` on 100 → exactly 10 ok / 10 `Insufficient points…`, final 0; 40 mixed adds and subtracts → balance == applied operations, never negative.
  Checked against the original code (temporary copy, then deleted): the 50-adds and 20-subtracts tests **fail** there (lost updates; 3 of 20 subtracts succeeded), so they do catch the old bug.
Test results: `npm run typecheck` ✅; `npm test` ✅ 13/13 suites, 130/130 tests.
[MANUAL]: none.

### P1.3 — ✅ done
Files changed:
- `src/services/transaction.service.ts`: `createTransaction(..., timezone = 'UTC', session?)` — new optional last param; insert uses `create([doc], { session })` (the array form is the one that accepts a session). Return value unchanged.
- `src/services/workShift.service.ts`: `getActiveWorkShifts(businessId, branchId, session?)`.
- `src/controllers/userPoints.controller.ts` (`addPointsOrStamps`, `subtractPointsOrStamps`): `resolveBranchId` and the transaction items are computed **before any write**; points update + `createTransaction` run inside one `withTransaction`. Response bodies and messages unchanged.
- `src/controllers/delivery.controller.ts` (`claimCode`): today's reads and answers stay as the fast path (404 `Invalid code` / 409 `Code already redeemed` / 400 `Code expired` / 400 `No active reward systems found for this code`, nothing written). Inside the transaction the **first** statement is the conditional claim `findOneAndUpdate({ _id, isRedeemed: false, expiresAt: { $gte: now } })`, then points, business lookup and `createTransaction`. Losing a race → re-read → same 404/400/409. Any later failure rolls the claim back.
- `src/controllers/membership.controller.ts`:
  - `redeemDailyBenefit`: one conditional `findOneAndUpdate` (active, `endDate >= now`, `lastRedeemedDate` null or outside today's UTC day). No match → re-read → 404 / 409 `La membresía ha vencido` (and marks it `expired`, as before) / 409 `{ message, redeemedToday: true }`. `lastRedeemedBusinessName` now stores `business.username` (was always `null`).
  - `activateMembership`: expire + duplicate check + create in one `withTransaction`; duplicate key `11000` → the same 409.
  - Both have try/catch → `next(err)` → JSON 500 (P0.6). Before, an async error left the request with no response.
- `src/models/clientMembership.model.ts`: partial unique index `uniq_active_plan_per_user` `{ userId: 1, planId: 1 }`, `partialFilterExpression: { status: 'active' }`.
- `scripts/find-duplicate-memberships.ts` (new, **read-only**, connects with `autoIndex: false`): lists duplicate active memberships grouped by (user, plan), latest `endDate` first; `--json` option.
- Tests (new): `tests/atomic.endpoints.test.ts` (replica set, 15 tests) and `tests/scripts.findDuplicateMemberships.test.ts`.
  - P1.6 cases covered: 20 parallel `subtract 10` on 100 → 10 × 200 / 10 × 400, balance 0, exactly 10 `subtract` transactions; 50 parallel adds → exact sum, 50 transactions; 2 parallel claims → one 200 + one 409, points once, one transaction; `createTransaction` mocked to throw → balance unchanged (rollback) on add, subtract and claim (the code stays unredeemed).
  - Also: response shapes and messages, invalid branch writes nothing, 5 parallel activations → 1 × 201 + 4 × 409, 5 parallel redeems → 1 × 200 + 4 × 409, yesterday's redeem doesn't block today, 404 and expired cases, unexpected error → JSON 500.
  - Not in this task: Idempotency-Key and Stripe `event.id` cases (P1.4 / P1.5).
**Deviations / notes:**
- Error precedence: a request with **both** an invalid branch and another error (e.g. insufficient points) now gets the branch error, because the branch is resolved before the write (as asked). Single-error responses are unchanged.
- `claimCode` keeps the pre-read before the transaction, so "No active reward systems…" still answers 400 without touching the code. The conditional claim is still the first statement *in* the transaction.
- Activate's expiry is `endDate < now` and redeem's validity is `endDate >= now`, matching the old checks exactly (the plan said `$gt`).
- Under transactions, many simultaneous writes to the **same** user are serialized by write-conflict retries: 50 parallel adds on one user take ~10 s in the test. Normal traffic (different users) isn't affected.
- On a standalone mongod, `withTransaction` falls back to no session (P1.1). There, the claim stays marked if a later step fails (no rollback). Atlas is unaffected.
Test results: `npm run typecheck` ✅; `npm test` ✅ 15/15 suites, 146/146 tests; `npm run build` ✅.
[MANUAL]:
1. Before the next Render deploy of this branch (and in the lab DB): `npx ts-node scripts/find-duplicate-memberships.ts` (read-only). If it lists groups, keep one membership per group (normally the latest `endDate`) and set the others to `status: 'cancelled'` by hand. Otherwise Mongoose can't build `uniq_active_plan_per_user` at startup: the app keeps working, but without the double-activation guard (it logs an index error).
2. Lab: `./lab.sh up && ./lab.sh roll` to deploy (same as P0).

(P1.3 finished; P1.4 continues below.)

### P1.4 — ✅ done
Files changed:
- `src/models/idempotencyKey.model.ts` (new): `{ scope, key, requestHash, status: in_progress|completed, responseStatus, responseBody, createdAt (TTL 24 h), lockedAt }`, unique `{ scope, key }`.
- `src/middleware/idempotency.middleware.ts` (new), `idempotent()`:
  - **No header:** passes through and increments `idempotencyCounters.missing`. With `IDEMPOTENCY_REQUIRED=true` it answers `400`.
  - **Empty or too-long key** (over 255 chars): `400`.
  - **Claim:** inserts `in_progress`.
  - **On a duplicate:**
    - different body hash → `422`;
    - `completed` → replay of the stored status and body + `Idempotent-Replayed: true`;
    - `in_progress` locked less than `IDEMPOTENCY_LOCK_SECONDS` (default 60) ago → `409` + `Retry-After: 1`;
    - older lock → conditional takeover.
  - **Saving the result:** `res.json` is wrapped. Status `< 500` stores `completed` (with the body exactly as serialized) **before** sending; `>= 500` deletes the record. A response without `res.json` (client aborted) frees the key on `close`.
  - **Scope:** `${actorId}:${method}:${baseUrl}${route.path}`.
  - **Hash:** sha256 of canonical JSON (keys sorted recursively).
  - Counters `{ missing, replayed, conflicts, mismatched }` are exported for P6.3.
- Routes, mounted after the auth middleware: `POST /user-points/add`, `/user-points/subtract`, `/delivery/claim`, `/memberships/activate`, `/memberships/redeem`.
- `src/app.ts` CORS: `allowedHeaders` + `Idempotency-Key`; `exposedHeaders` + `Idempotent-Replayed`, `Retry-After`.
- `RewardsHub_API.postman_collection.json`:
  - New folder "Escrituras idempotentes": the 5 endpoints with `Idempotency-Key: {{$guid}}`, Bearer auth and example bodies. Its description is for front/mobile: one UUID per action, reused on retries.
  - New variables `user_id`, `user_token`, `branch_id`, `points_system_id`, `membership_plan_id`, `membership_id`.
  - Additions only: 216 lines added, 0 removed.
- `tests/helpers/world.ts` (new): `seedWorld` / `MODELS`, moved out of `tests/atomic.endpoints.test.ts`, which now imports them.
- `tests/idempotency.test.ts` (new, replica set, 15 tests). P1.6 cases:
  - **5 parallel requests with the same key → 1 transaction**, the rest 409 + `Retry-After` or a replay;
  - **same key, different body → 422**.

  Also covered: no header, required flag, invalid key, sequential replay (identical body + header, no second sum), canonical hash, a 4xx stored and replayed, a 5xx deletes the key so the retry really runs, scope per business, stale lock takeover, recent lock → 409, the memberships endpoint, CORS preflight + exposed headers, unique + TTL indexes.

**Bug found by the tests and fixed:** the stored body had `undefined` fields, which Mongo saves as `null`, so replays had extra `rewardId: null`-style keys. The body is now stored as `JSON.parse(JSON.stringify(body))`, i.e. exactly what went over the wire.

**Deviations / notes:**
- **Extra lock/takeover:** an `in_progress` record whose request died is retaken after 60 s (the plan only had 409).
- **Known limit, documented in the middleware:** if the process dies after the business transaction commits but before `completed` is saved, a retry after 60 s re-executes the operation.
- **Stored 4xx:** 4xx responses are stored and replayed, as the plan says (`status < 500`). So a retry of a request that failed with `Insufficient points` gets the same 400 even if the balance changed since; the client should use a new key for a new attempt.
- **Outdated Postman requests:** the existing requests (`/business/register`, `/business/login`) target routes that no longer exist. Left untouched.
Test results: `npm run typecheck` ✅; `npm test` ✅ 16/16 suites, 161/161 tests.
[MANUAL]: tell the web and both mobile teams: send `Idempotency-Key: <uuid>` on the 5 endpoints, one UUID per scan/redeem action, reused on retries; handle `409` + `Retry-After` by retrying with the same key, and `422` as a client bug.

### P1.5 — ✅ done
Files changed:
- `src/models/stripeEvent.model.ts` (new): `_id = event.id`, `type`, `status: processing|processed`, `receivedAt` (TTL 30 days), `processedAt`.
- `src/controllers/webhook.controller.ts`: after the signature check (the 400 text response is unchanged), `claimStripeEvent`:
  - insert `processing`;
  - duplicate + `processed` → `200 { received: true, duplicate: true }`;
  - duplicate + `processing` less than 5 min old → `409 { error: 'Event is being processed' }` (Stripe retries);
  - older → conditional takeover.

  Then:
  - **Success:** marks `processed`, then the usual `200 { received: true }`.
  - **Failure:** deletes the record, then the usual `500 { error: 'Webhook processing failed' }`.
  - **Claim failure** (DB down): also that 500, instead of an unhandled rejection.
- Ordering:
  - `src/models/subscription.model.ts`: new optional field `lastStripeEventAt` (additive) + sparse index on `stripeSubscriptionId`.
  - `src/services/subscription.service.ts`: `updateSubscriptionStatus(..., eventCreatedAt?, { ignoreOlder = true })`, new optional params. With `eventCreatedAt` it records it with `$max` (never goes backwards). With `ignoreOlder` it only applies when `lastStripeEventAt` is unset or `<= eventCreatedAt`. Without them it behaves exactly as before.
  - `customer.subscription.updated` passes `event.created`; an older event is ignored and logged, still 200.
  - `customer.subscription.deleted` always applies (`ignoreOlder: false`) and records the date, so a late older `updated` can't revive a deleted subscription. The business still goes `inactive`.
- **Pre-existing bug fixed:** `subscription.model.ts` declared `businessId` / `stripeCustomerId` both `unique: true` **and** again with a plain `index()`. Mongoose's index build failed on that name clash (`An existing index has the same name…`) and stopped, so later indexes, including the new `stripeSubscriptionId` one, would never have been built. Removed the two redundant declarations; the unique indexes cover them. Nothing is dropped from existing databases.
Test results: see P1.6.
[MANUAL] (Stripe can't reach the lab ALB):
- Against local (`stripe listen --forward-to localhost:3000/webhooks/stripe`) or Render: `stripe trigger customer.subscription.updated`.
- Then use `stripe events resend <evt_id>`. The second delivery must answer `{ "received": true, "duplicate": true }`, and the `stripeevents` collection holds the event as `processed`.

### P1.6 — ✅ done (remaining tests)
Files changed:
- `tests/helpers/stripeEnv.ts` (new): fake `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`, imported before the app so the module-level Stripe clients build; signatures are created and verified locally, no network.
- `tests/webhook.stripe.test.ts` (new, 12 tests):
  - **same `event.id` twice → side effects once** (spy) and `duplicate: true`;
  - 3 parallel deliveries → processed once, the rest 409 or duplicate;
  - a failure frees the id and the redelivery succeeds;
  - recent `processing` → 409, stale → taken over;
  - bad signature → 400 text, nothing stored;
  - TTL index;
  - `stripeSubscriptionId` index;
  - older `updated` ignored;
  - same or newer timestamp applied;
  - older `updated` after `deleted` doesn't revive it;
  - `deleted` applies even if older, and `lastStripeEventAt` doesn't go back;
  - legacy call without `eventCreatedAt` unchanged.
- The idempotency P1.6 cases are in `tests/idempotency.test.ts` (P1.4). The concurrency, rollback and claim cases are in `tests/atomic.*.test.ts` (P1.2 / P1.3).
- Every P1.6 bullet from the plan now has a test.
Test results: `npm run typecheck` ✅; `npm test` ✅ 17/17 suites, 173/173 tests.
[MANUAL]: none.

### P1.7 — ✅ done (script written, NOT run)
Files changed:
- `scripts/load/concurrent-redeem.ts` (new):
  - Plain HTTP with Node 22 `fetch`; no new dependencies and no AWS SDK.
  - Flow:
    1. `POST /auth/cashier-login` with a seed account (`negocio01@seed.rewardshub.test` / `lab12345` by default);
    2. points system from `GET /systems`;
    3. main branch from `GET /business/me`;
    4. customer = the one with the most points (`GET /user-points/business-users`), or `--user`;
    5. optional `--topup`;
    6. N simultaneous `POST /user-points/subtract`, each with its own Idempotency-Key, or one shared key with `--same-key`;
    7. reads the balance again.
  - Prints the status histogram, applied subtracts vs expected, replays, and final vs expected balance. Exits 1 if they don't match.
  - `parseArgs` / `expectedOutcome` are exported; `main` only runs under `require.main === module`.
- `tests/scripts.concurrentRedeem.test.ts` (new): pure argument parsing and expected-outcome logic. The script is never pointed at a server.
- `infra/aws/README.md`:
  - "Qué cambió en el código": rows for atomic writes, Idempotency-Key + CORS, and the Stripe dedupe;
  - "Demostraciones": the concurrency and `--same-key` scenarios with exact commands;
  - "Limitaciones": how Stripe dedupe is verified without the lab.
Test results: `npm run typecheck` ✅; `npm test` ✅ 18/18 suites, 180/180 tests; `npm run build` ✅.

## Manual steps after P1 (in order)
1. Before deploying this branch (Render and lab DB): `npx ts-node scripts/find-duplicate-memberships.ts` (read-only). Resolve any listed groups by hand (P1.3).
2. Start the Learner Lab, refresh `[academy]` credentials, `cd infra/aws && terraform plan`, then `./lab.sh up && ./lab.sh roll`.
3. If not done yet: `DB_NAME=rewardshub_lab npm run seed:lab` from the repo root.
4. Concurrency demo: `API=$(terraform -chdir=infra/aws output -raw api_url)`, then `npx ts-node scripts/load/concurrent-redeem.ts --url $API --n 20 --amount 10 --topup 100`. Expect 10 × 200, 10 × 400, final 0, exit 0.
5. Idempotency demo: `npx ts-node scripts/load/concurrent-redeem.ts --url $API --n 20 --amount 10 --same-key`. Expect exactly 1 applied, the rest 409 or replay, exit 0.
6. Stripe (local or Render, not the lab):
   - `stripe listen --forward-to localhost:3000/webhooks/stripe`;
   - `stripe trigger customer.subscription.updated`;
   - `stripe events resend <evt_id>`, which must answer `{ "received": true, "duplicate": true }`.
7. `./lab.sh down` when done.
8. Front and mobile teams: send `Idempotency-Key` (one UUID per scan/redeem action, reused on retries) on the 5 endpoints; retry `409` after `Retry-After`; `422` means a reused key with a different body.

(P1 finished; P2 continues below.)

### P2 step 0 — map contracts pinned BEFORE refactoring
- `tests/business.geoContracts.test.ts` (new, 18 tests) was written and run green on the **unchanged** code first.
- What it pins, exactly:
  - `/nearby`: row order by distance, row keys, `location` keys, the 9.9 km in / 10.1 km out boundary (haversine), default 10 km, 400 messages;
  - `/in-bounds`: membership with inclusive edges, row and `location` keys, `minLng > maxLng` → `[]`, world box, 400 messages;
  - `/all` with coordinates: every branch under 5000 km in distance order;
  - `/all` without coordinates: public business shape, `limit`.
- It runs once per `GEO_QUERY_MODE=legacy|geo` (`describe.each`), so P2.2 must give identical results in both modes.

### P2.1 — ✅ done
Files changed:
- `src/models/business.model.ts`:
  - `locations[].geo` (single-nested `{ type: 'Point', coordinates }`, **no defaults**: a coordinate-less `{type:'Point'}` would be rejected by the 2dsphere index);
  - `locationSchema.pre('validate')` keeps `geo = [longitude, latitude]` in sync (every branch write uses `doc.save()`, and any save also fills old branches);
  - `toJSON` transform drops `geo` → **API responses are byte-identical**;
  - `businessSchema.index({ 'locations.geo': '2dsphere' })`. The old lat/lng index stays (used by legacy mode).
- `src/db/seed/labDataset.ts`: locations carry `geo` (the writer inserts raw, without hooks); asserted in `tests/seed.labDataset.test.ts`.
- `scripts/migrate-locations-geo.ts` (new, **written, not run**):
  - `migrateLocationsGeo({ apply, prod })`, dry run by default;
  - per-location `$set` with `arrayFilters` on `_id` **and** the read lat/lng, so a branch moved meanwhile isn't overwritten;
  - idempotent;
  - `--apply` requires a lab/test DB unless `--prod`;
  - connects with `autoIndex: false`.
- `tests/business.geo.test.ts` (new, 7 tests):
  - the hook on create / `addBranch` / `updateBranch` (coordinates and geocoded address, `geocoding.service` mocked) / `removeBranch`;
  - any save fills a missing `geo`;
  - `geo` absent from `/business/me`, `/business/locations` and `/business/nearby` responses;
  - both indexes exist;
  - migration: dry run writes nothing, apply fixes 2 locations (missing + stale), second run 0, non-lab DB refused without `prod`, allowed with it.
- **P1.5 correction:** the explicit `subscriptionSchema.index({ stripeSubscriptionId: 1 }, { sparse: true })` duplicated the index that `sparse: true` on the field already creates (Mongoose warned "Duplicate schema index"). Removed it; the index still exists (asserted in `tests/webhook.stripe.test.ts`).
Test results: `npm run typecheck` ✅; `npm test` ✅ 20/20 suites, 205/205 tests.
[MANUAL]: none yet (the backfill is listed at the end of P2).

### P2.2 — ✅ done
Files changed:
- `src/services/business.service.ts`:
  - `geoQueryMode()`: `'geo'` only with `GEO_QUERY_MODE=geo`; unset means `'legacy'`, today's code path unchanged.
  - `findNearbyBusinesses(lat, lng, maxKm, limit?)`:
    - geo mode: `$geoNear` on `locations.geo` (`spherical`, `query: { isVerified, status }`), then `hydrate`;
    - `maxDistance` is padded by `6378.1/6371 × 1.001`, because MongoDB's earth radius is larger than our haversine's. The index returns a superset and the same per-branch `calculateDistance` filter + sort decides, so results are identical;
    - `limit` (closest N businesses) only applies in geo mode;
    - row mapping extracted into `branchRow`.
  - `findBusinessesInBounds`, geo mode:
    - `$geoWithin` on a polygon of the box expanded by 0.01°, north/south edges densified every 0.5° (GeoJSON edges are geodesics), then the existing exact lat/lng filter;
    - sorted by `_id` for a stable order.
  - `getAllBusinesses` with coordinates passes `limit: 200` in geo mode.
- Tests:
  - `tests/business.geoContracts.test.ts`: the pinned contracts pass **in both modes**, plus 3 tests proving geo mode really issues `$geoNear` / `$geoWithin` (and `$limit: 200` on `/all`), `limit` keeps the closest N, and the fallback boxes use legacy.
  - `tests/business.geoEquivalence.test.ts` (new): with the lab seed (~100 branches), 200 random `/nearby` queries (radii 0.5–600 km) and 200 random boxes give **identical** results in legacy and geo (same order for nearby).
  - `tests/business.nearby.test.ts` unchanged and green.
**Deviations:**
- **Gated, not on by default.** Production branches have no `geo` until the backfill runs, so geo mode is behind `GEO_QUERY_MODE` (CLAUDE.md rule). Lab can enable it now (the seed has `geo`). Render enables it after the backfill.
- **Antimeridian.** Boxes crossing it (`minLng > maxLng`) are **not** split: today they return `[]`, and the contract keeps that. They go through legacy, as do boxes with `|lat| > 85` or ≥ 180° wide.
- **In-bounds order.** Geo mode orders by `_id`; legacy uses natural order. Neither is part of the contract, and the tests compare sets.
- **Limit on `/all`.** Only in geo mode: legacy `/all` with coordinates still has no cap.
- **Old index kept.** The lat/lng index stays until geo mode is on everywhere.
Test results: `npm run typecheck` ✅; `npm test` ✅ 21/21 suites, 211/211 tests.
[MANUAL]: see the end of P2.

### P2.3 — ✅ done
Files changed:
- `src/models/dailyStat.model.ts` (new): collection `daily_stats`, one row per (business, UTC day) plus one per (business, branch, day).
  - Fields: `kind: business|branch`, `branchId`, `day`, `txCount`, `addCount`, `subtractCount`, `redeemCount`, `pointsAdded`, `stampsAdded`, `pointsRedeemed`, `stampsRedeemed`, **`revenueWithPoints`**, **`revenueAllAdds`**, `newClients`, `uniqueClients` (business rows), `computedAt`.
  - Unique index `{ businessId, kind, branchId, day }`.
- `src/services/dailyStats.service.ts` (new):
  - `aggregateRange` / `aggregateDay`: pure reads, same counting rules as `businessStats.service`.
  - `computeDailyStats(businessId, day)`: `bulkWrite` upserts + deletes stale branch rows; idempotent. For P3's job.
  - `getDailyStats(businessId, from, to, branchId?)`.
  - `dayAggregates`: stored rows for closed days; live for **today** (no upper bound, like live) and for any day without its `business` row.
  - Readers `dailyTimeSeries` / `dailyKpiSums` / `dailyBranchCounts`.
  - `statsSource()` / `useDailyStats()`: daily only with `STATS_SOURCE=daily` **and** the process in UTC.
- `src/services/businessStats.service.ts`:
  - `getTimeSeriesStats`, `getKpiSummary` (revenue/points/redemptions) and `getBranchComparison` branch to daily behind the flag.
  - The `changePct` mapping is extracted into `compareBranches`, shared by both paths.
  - With the flag unset, the queries are exactly today's.
- `infra/aws/user_data.sh.tftpl`: `TZ=UTC`; `GEO_QUERY_MODE` / `STATS_SOURCE` written only when not default.
- `infra/aws/variables.tf`: `geo_query_mode` (default `legacy`), `stats_source` (default `live`), both validated.
- Also `compute.tf`, `terraform.tfvars.example`, `README.md` ("Qué cambió", "Demostraciones").
- `jest.config.cjs` + `tests/setup/timezone.cjs` (new `globalSetup`): **tests run with `TZ=UTC`**, like Render and the lab. Setting `process.env.TZ` inside a test file does nothing, because Jest gives each file a copy of `process.env`; a first version of the test passed trivially (live vs live) because of that, and the "reads `daily_stats`" assertion caught it.
- `tests/stats.daily.test.ts` (new, 10 tests). Data: the lab seed, 5 businesses, 1500 users, 6000 transactions over 90 days, with decimal amounts (.25/.5/.75) and transactions without a branch.
  - **`STATS_SOURCE=daily` == live, `toEqual`, for every business:** time series 7/30/90, KPI 7/30, branch comparison 7/30 (sorted; live's `$group` order isn't deterministic).
  - Partial coverage (a third of 40 days deleted) still equal.
  - Σ `revenueWithPoints` == `getBusinessStats.totalRevenue`.
  - Proof that daily really reads the rows: a 90-day series only aggregates today, and a corrupted stored row shows up in daily but not in live.
  - Idempotent recompute.
  - A day with no activity still writes a zero business row.
  - Non-UTC offset (mocked) → falls back to live, with no `daily_stats` read.
  - Flag unset → `daily_stats` is never read.
**Deviations:**
- **`kind` field instead of "branchId null = whole business".** `null` is already a real bucket in live stats (transactions without a branch).
- **The `business` row is always written** (zeros included), as the "day computed" marker. Missing days are computed live, so the output is exact before P3's job runs.
- **KPI fields that stay live:** `totalClients`, `totalActiveRewards` and `atRiskClients` are distinct counts or point-in-time snapshots, not additive per day. `getBusinessStats` (all-time) also stays live; `revenueWithPoints` is stored for later use.
- **UTC guard:** daily is used only when the process runs in UTC. Live windows start at server-local midnight, so in any other TZ they can't match UTC days. Render runs in UTC; the lab now sets `TZ=UTC`.
- **Float sums:** sums are added in a different order (per day, then across days). Integers and binary-exact decimals match exactly; arbitrary decimals like 0.1 can differ in the last ~1e-12. That's floating point, not a logic difference.
Test results: `npm run typecheck` ✅; `npm test` ✅ 22/22 suites, 221/221 tests; `terraform fmt` ✅ (no changes); `terraform validate` ✅; `npm run build` ✅.

## Manual steps after P2 (in order)
1. Lab:
   - Optionally set `geo_query_mode = "geo"` (and later `stats_source = "daily"`) in `infra/aws/terraform.tfvars`.
   - `cd infra/aws && terraform plan`: the user data must show `TZ=UTC` and, if set, `GEO_QUERY_MODE=geo` / `STATS_SOURCE=daily`.
   - `./lab.sh up && ./lab.sh roll`.
2. Lab DB, if it was seeded before P2.1 (old seed without `geo`): `DB_NAME=rewardshub_lab npx ts-node scripts/migrate-locations-geo.ts` (dry run), then `--apply`. Or reseed: `DB_NAME=rewardshub_lab npm run seed:lab -- --reset`.
3. Production, later and by a person:
   - Deploy this code to Render first; the hook keeps new writes in sync.
   - `npx ts-node scripts/migrate-locations-geo.ts --prod` (dry run), then `--prod --apply`.
   - Only then set `GEO_QUERY_MODE=geo` on Render.
4. `STATS_SOURCE=daily` on Render: only after P3's `daily-stats` job has backfilled the history (it's already exact without it, just not faster).
5. Optional, once geo mode is on everywhere: drop the old `locations.latitude_1_locations.longitude_1` index.
6. `./lab.sh down` when done.

(P2 finished; P3 continues below.)

### P3.1 — ✅ done (job protocol, backward compatible)
Files changed:
- `src/queue/jobs.ts`:
  - `JOB_TYPES` + `daily-stats` and `reconcile-balances`.
  - Optional `params`, validated per type, returning `null` (message discarded) when invalid:
    - `daily-stats`: `{ day }`, `{ from, to }` (inclusive, ≤ 400 days, real calendar dates), `businessId`;
    - `reconcile-balances`: `{ businessId }`;
    - the two notification batches accept **no** params.
  - `{}` / `null` params count as no params.
  - `jobRunKey` appends a 10-hex sha256 of the canonical params; **without params the key is exactly the old one**.
- `src/queue/processor.ts`: `JobHandlers` is typed per job; each handler receives `(params, { key, scheduledAt })`.
- `src/queue/sqs.ts`: `enqueueJob(type, scheduledAt?, params?)`.
- `src/worker.ts`: registers the two new handlers.
- `infra/aws/scheduler.tf`: `local.scheduled_jobs` + `daily-stats` (`var.daily_stats_schedule`, default `cron(15 6 * * ? *)`) and `reconcile-balances` (`var.reconcile_schedule`, default `cron(30 7 * * ? *)`). An empty schedule turns the rule off (off path). The input template stays `{type, scheduledAt}`.
- `infra/aws/variables.tf`, `terraform.tfvars.example`.
- `infra/aws/lab.sh` (edited, **not run**; only `bash -n` syntax check): `enqueue <type> [json-params]`. It validates the type, checks that the params are a JSON object (python3 if available), prints the body, then sends. Usage header updated.

### P3.2 — ✅ done (`daily-stats` job)
- `src/jobs/dailyStats.job.ts` (new), `runDailyStatsJob(params, ctx, { enqueue })`. It reuses P2.3's `computeDailyStats`:
  - **No params:** the last 2 closed UTC days.
  - **`day`:** that day.
  - **`from`/`to`:** inclusive range. More than 7 days with a queue → one message per week, with the **same `scheduledAt`**, so a redelivered parent produces the same week keys and JobRun dedupes them. Without a queue (local) it processes everything.
  - **`businessId`:** that business only.
  - It iterates **all** businesses with a cursor and writes the zero "business" row even on quiet days, so `STATS_SOURCE=daily` readers never have to compute those days live. Result: `{ businesses, days, from, to, rows, ms }` (stored in `JobRun.result`).
- **Deviation:** the plan says "active businesses". All businesses are included, because inactive ones still have a dashboard and the cost is one small upsert per business per day.

### P3.3 — ✅ done (`reconcile-balances`, report only)
- `src/models/reconciliationRun.model.ts` (new): collection `reconciliation_runs`.
  - Fields: `{ runKey (unique, = JobRun key), params, checked, mismatchCount, countsByProblem, sample (first 100), orphanRewardCount, orphanRewardSample, startedAt, finishedAt }`.
- `src/jobs/reconcile.job.ts` (new):
  - `reconcile()` aggregates the ledger (`$unwind items`, `allowDiskUse`, cursor), then streams `userpoints` raw.
  - **One issue per balance entry**, listing every problem it has, so one corrupted balance = exactly 1 mismatch. Problems:
    - `ledger_mismatch` (system ≠ Σ ledger);
    - `negative`;
    - `total_mismatch` (business total ≠ Σ systems);
    - `missing_entry` (ledger says nonzero, no userpoints entry).
  - Subtract/redeem transactions whose `rewardId` no longer exists are counted separately (`orphanRewardCount`).
  - `runReconcileJob` upserts the run by `runKey` (a retried job overwrites, no duplicates) and logs a summary.
- **Deviation:** the CloudWatch metric `ReconciliationMismatches` goes through an optional `metric(name, value)` hook. P6.3 connects it to `PutMetricData`; for now it's only logged and kept in `JobRun.result`.

### P3.4 — ✅ done (tests + fix script)
- `scripts/reconcile-fix.ts` (new, **written, not run**): `reconcileFix(runKey, { apply })`, CLI `--run <runKey> [--apply]`, dry run by default.
  - The ledger is the source of truth.
  - It only touches issues **in the run's sample**, and only if the stored value **still equals** what the run saw: the filter enforces it. Anything that changed is `skipped_changed`.
  - It re-runs the reconciliation first, so issues already fixed are skipped.
  - It recreates missing entries, resyncs the business total after each system fix, and never "fixes" toward a negative expected balance.
  - `assertNonProductionDb()` is checked even for a dry run from the CLI. **No `--prod` flag on purpose:** production balances that predate the ledger would be wiped.
- Tests (new):
  - `tests/queue.processor.test.ts` (+10): old messages unchanged; valid and invalid params per type; the key hash is stable across key order and differs per range; the handler receives params + `{ key, scheduledAt }`; old handlers get `undefined`.
  - `tests/jobs.dailyStats.test.ts` (10, replica set):
    - day resolution and week splitting;
    - default run writes 2 days × every business, zero rows included;
    - **idempotent** (two runs, identical rows);
    - `businessId`;
    - a long range enqueues 3 weekly chunks and computes nothing; no queue → processes all;
    - through `processMessage` + the real JobRun lock: chunk keys are distinct, and redelivering the parent or a chunk → `duplicate`;
    - **with `STATS_SOURCE=daily` after the backfill, readers equal live and only aggregate today.**
  - `tests/jobs.reconcile.test.ts` (14, replica set):
    - **seed data → 0**;
    - **one corrupted balance → exactly 1**;
    - total-only → 1 `total_mismatch`;
    - negative → 1 issue with `['ledger_mismatch','negative']`;
    - missing entry → 1 `missing_entry`;
    - orphan reward counted separately;
    - `businessId` scope;
    - sample capped at 100 and runKey upsert;
    - metric hook.
    - Fix script: dry run writes nothing; `--apply` → reconciliation 0, then rerun = `skipped_resolved`; a balance changed after the run is skipped; a missing entry is recreated; `--apply` goes through `assertNonProductionDb` and writes nothing when refused; unknown run → clear error.
  - Two test-only bugs fixed along the way: `structuredClone` turns ObjectIds into plain objects, and the cap test needed more than 100 entries.
Test results: `npm run typecheck` ✅; `npm test` ✅ 24/24 suites, 263/263 tests; `terraform fmt` ✅ (no changes); `terraform init -backend=false && terraform validate` ✅; `npm run build` ✅.
Note on scaling: a daily scheduled message is consumed in seconds and won't trip the `jobs-backlog` alarm (≥1 visible for 2 × 60 s). A long `daily-stats` backfill can, which is the intended worker scale-out demo. The alarm change is planned for P5.2.

## Manual steps after P3 (in order)
1. `cd infra/aws && terraform plan`: expect 2 new `aws_cloudwatch_event_rule` + 2 targets (`daily-stats`, `reconcile-balances`) and the updated queue policy. Then `./lab.sh up && ./lab.sh roll`.
2. With the lab seeded (`DB_NAME=rewardshub_lab npm run seed:lab`):
   - `./lab.sh enqueue daily-stats '{"from":"<seed start>","to":"<yesterday>"}'` (the seed covers the last 90 days), then `./lab.sh logs worker 50` → `📅 [daily-stats] … partido en N trabajos semanales`, then one line per week.
   - `./lab.sh enqueue reconcile-balances`, then `./lab.sh logs worker` → `🧮 [reconcile] {"mismatchCount":0,…}`.
3. Demo: change one balance in Atlas (`rewardshub_lab.userpoints`), enqueue `reconcile-balances` again → `mismatchCount: 1`. Then:
   - `DB_NAME=rewardshub_lab npx ts-node scripts/reconcile-fix.ts --run <runKey from the log>` (dry run);
   - then `--apply`;
   - enqueue again → 0.
4. Optional: `stats_source = "daily"` in `terraform.tfvars` once the backfill ran, then `./lab.sh up && ./lab.sh roll`.
5. `./lab.sh down` when done.
Never run `reconcile-fix` against production: legacy balances predate the ledger (the script refuses non-lab DB names anyway).

(P3 finished; P4 continues below.)

### P4.0 — ⏳ NOT run (manual probe pending)
The ElastiCache probe hasn't been run yet; the user will run it at the end. Until then `redis_mode` defaults to `"off"`. The exact commands and how to choose are in `infra/aws/README.md` → *Limitaciones*.

### P4.1 — ✅ done (Terraform)
- `infra/aws/redis.tf` (new). `var.redis_mode = "off" | "elasticache" | "ec2"` (default `"off"`, validated). Both modes are fully implemented:
  - **Both modes:** `aws_security_group.redis`, 6379 **only** from the `api` and `worker` SGs.
  - **`elasticache`:** `aws_elasticache_subnet_group` (existing public subnets) + `aws_elasticache_cluster` (redis `7.1`, `cache.t3.micro`, 1 node, `default.redis7`, `snapshot_retention_limit = 0`).
  - **`ec2`:**
    - a `t3.micro` AL2023 instance with `LabInstanceProfile`, public subnet, same SG;
    - user data installs `valkey`, falling back to `redis6`, and sets `bind 0.0.0.0` and `protected-mode no`;
    - no persistence, `maxmemory 256mb allkeys-lru`.
  - References to resources with `count = 0` use `try(...)`, so no mode can break `plan`.
- `local.redis_url` → `REDIS_URL` + `CACHE_BIZMAP_TTL` in `/etc/rewardshub.env`, only when the mode isn't `off`.
- `RATE_LIMITS=on` when `enable_rate_limits` (default `true`, lab only).
- New variables: `redis_mode`, `redis_node_type`, `redis_engine_version`, `redis_instance_type`, `enable_rate_limits`, `cache_bizmap_ttl` (+ `terraform.tfvars.example`).
- New outputs: `redis_mode`, `redis_endpoint`, `redis_cluster_id`, `redis_instance_id`.
- `lab.sh status` (edited, **not run**; `bash -n` OK): a Redis section that describes the ElastiCache cluster or the EC2 instance, or says it's off.
- **Note:** once, I ran `terraform console` to evaluate `local.redis_enabled` in each mode. It's read-only and only evaluated a local (no data sources), but it's **not** on CLAUDE.md's allow-list (`fmt` / `validate` only). I won't use it again.

### P4.2 — ✅ done (client)
- `src/cache/redis.ts` (new):
  - `ioredis`, lazy singleton.
  - `isCacheEnabled()` = `Boolean(REDIS_URL)`.
  - Fail-open settings: `connectTimeout 2000`, `commandTimeout 200`, `maxRetriesPerRequest 1`, `enableOfflineQueue false`, and a reconnect-forever `retryStrategy`.
  - Errors are logged at most once every 30 s.
  - `cacheGet` / `cacheSet` / `cacheIncr` catch errors and return null.
  - `setRedisClient()` lets tests inject a client; `closeRedis()` is called on SIGTERM in `src/index.ts` (after `server.close`) and `src/worker.ts`.
- Dependencies: `ioredis@^5.11.1`, `express-rate-limit@^7.5.1`; dev: `ioredis-mock@^8.13.1`.
  - **Deviation:** `rate-limit-redis` was installed, then removed; see P4.4.

### P4.3 — ✅ done (business-map cache)
- `src/cache/bizmapCache.ts` (new) + `src/cache/bizmapVersion.ts` (new; avoids an import cycle with the model).
- **Deviation, done for exactness: the cache stores the candidate *businesses*, not the final response.**
  - Keys use rounded parameters: lat/lng to 3 decimals (~110 m), the radius rounded **up** to 0.5 km, and boxes rounded **outward**.
  - The loader queries a slightly larger area (radius + 0.1 km for center rounding).
  - Each request then applies the usual exact haversine / edge filter with its **own** coordinates. So a HIT for coordinates a few metres away returns exactly what an uncached request would (tested).
  - The key includes `GEO_QUERY_MODE`.
- **Stored copy:** no tokens or hashes. `passHash` / `branchPassHash` are replaced by a placeholder, because `hasBranchPassword` needs to know they exist. Payloads over 1 MB aren't stored. TTL is `CACHE_BIZMAP_TTL` (default 120 s).
- **Invalidation:** version bump (`INCR bizmap:version`, no `SCAN`) from **model hooks** in `src/models/business.model.ts`.
  - Hooked operations: `save` (new docs, or any non-session field modified); `findOneAndUpdate` / `updateOne` / `updateMany` / replace (when the update touches a non-session path); `findOneAndDelete` / `deleteOne` / `deleteMany`; `insertMany`.
  - That covers `addBranch`, `updateBranch`, `removeBranch`, `updateBusiness` (name / email / **status**, used by `activateSubscription` and the Stripe webhook), `updateBusinessLogo`, `deleteBusiness`, `verifyBusinessEmail`, create, `setBranchPassword`.
  - **Not** triggered by refresh-token rotation, admin PIN, or password-reset tokens; otherwise every login would flush the cache.
  - Raw `collection.*` writes (seed, migration scripts) bypass the hooks; the 120 s TTL covers them.
- `src/services/business.service.ts`: `findNearbyBusinesses`, `findBusinessesInBounds` and `getAllBusinesses` take an optional `meta`. With the cache off they make exactly the previous calls. The box query is extracted into `findDocsInBounds`.
- `src/controllers/business.controller.ts`: `X-Cache: HIT|MISS|BYPASS` on the three endpoints. `X-Cache` is added to CORS `exposedHeaders`.

### P4.4 — ✅ done (shared rate limits)
- `src/middleware/rateLimit.middleware.ts` (new):
  - **Gated** by `RATE_LIMITS=on`, read per request. Without it the limiter is a pass-through, so Render and local are unchanged (CLAUDE.md rule; the lab turns it on).
  - `SharedRateLimitStore` (custom `express-rate-limit` Store):
    - With Redis: `MULTI SET k 0 PX window NX → INCR → PTTL`. Atomic, global, and works on Redis 6 (ec2 mode) as well as 7.
    - Without Redis, or on any Redis error: per-instance `MemoryStore`. Plus `passOnStoreError`.
  - **Deviation:** a custom store instead of `rate-limit-redis`. That package loads a Lua script when the store is created (unhandled-rejection risk if Redis is down at boot), and it wouldn't fall back to memory.
  - 429 answers JSON `{ message: 'too many requests, please try again later' }`, with draft-7 `RateLimit` / `RateLimit-Policy` headers.
- Limits (each overridable via `RATE_LIMIT_*_MAX`):
  - `/auth/login` + `/auth/cashier-login`: 10 **failed** / 15 min / IP.
  - `/auth/register` + `/auth/check-email`: 10 / 15 min / IP.
  - `/auth/forgot-password`, `/auth/reset-password`, `/business/forgot-password`, `/business/reset-password`: 10 / 15 min / IP (one shared bucket).
  - `/business/admin-pin/verify` + `/change`: 5 **failed** / 15 min **per business**. `/reset` (sends an email): 5 / 15 min per business.
  - `/report/generate` + `/preview` (also mounted under `/business/reports`): 10 / min per business.
  - IP keys rely on `TRUST_PROXY=1` (already set).
- Tests (new):
  - `tests/cache.bizmap.test.ts` (20):
    - BYPASS without Redis;
    - MISS→HIT with the same body as uncached for `/nearby`, `/in-bounds`, `/all` with and without coordinates;
    - nearby coordinates and narrower boxes give a HIT with an exact body;
    - editing a branch → MISS showing the change;
    - 8 write paths bump the version, and token / PIN writes don't;
    - broken Redis → 200 + BYPASS, and writes don't fail;
    - no secrets in Redis, while `hasBranchPassword` stays correct;
    - TTL ≤ 120 s.
  - `tests/rateLimit.test.ts` (8):
    - off by default;
    - **two app instances (`jest.isolateModules`) without Redis: 20 logins pass (10 + 10); with one shared ioredis-mock, the 11th gets 429 on either instance**;
    - broken Redis → still limited per instance, API answers;
    - a successful login doesn't consume quota;
    - admin PIN: per business (the 6th attempt is 429 even with the right PIN, the other business is unaffected);
    - reports: 10/min per business across both mounts;
    - password reset shared across `/auth` and `/business`.
Test results: `npm run typecheck` ✅; `npm test` ✅ 26/26 suites, 291/291 tests; `terraform fmt` ✅ (no changes); `terraform init -backend=false && terraform validate` ✅; `bash -n lab.sh` ✅; `npm run build` ✅.

## Manual steps after P4 (in order)
1. **P4.0 probe** (README → *Limitaciones*): `aws elasticache create-cache-cluster --cache-cluster-id rh-probe --engine redis --cache-node-type cache.t3.micro --num-cache-nodes 1 --profile academy --region us-east-1`, then `aws elasticache wait cache-cluster-available …`, then `aws elasticache delete-cache-cluster …`. Write the result in the README.
2. Set `redis_mode = "elasticache"` (probe OK) or `"ec2"` (probe failed) in `infra/aws/terraform.tfvars`.
3. `cd infra/aws && terraform plan`:
   - expect the Redis SG plus the cluster (or the instance);
   - the launch template's user data must have `REDIS_URL=redis://…:6379`, `CACHE_BIZMAP_TTL=120`, `RATE_LIMITS=on`.
   Then `./lab.sh up && ./lab.sh roll`, then `./lab.sh status` (Redis section).
4. Demos (README → *Demostraciones*):
   - repeated `/business/nearby` → `X-Cache: MISS` then `HIT`; edit a branch → `MISS`;
   - 20 bad logins through the ALB → `429` from the 11th;
   - stop Redis → API keeps working with `X-Cache: BYPASS`.
5. `./lab.sh down` when done. With `redis_mode = "ec2"` this also destroys the Redis instance; check in the console that no ElastiCache cluster or extra EC2 is left.
Render: nothing changes (no `REDIS_URL`, no `RATE_LIMITS`). If you later want the admin-PIN brute-force protection in production, set `RATE_LIMITS=on` on Render (memory store, per instance).

(P4 finished; P6 continues below.)

### P6.1 — ✅ done (Terraform: Grafana)
- `infra/aws/grafana.tf` (new). `var.enable_grafana` (default `false`) creates nothing when off. When on:
  - `aws_security_group.grafana`: 3000 (and 22 if `key_name`) **only from `admin_cidr`**. A **precondition** fails the plan if `enable_grafana = true` without `admin_cidr`; it never opens to `0.0.0.0/0`.
  - `aws_s3_object.grafana_dashboards`: every `grafana/dashboards/*.json`, uploaded through the existing private artifacts bucket.
  - `aws_instance.grafana`: `t3.micro` AL2023, `LabInstanceProfile`, public subnet, `user_data_replace_on_change` (dashboards are code; the instance is disposable).
  - `random_password.grafana_admin` (alphanumeric, safe in the env file).
- `infra/aws/user_data_grafana.sh.tftpl` (new):
  - installs Grafana OSS from the official RPM repo;
  - provisions the CloudWatch datasource (`uid: cloudwatch`, auth "AWS SDK Default" = instance role, region `us-east-1`) and a file dashboard provider (folder RewardsHub);
  - downloads the dashboards from S3 and `sed`-replaces the `__PLACEHOLDERS__` with real names (ALB / target group `arn_suffix`, ASGs, queues, WAF ACL + rule metric, ElastiCache cluster id, DynamoDB tables);
  - admin password and optional anonymous Viewer (`grafana_anonymous_viewer`) via `/etc/sysconfig/grafana-server`; home dashboard set.
- `variables.tf`: `enable_grafana`, `admin_cidr` (validated CIDR or null), `grafana_instance_type`, `grafana_anonymous_viewer`, `enable_app_metrics` (default `false`).
- `outputs.tf`: `grafana_instance_id`, `grafana_url`, `grafana_admin_password` (sensitive).
- `terraform.tfvars.example` updated.
- `compute.tf`:
  - the ASGs get `enabled_metrics` (`GroupInServiceInstances`, `GroupDesiredCapacity`, …) **only when `enable_grafana`**. Group metrics are free; this keeps a default deploy unchanged;
  - `METRICS_ENABLED=true` goes into `/etc/rewardshub.env` when `enable_app_metrics`.
- `lab.sh grafana` (edited, **not run**; `bash -n` OK):
  - looks up the instance's current state and public IP (it changes every session);
  - prints the URL and the login hint (`terraform output -raw grafana_admin_password`);
  - gives a clear message when Grafana is disabled or the instance is stopped.
- Template check (static, no Terraform rendering): every `${…}` in both user-data templates is provided, and every value passed is used.
- **Deviation:** the DynamoDB table names are passed empty until P5 creates the tables, so those panels show "Sin datos".

### P6.2 — ✅ done (dashboard JSON)
- `infra/aws/grafana/dashboards/rewardshub-lab.json` (new): uid `rewardshub-lab`, "RewardsHub · Lab", refresh 1 m.
- Resource names are hidden Grafana `constant` variables holding `__PLACEHOLDERS__`, so the JSON in git doesn't depend on one session's names.
- Rows and panels:
  - **Entrada:** ALB `RequestCount`; `TargetResponseTime` p50/p95; `HTTPCode_Target_5XX_Count` + `HTTPCode_ELB_5XX_Count`; `HealthyHostCount`/`UnHealthyHostCount`; WAF `BlockedRequests` (WebACL + rule `rewardshub-rate-limit`, empty with `enable_waf = false`).
  - **Cómputo:** `GroupInServiceInstances` api/worker; EC2 `CPUUtilization` per ASG with a 60 % threshold line.
  - **Cola:** visible / not visible / `ApproximateAgeOfOldestMessage`; DLQ visible; annotations from the CloudWatch alarm history (`rewardshub-jobs-*`).
  - **Datos** (collapsed row, tolerates P4/P5 off): ElastiCache CPU, `CurrConnections`, `CacheHits`/`CacheMisses`; DynamoDB consumed RCU/WCU and `ThrottledRequests`.
  - **App** (namespace `RewardsHub`): reconciliation mismatches + orphan rewards; replication lag (empty until P5); Idempotency-Key replays / conflicts / missing; map-cache hit % (math expression `100*A/(A+B)`); app 429s; cache BYPASS (Redis down).
- `tests/grafana.dashboard.test.ts` (new, 27):
  - valid JSON with a stable uid; every target uses the provisioned datasource;
  - every P6.2 metric present; p50/p95 and the 60 % line;
  - every app metric in the dashboard is one the app publishes;
  - every `$variable` is defined and every placeholder has its `sed` in the template;
  - Redis/DynamoDB in a collapsed row; alarm annotation; grid within 24 columns.
- **Note:** ElastiCache metrics only exist in `redis_mode = "elasticache"`. In `ec2` mode the cache is seen through the App panels (described in the row).

### P6.3 — ✅ done (app metrics)
- `src/observability/metrics.ts` (new):
  - `METRICS_ENABLED=true` gate; otherwise everything is a no-op (no counters, no client).
  - `incrementMetric`, `setGauge`, `flushMetrics` (`PutMetricData`, namespace `RewardsHub`, dimension `Role=api|worker`, batches of ≤ 1000), `startMetrics(role)` (60 s `unref`'d interval), `stopMetrics()` (final flush on shutdown).
  - **Same credential strategy as `src/queue/sqs.ts`:** `METRICS_AWS_PROFILE` → `fromIni`, else `fromInstanceMetadata`; never the default chain.
  - **Fail-silent:** errors are swallowed with at most one warning a minute, and that window's data is dropped.
  - Metric names in a shared `Metric` constant, which the dashboard test checks against.
- Wiring:
  - `src/worker.ts`: `startMetrics('worker')`; `stopMetrics()` on exit; **the P3.3 reconciliation hook is connected** (`metric: (name, value) => setGauge(name, value)`). `reconcile.job.ts` now also reports `ReconciliationOrphanRewards`.
  - `src/index.ts`: `startMetrics('api')`; `stopMetrics()` + `closeRedis()` after `server.close`.
  - Idempotency middleware: `IdempotentReplays`, `IdempotencyConflicts`, `IdempotencyMissingKey`.
  - Map cache: `BizmapCacheHits` / `Misses` / `Bypass` (Redis errors only; "no Redis configured" isn't counted).
  - Rate limiter: `RateLimited` on each 429.
- Dependency: `@aws-sdk/client-cloudwatch@^3.1175.0` (same v3 line as `client-sqs`).
- `tests/observability.metrics.test.ts` (new, 8; the CloudWatch client is mocked, nothing reaches the network):
  - disabled → nothing happens;
  - counters add up, gauges keep the last value, one `PutMetricDataCommand` with `Role`, flush clears;
  - credentials: instance metadata by default, `fromIni` with the profile;
  - a CloudWatch failure → no throw, one warning, data dropped;
  - 1500 points → 2 calls;
  - `stopMetrics` flushes;
  - cache HIT/MISS/BYPASS counted;
  - the reconciliation hook (as wired in the worker) produces `ReconciliationMismatches` / `ReconciliationOrphanRewards` gauges.
- `infra/aws/README.md`: "Qué cambió" (Grafana, metrics), "Demostraciones" (Grafana), "Limitaciones" (no Managed Grafana; IP changes; CloudWatch read and `PutMetricData` permissions not yet verified).
Test results: `npm run typecheck` ✅; `npm test` ✅ 28/28 suites, 326/326 tests; `terraform fmt` ✅ (no changes); `terraform init -backend=false && terraform validate` ✅; `bash -n lab.sh` ✅; `npm run build` ✅.

## Manual steps after P6 (in order)
1. Your public IP: `curl -s https://checkip.amazonaws.com`. In `infra/aws/terraform.tfvars`:
   - `enable_grafana = true`;
   - `admin_cidr = "<ip>/32"`;
   - `enable_app_metrics = true`;
   - optionally `grafana_anonymous_viewer = true` for the class.
2. `cd infra/aws && terraform plan`. Expect:
   - the Grafana SG, the instance, `random_password`, and one S3 object per dashboard;
   - `enabled_metrics` on both ASGs;
   - `METRICS_ENABLED=true` in the launch template user data.
   Then `./lab.sh up && ./lab.sh roll`.
3. About 3 min later: `./lab.sh grafana`, then log in as `admin` with `terraform output -raw grafana_admin_password`, then open **RewardsHub → RewardsHub · Lab**.
4. Check permissions (part of the P5.0 probe). If panels are empty:
   - the Grafana log (`journalctl -u grafana-server` on the instance) shows AccessDenied on `GetMetricData` → the lab blocks CloudWatch reads;
   - `./lab.sh logs api` shows `⚠️ [Metrics] No se pudieron publicar` → `PutMetricData` is denied for LabRole.
   Write the result in README → *Limitaciones*.
5. Demo: run `scripts/load/concurrent-redeem.ts` or a long `daily-stats` backfill and watch the ALB / ASG / SQS panels move. `./lab.sh enqueue reconcile-balances` → "Conciliación" panel.
6. `./lab.sh down` when done. It destroys Grafana too; check that no `rewardshub-grafana` instance is left.
If your IP changes between sessions, update `admin_cidr` and run `./lab.sh up` (only the SG changes).

(P6 finished; P5 continues below.)

### P5.0 — ⏳ NOT run (manual probe pending)
The DynamoDB + CloudWatch probe hasn't been run yet; the user will run it at the end. `enable_dynamo` defaults to `false`. Exact commands are in `infra/aws/README.md` → *Limitaciones*; they also check `cloudwatch:PutMetricData` (P6.3).

### P5.1 — ✅ done (Terraform)
- `infra/aws/dynamodb.tf` (new). With `var.enable_dynamo` (default `false`, which creates nothing):
  - `aws_dynamodb_table.daily_stats` (`rewardshub-daily-stats`): `pk` = `BIZ#<businessId>`, `sk` = `DAY#<day>#BR#<branchId|ALL|NONE>`. `ALL` is the whole-business row, and `NONE` the transactions without a branch, which is the P2.3 `kind` distinction.
  - `aws_dynamodb_table.transactions` (`rewardshub-transactions`): `pk` = `BIZ#<businessId>`, `sk` = `<createdAt ISO>#<txId>`. GSI `byShift`: hash `gsi1pk` = `BIZ#…#SHIFT#<workShiftId>`, range `createdAt`, projection ALL; sparse, only transactions with a shift.
  - Both are `PAY_PER_REQUEST`, no PITR, no global tables, and accessed with LabRole (no IAM).
- `user_data.sh.tftpl`: `DDB_DAILY_STATS_TABLE`, `DDB_TRANSACTIONS_TABLE`, `DDB_REGION`, only when enabled.
- `scheduler.tf`: `replicate-dynamo` every `var.replicate_schedule` (default `rate(10 minutes)`), **only with `enable_dynamo`**.
- **Scaling alarm** (`compute.tf`, as P5.2 asked): `jobs-backlog` now uses `ApproximateAgeOfOldestMessage > var.backlog_age_seconds` (default 120) for 2 × 60 s, instead of "≥ 1 visible message". `jobs-empty` is unchanged.
- `stats_source` accepts `"dynamo"`.
- Outputs `ddb_daily_stats_table` / `ddb_transactions_table`.
- `grafana.tf`: the dashboard's DynamoDB table names now come from these tables (empty with `enable_dynamo = false`). That fills in what P6.2 left empty.
- `lab.sh status` (edited, **not run**; `bash -n` OK): a "Réplica DynamoDB" section reads `META#replication` items from the daily-stats table and prints "al día hasta … (retraso N min S s)" per source. It needs no Mongo access.
- New variables: `enable_dynamo`, `replicate_schedule`, `backlog_age_seconds`. `terraform.tfvars.example` and the README are updated.
- **Note:** `terraform validate` warns that `hash_key`/`range_key` inside `global_secondary_index` are deprecated in the locked provider 6.73. The replacement `key_schema` block doesn't exist in older providers and `versions.tf` allows `>= 5.60`, so the deprecated (still working) form is kept.

### P5.2 — ✅ done (`replicate-dynamo`)
- `src/replica/dynamo.ts` (new):
  - `DynamoDBDocumentClient` with the **SQS credential strategy** (`DDB_AWS_PROFILE` → `fromIni`, else instance metadata; never the default chain);
  - `isDynamoEnabled()` (both table vars);
  - key builders and Mongo→item mappers.
- `src/models/replicationCheckpoint.model.ts` (new): `replication_checkpoints` `{ _id: 'transactions'|'daily_stats', lastSeenAt, lastSeenId, syncedAt, replicated }`.
- `src/jobs/replicateDynamo.job.ts` (new). Per source (`daily_stats` by `computedAt`, `transactions` by `updatedAt`):
  - **Reading:** pages of 500 in order `(field, _id)`, starting at **checkpoint − 2 min** (covers clock skew between instances; rewrites are idempotent).
  - **Writing:** `BatchWriteItem` in groups of **≤ 25**, retrying `UnprocessedItems` with exponential backoff and jitter, up to 8 attempts, then throwing. The SQS message is retried, then goes to the DLQ.
  - **Checkpoint:** advanced **after each written page**, and never backwards (conditional update; a racing older run is ignored).
  - **When caught up:** sets `syncedAt` (`$max`) and puts the `META#replication` marker for `lab.sh`.
  - **Time budget:** 8 min per run; the rest continues next run.
  - **Lag:** `ReplicationLagSeconds` gauge through the metrics hook (P6.3).
  - **Off:** a no-op without `DDB_*`.
- Indexes: `transactions {updatedAt:1, _id:1}`, `daily_stats {computedAt:1, _id:1}`. **Note:** the first is a new index on the production transactions collection when this reaches Render; Mongoose builds it at startup.
- `src/queue/jobs.ts`: job type `replicate-dynamo` (no params). `src/worker.ts`: its handler, publishing the lag metric.

### P5.3 — ✅ done (readers)
- `src/services/dailyStats.service.ts`:
  - `dayAggregates(businessId, days, loaders)` tries **row sources in order** for closed days: DynamoDB, then Mongo `daily_stats`. Whatever none of them has, and today always, is computed live.
  - `resolveStatsSource()`: `dynamo` only with `DDB_*`, otherwise `daily`; always `live` if the process isn't in UTC.
  - `withStoredStats(meta, read)`: with DynamoDB, **any error re-runs the read from Mongo** (warning at most once a minute).
  - `StatsMeta { source, freshness }`.
- `src/services/businessStats.service.ts`: `getTimeSeriesStats` / `getKpiSummary` / `getBranchComparison` take an optional `meta`. The live code path is unchanged.
- `src/controllers/businessStats.controller.ts`: **`X-Data-Freshness: <ISO>`** (the daily_stats checkpoint `syncedAt`) on the three endpoints, only when DynamoDB actually served the request. Added to CORS `exposedHeaders`.
- `src/replica/dynamoReaders.ts` (new):
  - `dynamoDailyRows`: paginated Query by `pk` + `sk BETWEEN`.
  - `reportTransactionsFromDynamo`: DynamoDB up to **cut = min(endDate, checkpoint − 2 min)**, then Mongo for `(cut, endDate]`. The `byShift` GSI is used when filtering by shift, `types` are filtered in memory, and users are loaded from Mongo to reproduce `populate('userId','username email')`. This is exact because transactions are immutable after creation.
  - `replicaFreshness`.
- `src/services/report.service.ts`: `loadReportTransactions` uses DynamoDB with `STATS_SOURCE=dynamo` + `DDB_*`, falling back to the original Mongo query on error.
- `scripts/compare-stats-sources.ts` (new, **read-only, not run**): for N businesses, compares live vs daily (vs dynamo if `DDB_*`) for the time series, KPIs and branch comparison. It prints the first differing path per business and exits 1 on any mismatch. It requires `TZ=UTC`.
- Tests (new):
  - `tests/helpers/fakeDynamo.ts`: in-memory BatchWrite / Put / Get / Query with pagination, `UnprocessedItems` and failure injection.
  - `tests/replica.dynamo.test.ts` (15, replica set):
    - off without `DDB_*`;
    - full copy with the plan's keys (pk/sk/gsi1pk, values) and checkpoints + META markers;
    - every batch has ≤ 25 items and `UnprocessedItems` are retried;
    - a second run only re-copies the 2-min overlap, and a new transaction shows up next run;
    - **a batch that's never accepted → job fails and the checkpoint doesn't move**;
    - the checkpoint never goes backwards (same instant with a smaller `_id`, or an older instant, are ignored; newer advances);
    - the time budget gives a partial run, and the next run finishes.
    - **`STATS_SOURCE=dynamo` == live == daily** for 3 businesses (series 14, KPI 7, branches 14), and it really issues Queries;
    - days missing in DynamoDB → Mongo → live, still equal;
    - DynamoDB down → same numbers from Mongo (`meta.source = 'daily'`, no freshness);
    - `dynamo` without `DDB_*` acts like daily;
    - `X-Data-Freshness` on the 3 endpoints equals the checkpoint, and is absent in live.
    - **Reports identical with DynamoDB** (including a transaction not yet replicated, read from Mongo), by shift through the `byShift` GSI, and with a type filter. Without a checkpoint, or with DynamoDB down → from Mongo, identical.
  - `tests/scripts.compareStatsSources.test.ts` (2): argument parsing, `firstDifference`.
- Dependencies: `@aws-sdk/client-dynamodb` + `@aws-sdk/lib-dynamodb` `^3.1175.0`.
**Deviations / notes:**
- Deletes aren't replicated: transactions are never deleted, and `daily_stats` branch rows deleted by a recompute keep their old DynamoDB copy. That's harmless, because readers only trust days whose business row is present, and the business row is always rewritten.
- `syncedAt` means "everything written before this instant is in DynamoDB" (start of the last page of a pass with nothing pending). Lag = now − the oldest of the two sources.
Test results: `npm run typecheck` ✅; `npm test` ✅ 30/30 suites, 343/343 tests; `terraform fmt` ✅ (no changes); `terraform init -backend=false && terraform validate` ✅ (only the GSI deprecation warning); `bash -n lab.sh` ✅; `npm run build` ✅.

# ALL TASKS IN THE PLAN ARE IMPLEMENTED. Consolidated [MANUAL] steps, in order

**A. Before deploying this branch anywhere**
1. `npx ts-node scripts/find-duplicate-memberships.ts` (read-only) against each DB this code will run on (Render production, lab). Resolve any listed groups by hand (P1.3 unique index).
2. Tell the web and both mobile teams:
   - `Idempotency-Key` (one UUID per scan/redeem, reused on retries; `409` → retry after `Retry-After`; `422` = key reused with another body);
   - `/auth/:id` now needs the Bearer token (P0.4);
   - new response headers `X-Cache`, `X-Data-Freshness`, `Idempotent-Replayed` (only additions).
3. Render: if support uses `POST /business/admin-pin/generate`, set `ADMIN_SECRET` (P0.4). Optionally `RATE_LIMITS=on` for admin-PIN brute-force protection (per instance).

**B. Lab probes (one Learner Lab session)**
4. Start the Learner Lab and refresh `[academy]` in `~/.aws/credentials`.
5. **P4.0 ElastiCache probe** (README → *Limitaciones*): `create-cache-cluster rh-probe …` → `wait cache-cluster-available` → `delete-cache-cluster`. Write down the result.
6. **P5.0 DynamoDB + CloudWatch probe** (README → *Limitaciones*): `create-table rh-probe` → from a lab instance `put-item` / `get-item` / `cloudwatch put-metric-data` → `delete-table`. Write down the result.

**C. Configure and deploy the lab**
7. In `infra/aws/terraform.tfvars`:
   - `redis_mode = "elasticache"` (probe 5 OK) or `"ec2"`;
   - `enable_dynamo = true` and `stats_source = "dynamo"` (probe 6 OK; else `stats_source = "daily"`);
   - `geo_query_mode = "geo"`;
   - `enable_grafana = true` and `admin_cidr = "<curl -s https://checkip.amazonaws.com>/32"`;
   - `enable_app_metrics = true` (if `PutMetricData` passed);
   - optionally `grafana_anonymous_viewer = true`.
8. `cd infra/aws && terraform plan`. Review it: Redis, 2 DynamoDB tables, Grafana instance + SG + dashboard object, 3 new EventBridge rules (`daily-stats`, `reconcile-balances`, `replicate-dynamo`), the `jobs-backlog` alarm on `ApproximateAgeOfOldestMessage`, ASG `enabled_metrics`.

   The user data must contain: `TZ=UTC`, `DB_NAME=rewardshub_lab`, `MONGO_MAX_POOL_SIZE=20`, `GEO_QUERY_MODE=geo`, `STATS_SOURCE=…`, `REDIS_URL=…`, `CACHE_BIZMAP_TTL=120`, `RATE_LIMITS=on`, `METRICS_ENABLED=true`, `DDB_*`.
9. `./lab.sh up && ./lab.sh roll`, then `./lab.sh status` (targets healthy, workers, Redis, DynamoDB replication).
10. `./lab.sh logs api` / `./lab.sh logs worker` → `Connected to MongoDB`, `📈 [Metrics] …`.

**D. Data**
11. `DB_NAME=rewardshub_lab npm run seed:lab` (or `-- --reset`). The guard check `DB_NAME=rewardshub npm run seed:lab` must refuse. If the lab DB was seeded before P2.1: the `migrate-locations-geo` dry run, then `--apply`, or reseed.
12. `./lab.sh enqueue daily-stats '{"from":"<seed start>","to":"<yesterday>"}'` → weekly chunks in the worker log.
13. `./lab.sh enqueue reconcile-balances` → `mismatchCount: 0`.
14. `./lab.sh enqueue replicate-dynamo` (or wait ≤ 10 min) → `./lab.sh status` shows the lag.
15. `DB_NAME=rewardshub_lab TZ=UTC DDB_DAILY_STATS_TABLE=rewardshub-daily-stats DDB_TRANSACTIONS_TABLE=rewardshub-transactions DDB_AWS_PROFILE=academy npx ts-node scripts/compare-stats-sources.ts --businesses 10 --days 30` → all ✅.

**E. Demos (README → *Demostraciones*)**
16. Concurrency, P1.7: `npx ts-node scripts/load/concurrent-redeem.ts --url $API --n 20 --amount 10 --topup 100`, then again with `--same-key`. Both exit 0.
17. Map cache, P4: repeated `/business/nearby` → `X-Cache: MISS` then `HIT`; edit a branch → `MISS`.
18. Shared rate limit, P4: 20 bad logins → `429` from the 11th. Stop Redis → API keeps working (`X-Cache: BYPASS`).
19. Reconciliation, P3: change one balance in Atlas → enqueue `reconcile-balances` → `mismatchCount: 1`. Then `scripts/reconcile-fix.ts --run <runKey>` (dry run), then `--apply`, then enqueue → 0.
20. Grafana, P6: `./lab.sh grafana` → admin + `terraform output -raw grafana_admin_password` → "RewardsHub · Lab". Run 16 or a long backfill and watch ALB / ASG / SQS / DynamoDB / App panels. If panels are empty, check for AccessDenied (Grafana log / `[Metrics]` warnings) and write it down.
21. Stripe dedupe, P1.5, local or Render: `stripe listen --forward-to localhost:3000/webhooks/stripe`, `stripe trigger customer.subscription.updated`, `stripe events resend <evt_id>` → `"duplicate": true`.

**F. Close**
22. `./lab.sh down`. Check in the console that no ElastiCache cluster, DynamoDB table, Grafana or Redis EC2 instance is left.
23. Update `infra/aws/README.md` → *Limitaciones* with the probe results, and update the architecture diagram: move the pieces to **Listo** and remove the "misma base que producción" warning.

**G. Production, later and by a person**
24. Deploy this branch to Render. The `geo` hook and the new indexes build at startup: `transactions {updatedAt, _id}`, `2dsphere`, `uniq_active_plan_per_user`, `stripeSubscriptionId`.
25. `npx ts-node scripts/migrate-locations-geo.ts --prod` (dry run), then `--prod --apply`; only then `GEO_QUERY_MODE=geo` on Render.
26. `STATS_SOURCE=daily` on Render only after `daily_stats` has been backfilled there (no worker on Render: run the backfill as a one-off).
27. Optional, once geo mode is on everywhere: drop the old `locations.latitude_1_locations.longitude_1` index.
Never run `reconcile-fix` or `seed:lab` against production (both refuse non-lab DB names).

## Final pass — ✅ done
1. **Checks:**
   - `npm run typecheck` ✅
   - `npm run lint` ✅ (0 errors, 6 warnings): unused helpers and parameters in pre-existing code (`pass.service`, `pdf.service`, `email.service`, `report.service`, `shiftCalculator`), left as they are.
   - `npm test` ✅ 30/30 suites, 343/343 tests
   - `npm run build` ✅
   - `terraform fmt -check` ✅; `terraform init -backend=false && terraform validate` ✅ (only the known GSI `hash_key`/`range_key` deprecation warning, see P5.1)
   - `bash -n lab.sh` ✅
2. **Lint was broken** (no ESLint config since before this work). Added `.eslintrc.cjs`: `eslint:recommended` + `@typescript-eslint/recommended` (already in devDependencies), `no-explicit-any` off (the code uses it on purpose), unused vars as warnings, `prefer-const` with `destructuring: 'all'`. Fixed the 9 errors:
   - 2 `prefer-const` (`userPoints.controller`);
   - 4 justified one-line disables: the Anna router `require`, `pdfkit` `require`, the existing async Promise executor in `pdf.service`, and the `Express` namespace augmentation;
   - unused imports removed: `membership.controller`, `userPoints.controller`, `webhook.controller` (also an unused `stripe.service` import), `business.service`, `workShift.service`.
3. **`infra/aws/README.md`:**
   - The intro and architecture diagram are updated for all pieces.
   - The "Qué cambió en el código" table was **broken in two places** (blank lines split it, so 17 rows rendered as plain text). It's rebuilt with 27 rows covering every change (P0–P6, security fixes, error handler, scripts, `lab.sh`).
   - *Uso* lists the new `lab.sh` commands.
   - The workers demo reflects the new age-based alarm.
   - It links to the runbook.
4. **`terraform.tfvars.example`:** all **42** variables, grouped by area, with comments. The values shown are the real defaults (checked against `variables.tf` with a script).
5. **Fixes found while writing the runbook:**
   - `frontend.tf`: `frontend_dir` now accepts an **absolute** path (before, it was always prefixed with `infra/aws/`, so `/home/luis/rew_hub/rew_hub_front/RewardsHubFront` would break).
   - `.gitignore`: `.env.*` (except `.env.example`), so a `.env.lab` is never committed.
   - `artifact.tf`: `.env.lab` is excluded from the app zip (it travels only as `env_file`).
6. **`docs/LAB-RUNBOOK.md`** (new, Spanish): blocks A–G with exact commands, a ⚪ without-lab / 🟢 with-lab mark and a time estimate per block. It replaces the [MANUAL] lists above as the operational guide.
   - The DynamoDB probe runs **on an instance via SSM** (no SSH), using CLI shorthand so there's no quoting inside SSM.
   - Times are based on what each step does, not measured.

# Lab deployment — 2026-11-21 (AWS Academy Learner Lab, us-east-1)

## Preflight
- node v22.23.5 (nvm), Terraform 1.16.1, aws-cli 2.36.25; profile `academy` valid (`voclabs` assumed role).
- `.env.lab` sets only `MONGO_URI`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `NODE_ENV` (no Stripe/Firebase/email/S3). Permissions were 644 → **`chmod 600`**. No `.env` in the repo.
- `terraform.tfvars`: `env_file = "../../.env.lab"` ✅.
- **Existing state found:** a previous partial apply (50 resources): ALB, ASGs (2 API healthy, 2 workers), SQS, WAF, ElastiCache `rewardshub-redis` available, Grafana instance running, `daily-stats`/`reconcile` rules. No DynamoDB tables. `/health` 200 through the ALB.
- The previous `.env` object in the bucket had a different md5 (`024b…`) from today's `.env.lab` (`97b0…`). It was replaced (and deleted) by the first apply.
- **How the stages are applied:** CLAUDE.md still says "never edit `terraform.tfvars`", so the user's file is untouched. Stages go in `infra/aws/staging.auto.tfvars`, which Terraform loads automatically and which wins over `terraform.tfvars`. It's git-ignored via `*.auto.tfvars` in `infra/aws/.gitignore`.

## Probes (P4.0 / P5.0)
- **ElastiCache:** `rh-probe` `cache.t3.micro` → `available` in 199 s (Redis 7.1.0) → deleted. ✅ → `redis_mode = "elasticache"`.
- **DynamoDB + CloudWatch**, from API instance `i-0be1cba7b01180fd7` via SSM with LabRole: `DDB_PUT_OK`, `DDB_GET_OK`, `CW_PUT_OK`, `CW_READ_OK`. Probe table deleted (`table-not-exists`). ✅ → `enable_dynamo = true`, `enable_app_metrics = true`, Grafana viable.
- Results recorded in `infra/aws/README.md` → *Limitaciones*.

## Stage 0 — base (all new flags off)
- `staging.auto.tfvars`: `geo_query_mode = "legacy"`, `stats_source = "live"`, `daily_stats_schedule = ""`, `reconcile_schedule = ""`, `redis_mode = "off"`, `enable_rate_limits = false`, `enable_dynamo = false`, `enable_grafana = false`, `enable_app_metrics = false`.
- Plan reviewed (2 add, 5 change, 13 destroy: ElastiCache, Grafana, 2 new rules, their SGs). Launch-template user data had only `PORT TZ TRUST_PROXY SQS_* DB_NAME MONGO_MAX_POOL_SIZE`. Applied the saved plan: `Apply complete! 2 added, 5 changed, 13 destroyed`.
- Seed: the guard refuses `DB_NAME=rewardshub` (exit 1). `rewardshub_lab` already had seed data from an earlier session (`⛔ La base ya tiene datos del seed`). Kept it. The geo dry run reports 0 of 50 businesses missing `geo`.
- **Roll:** `./lab.sh roll` finished, but **the lab session ended mid-roll**. AWS calls returned `AccessDenied … explicit deny … voc-cancel-cred` (the Learner Lab revokes credentials when a session ends). The instances stopped, and the new session brought the ASGs back (`capacity from 0 to 3`).
  - Credentials checked valid again (3 × `DescribeTargetHealth` OK) before continuing.
  - Result: API 2/2 healthy and workers 3/3 InService, all on launch-template v3; `/health` 200.
  - Logs: `Connected to MongoDB`, `📨 [Queue] SQS activa…`, `👷 [Worker] … escuchando …`. Only the known `uuid` `require()` ExperimentalWarning.
- **🐛 Issue found → fixed (`infra/aws/lab.sh`):** when the ALB health query failed, `roll` didn't stop. `[ "" -ge 2 ]` → `integer expression expected`, and it kept terminating the remaining instances without waiting for replacements. It now aborts with "No se pudo leer la salud del ALB … revisa las credenciales". `bash -n` OK.
- **Concurrency demo** (`scripts/load/concurrent-redeem.ts` → ALB, 2 API instances):
  - 20 × 10 on 891 → 20 × 200, final 691 (expected 691) ✅;
  - 30 × 40 on 773 → **19 × 200 + 11 × 400**, final **13** (expected 13) ✅.
- **Idempotency demo** (`--same-key`, 20 × 10) → **1 applied + 19 replays**, final 681 (expected 681) ✅.

## Stage a — `geo_query_mode = "geo"` ✅
- Geo backfill on the lab DB: `migrate-locations-geo.ts --apply` → `50 negocios revisados, 0 con 0 sucursales sin geo` (the seed already had `geo`).
- Legacy baseline captured first, through the ALB: 9 queries (`/nearby` GDL 10 km / 3 km, CDMX 8 km, GDL 600 km; `/in-bounds` GDL, CDMX, world; `/all` with and without coordinates).
- Plan: only the launch templates (`GEO_QUERY_MODE=geo`) + app zip. Apply OK; `./lab.sh roll` OK (new instances healthy in ~3 min, LT v4). `/etc/rewardshub.env` on an API instance: `GEO_QUERY_MODE=geo`.
- **Comparison: 9/9 responses identical** to legacy (same rows and order for nearby/all; same branch set for in-bounds), counts 17…101.
- Atlas `explain` of the `$geoNear`: stages `GEO_NEAR_2DSPHERE` + `FETCH` on index `locations.geo_2dsphere` ✅.

## Stage b — `daily-stats` + `reconcile-balances` + `stats_source = "daily"` ✅
- `./lab.sh enqueue daily-stats '{"from":"2026-08-17","to":"2026-11-20"}'` → the worker split it into **14 weekly jobs**, processed by 3 workers in ~4.5 min (each 33–116 s, 425–1050 rows). No failures; **DLQ 0**.
  - `daily_stats` now has **4800 business rows (50 × 96 days)** + 8920 branch rows, from 2026-08-17 to 2026-11-20.
- `./lab.sh enqueue reconcile-balances` → `checked: 16328, mismatchCount: 0, orphanRewardCount: 0`. This ran **after** the concurrency demos, which proves the atomic writes kept balances == ledger under real concurrent traffic.
- Live stats baseline captured through the ALB: 5 businesses × {timeseries 30 / 90, kpi 7 / 30, branch-comparison 30} = 25 responses, using cashier-login tokens.
- Plan: 4 new resources (the 2 EventBridge rules + targets), launch templates with `STATS_SOURCE=daily`, queue policy updated for the new rule ARNs. Apply + roll OK (LT v5).
- **25/25 API responses identical** to the live baseline. `compare-stats-sources` (read-only, TZ=UTC): **10/10 businesses ✅ live == daily**.
- On the instance: `TZ=UTC`, `GEO_QUERY_MODE=geo`, `STATS_SOURCE=daily`. Rules `rewardshub-daily-stats` `cron(15 6 * * ? *)` and `rewardshub-reconcile-balances` `cron(30 7 * * ? *)` ENABLED.

## Stage c — Redis (ElastiCache) + rate limits ✅ (one issue found and fixed)
- `redis_mode = "elasticache"`, `enable_rate_limits = true`. Plan: Redis SG + subnet group + cluster, and launch templates with `REDIS_URL`, `CACHE_BIZMAP_TTL`, `RATE_LIMITS=on`. Apply OK (cluster in 3m14s); roll OK; Redis `available` in `./lab.sh status`.
- **Map cache:** after the first request per instance → `MISS`, then `HIT` × 10.
  - Latitude-only jitter (20.6599) → `HIT`.
  - Rename a branch → next request `MISS`, and the response **already shows the new name**; restoring it → `MISS`, old name back. Tested at the branch's own coordinates (negocio01 is in CDMX).
  - A PUT with identical values doesn't invalidate. That's correct: Mongoose sees no modified path.
- **Shared rate limit:** 20 bad `/auth/login` through the ALB (2 API instances) → **exactly 10 × 401, then 10 × 429**. The 429 carries `Retry-After: 897`, `RateLimit-Policy: 10;w=900` and the JSON body.
- **🐛 Issue → fixed: first request per instance was `BYPASS`.** Both API logs showed `⚠️ [Redis] versión del mapa: Stream isn't writeable and enableOfflineQueue options is false`. The ioredis client was created lazily by the first request, which ran before the connection was ready, and with `enableOfflineQueue: false` it fails instantly. Failing open worked, but every instance started with a cache bypass and in-memory rate limiting.
  - **Fix:** `warmUpRedis()` in `src/cache/redis.ts` opens the connection at API startup and waits up to 2 s for `ready` (never throws; logs and continues if Redis is down). Called in `src/index.ts` before `app.listen`.
  - Test: `tests/cache.redisWarmup.test.ts` (4). It's deployed with stage d and re-verified there.
- **Operational note, documented in the runbook:** `/auth/cashier-login` shares the `login` bucket with `/auth/login`, so the brute-force demo blocks cashier logins from that IP for 15 min. Cleared the lab Redis keys via SSM (`rl:login:*`, 1 key) to continue. The runbook now says to do that demo last and shows how to clear the counter.
- Runbook fix: its jitter example moved the longitude too (`-103.3494`, a different bucket → `MISS`); now latitude only. It also now says that an edit must change something to invalidate.
- Local: `npm run typecheck` ✅; `npm test` ✅ 33/33 suites, 363/363 tests.

## Stage d — DynamoDB replica + `stats_source = "dynamo"` ✅ (one issue fixed)
- Plan: `aws_dynamodb_table.daily_stats` / `.transactions` (GSI `byShift`, `PAY_PER_REQUEST`), the `replicate-dynamo` rule `rate(10 minutes)`, and launch templates with `STATS_SOURCE=dynamo` + `DDB_*`. Apply + roll OK.
- **Redis warm-up fix verified:** the first requests after the roll were `MISS, HIT, HIT, HIT` (no `BYPASS`), and the API logs had no Redis warnings.
- **Replication** (fired by EventBridge at 21:24): `daily_stats` 13 720 rows (= 4800 + 8920) in 28 pages; `transactions` **50 041** (50 000 seeded + 41 from the demos) in 101 pages. 33 s total, both `caughtUp: true`, lag 25 s.
- **Stats via the API** (served from DynamoDB): **25/25 identical** to the live baseline. Every response carries **`X-Data-Freshness: 2026-11-21T21:25:02.122Z`**, which is only set when DynamoDB served it (a fallback to Mongo omits it).
- `compare-stats-sources` (TZ=UTC, `DDB_AWS_PROFILE=academy`, read-only): **10/10 businesses ✅ live == daily == dynamo** (replica as of 21:26:05).
- **Reports** (`generateReportData`, 30 days, 3 businesses, Mongo vs `STATS_SOURCE=dynamo`): **identical** (31 days; 312–448 transactions each). The seed has no work shifts, so the `byShift` GSI path is covered only by the local tests.
- `./lab.sh status` → `daily_stats: al día hasta … (retraso 2 min 6 s)`, `transactions: … (retraso 2 min 8 s)`.
- **🐛 Issue → fixed (`infra/aws/lab.sh`):** `./lab.sh enqueue replicate-dynamo` → `❌ Tipo desconocido`. The P5 job type was missing from lab.sh's allow-list. Added, plus an example line; it now sends `{"type":"replicate-dynamo",…}` → MessageId.
- Note: `aws dynamodb describe-table` shows `ItemCount 0`. DynamoDB refreshes that approximation only about every 6 h, so it's not a problem.

## Stage e — app metrics + Grafana ✅ (two issues found and fixed)
- `enable_app_metrics = true`, `enable_grafana = true` (`admin_cidr` from `terraform.tfvars` = current public IP/32, checked). Plan: Grafana SG + `t3.micro` + dashboard object + `random_password`; ASGs gain `enabled_metrics`; the launch templates gain `METRICS_ENABLED`. Apply + roll OK.
  - API logs: `📈 [Metrics] Publicando en CloudWatch (RewardsHub, Role=api) cada 60 s` on both instances.
- **🐛 Issue 1 → fixed: Grafana never started.** Port 3000 refused connections; `grafana-server` was `inactive`. Via SSM, `/var/log/cloud-init-output.log` showed `line 18: 1655 Killed  dnf install -y grafana`: an OOM kill on the 1 GB t3.micro while dnf loaded the ~86 MB Grafana repo metadata plus Amazon Linux's.
  - Fix in `infra/aws/user_data_grafana.sh.tftpl`: create 1 GB of swap (idempotent; `/etc/fstab`) before installing, and `--setopt=install_weak_deps=False`. Kept t3.micro (budget).
  - Instance replaced: **Grafana 13.3.1 healthy after ~150 s**.
- **🐛 Issue 2 → fixed: the "Caché del mapa: % de aciertos" panel returned HTTP 500.** The Grafana log said `error parsing query "C", query must have either statistic or statistics field`. The metric-math query also referenced refIds (`A`, `B`), but CloudWatch math references the queries' `id`s, which were empty.
  - Fix in `grafana/dashboards/rewardshub-lab.json`: ids `hits` / `misses`, expression `100 * hits / (hits + misses)`, `statistic: "Sum"`.
  - New test in `tests/grafana.dashboard.test.ts`: every metric-math query has a statistic and references only existing ids.
  - Redeployed (instance replaced; up in ~150 s).
- **Verified through the Grafana HTTP API** (`/api/ds/query` with every panel's targets, last 3 h):
  - datasource `CloudWatch` (`authType: default`, us-east-1); dashboard *RewardsHub · Lab* in folder RewardsHub, no leftover `__MARCADORES__`, every constant filled with real names; anonymous viewer → 200.
  - **21/21 panels answer without errors; 18 have data**: ALB requests, p50/p95, 5xx, healthy targets, in-service instances, CPU, queue, message age, DLQ, ElastiCache CPU / connections / hits-misses, DynamoDB consumed capacity, reconciliation, replication lag, Idempotency-Key, cache % (~91–92 %), app 429s.
  - The 3 empty panels are correctly empty: WAF blocks, DynamoDB throttles, `BYPASS`.
  - Traffic used: 140 map requests, a same-key idempotency demo (1 applied + 19 replays, balance exact), `reconcile-balances`, `replicate-dynamo`, and 12 bad logins (10 × 401 + 2 × 429; the lab's `rl:login:*` counter was cleared afterwards via SSM).
- ALB 5xx: 9 × `HTTPCode_ELB_502` in 3 h, around the rolls; `HTTPCode_Target_5XX` = 0, so the app returned no 5xx. Instances close in-flight connections while being replaced. Minor and not fixed; it could be tuned with the target group's `deregistration_delay` and a graceful shutdown on `SIGTERM`.

## Workers — scaling and DLQ ✅ (with a note)
- **Scale-in:** the `jobs-empty` alarm fired the `rewardshub-worker-scale-in` policy, desired capacity **3 → 2 → 1** (21:12 and 21:18).
- **Scale-out:** re-enqueued the 95-day `daily-stats` backfill (idempotent; 14 chunks). One worker drained it in ~5 min (15 `terminado`). `jobs-backlog` went to **ALARM at 22:00 → desired 1 → 2**, after the queue was already empty.
  - SQS metrics reach CloudWatch with a delay, and the alarm needs 2 periods above 120 s, so scale-out lags bursts this short. It works, but a convincing demo needs a longer backlog. Documented in the README; the threshold was not changed.
- **DLQ:** the redrive policy is `maxReceiveCount: 5` → `rewardshub-jobs-dlq`, visibility 900 s.
  - An invalid message (`{"type":"no-existe",…}`) was **discarded** with `⚠️ Mensaje inválido, se descarta`, not retried, so it never reaches the DLQ. That's by design.
  - `./lab.sh dlq` → empty; DLQ attributes 0/0.
  - A real DLQ arrival (5 failures × 900 s ≈ 75 min) was not forced. It's covered by `tests/queue.processor.test.ts` (failure → retry, lock released).
- Runbook F fix: the cleanup check now filters instances by `tag:Name=rewardshub*`; ASG instances have no `Project` tag. Verified it lists all 5 instances.
- Local: `npm run typecheck` ✅ · `npm run lint` 0 errors (6 old warnings) · `npm test` ✅ 33 suites / 364 tests.

## Final state of the lab (2026-11-21 ~22:05 UTC)
Every flag is ON through `infra/aws/staging.auto.tfvars` (git-ignored; it **wins over** `terraform.tfvars`): `geo_query_mode=geo`, `stats_source=dynamo`, `daily_stats_schedule` / `reconcile_schedule` set, `redis_mode=elasticache`, `enable_rate_limits`, `enable_dynamo`, `enable_app_metrics`, `enable_grafana`. Note that `terraform.tfvars` itself still says `stats_source = "live"` and `enable_app_metrics = false`.
