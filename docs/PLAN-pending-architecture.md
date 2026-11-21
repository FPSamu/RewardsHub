# RewardsHub — Implementation plan for the pending architecture pieces

> **Audience:** Claude Code (and the team) working on branch `sistemas-escalables`.
> **Scope:** everything marked *Pendiente* in the architecture diagram (state as of 19 Nov 2026), plus one prerequisite the diagram flags in red.
> **Target environment:** AWS Academy **Learner Lab** (`us-east-1`, profile `academy`). Production stays on Render — nothing here may touch it.

---

## 0. How to use this plan with Claude Code

1. Copy this file to `docs/PLAN-pending-architecture.md` and the companion `CLAUDE.md` to the repo root (Claude Code loads `CLAUDE.md` automatically every session, so the lab constraints are always in context).
2. Work **one task ID at a time** (e.g. `P1.2`). Start each session in plan mode (Shift+Tab) so you can approve the approach before files change.
3. Suggested prompt per task:
   ```
   Read docs/PLAN-pending-architecture.md. Implement task P1.2 only.
   Respect the Guardrails section. Write/adjust the tests listed under "Done when",
   run `npm run typecheck` and `npm test`, then stop and summarize what changed
   and what I must run manually in the lab.
   ```
4. Claude Code may run only `terraform fmt` and `terraform init -backend=false && terraform validate` (CLAUDE.md: `plan` contacts AWS, so you run it). **Only you** run `./lab.sh up | down | roll` (it spends lab budget and needs fresh session credentials).
5. **No git operations.** Claude Code only edits files in the working tree; it never runs `git commit`, `git push`, creates branches or opens PRs. You review the diff yourself.

---

## 1. Inventory: what is pending

| ID | Diagram piece | Diagram status | Infra? | Code? | Depends on |
|---|---|---|---|---|---|
| **P0** | MongoDB Atlas — *"el lab usa la misma base que producción"* | ⚠️ red warning | small | small | — |
| **P1** | Escrituras atómicas (Idempotency-Key, `$inc` condicional, transacciones, Stripe por `event.id`) | sin asignar | — | yes | P0 |
| **P2** | `daily_stats` + índice `2dsphere` en branches | sin asignar | — | yes | P0 |
| **P3** | Trabajos nuevos del worker (conciliación de saldos, agregados `daily_stats`) | sin asignar | EventBridge rules | yes | P1, P2 |
| **P4** | Redis (ElastiCache): caché del mapa de negocios + rate limits compartidos | equipo | yes | yes | P0 |
| **P5** | DynamoDB / réplica: lecturas pesadas, stats, reportes | equipo | yes | yes | P2, P3 |
| **P6** | Grafana sobre CloudWatch | equipo | yes | dashboards | best after P4/P5 |
| — | HTTPS / CloudFront | bloqueado por el lab | — | — | **out of scope** (SCP denies CloudFront; no domain/cert) |

**Two tracks can run in parallel after P0:**
- **Track A (code, unassigned):** P1 → P2 → P3
- **Track B (infra, team):** P4 and P6 independently; P5 after P2.3 + P3.

```
P0 ──┬── P1 ── P2 ── P3 ──┐
     │                    ├── P5 ── (P6 panels for P5)
     ├── P4 ──────────────┤
     └── P6 (base) ───────┘
```

---

## 2. AWS Academy Learner Lab constraints (design rules for every task)

These are already proven in `infra/aws/` and must be respected by every new resource:

1. **No IAM role/policy creation.** EC2 uses the existing `LabInstanceProfile` (`LabRole`). Services that need to call other services use **resource policies** (e.g. EventBridge → SQS via the queue policy) instead of roles.
   - New AWS SDK clients in the app (DynamoDB, CloudWatch) must use the **same credential strategy as `src/queue/sqs.ts`**: `fromIni({ profile })` when a `*_AWS_PROFILE` env var is set, otherwise `fromInstanceMetadata()`. Never the default chain — the `.env` carries `AWS_ACCESS_KEY_ID/SECRET` for a *different* account (S3 uploads).
2. **Region:** `us-east-1` only (`us-west-2` also allowed, not used).
3. **SCP denials already hit:** `s3:GetBucketObjectLockConfiguration` (create buckets via CloudFormation, see `artifact.tf`), `autoscaling:StartInstanceRefresh` (use `./lab.sh roll`), CloudFront (blocked entirely).
4. **Managed services that depend on IAM Identity Center / service roles are likely unavailable** → Amazon Managed Grafana is out; self-host Grafana on EC2 (P6).
5. **Service availability is not guaranteed per service** — ElastiCache and DynamoDB must be probed first (P4.0, P5.0) and every new piece needs an **`enable_*` / `*_mode` Terraform variable** with a fallback or "off" path, like `enable_waf` today.
6. **Small instance types only** (nano/micro/small/medium). Keep `t3.small` for app instances, `t3.micro` / `cache.t3.micro` for support services.
7. **Budget & instance caps:** the lab has a fixed credit and caps concurrent instances/vCPUs (check the *Readme* panel in your Learner Lab). Worst case after this plan: API 4 + workers 3 + Grafana 1 (+ Redis-on-EC2 fallback 1) = 9 instances. Lower `api_max`/`worker_max` if you hit the cap. **Always `./lab.sh down` when done.**
8. **Credentials rotate every session (~4 h).** Terraform state is local (`infra/aws/terraform.tfstate`). EC2 instances are stopped when the session ends and restarted at the next *Start Lab* → **public IPs change** (matters for Grafana, P6).
9. **HTTP only** (no cert/domain). Stripe webhooks cannot reach the ALB → Stripe work (P1.4) is verified with unit tests and `stripe trigger` against local/Render, not in the lab.
10. **No NAT gateway** — instances live in public subnets with public IPs and locked-down SGs. New services (Redis, Grafana) follow the same pattern: SG ingress only from the API/worker SGs or from `var.admin_cidr`.

---

## 3. Guardrails (apply to every task)

- **Feature flags, not forks.** Every new behaviour is gated by an env var and is a no-op when unset — exactly like `SQS_QUEUE_URL` today. Local dev and Render must keep working with today's `.env`.
- **Never write to the production database.** Any script that mutates data calls `assertNonProductionDb()` (P0.3) first.
- **Response contracts don't change** (web + both mobile apps consume them). Add fields; never rename/remove. `tests/business.nearby.test.ts` is the model: pin the contract with a test before refactoring.
- **AWS-specific env vars go in `/etc/rewardshub.env`** (rendered by `infra/aws/user_data.sh.tftpl`), never in the shared `.env`. systemd injects them before dotenv, so they win.
- **Match repo conventions:** TypeScript, services/controllers/models split, comments and infra docs in Spanish like the existing code, tests with Jest + supertest + `mongodb-memory-server`.
- Every Terraform change: `terraform fmt && terraform init -backend=false && terraform validate` before handing over; the human runs `terraform plan`.
- Update `infra/aws/README.md` ("Qué cambió en el código", "Demostraciones", "Limitaciones") in the same PR as the change.
- No `git commit` / `push` / branch creation. Never edit or print the contents of `.env`, `terraform.tfvars`, `*.tfstate`.

---

## P0 — Isolate the lab database (prerequisite)

**Why:** the diagram warns that the lab instances use the production MongoDB. P1–P3 add indexes, migrations, backfills and a reconciliation job; P3 load tests write data. None of that may hit production.

### P0.1 Separate database name for the lab
- `infra/aws/variables.tf`: add `lab_db_name` (default `"rewardshub_lab"`).
- `infra/aws/compute.tf` → `local.common_user_data`: pass `db_name`.
- `infra/aws/user_data.sh.tftpl`: add `DB_NAME=${db_name}` to `/etc/rewardshub.env`. (`src/db/mongoose.ts` already passes `dbName` to `mongoose.connect`, which overrides the DB in `MONGO_URI`.)
- Check the `.env` collection overrides (`USER_COLLECTION`, `BUSINESSES_COLLECTION`, …) — they're collection names, so a different `DB_NAME` is enough.

### P0.2 Connection pool sizing
- `src/db/mongoose.ts`: read `MONGO_MAX_POOL_SIZE` (default unchanged when unset). Set it to `20` in `/etc/rewardshub.env`. With up to 7 app processes, the driver default (100/process) can exceed the connection limit of shared-tier Atlas clusters.

### P0.3 Safety helper + seed data
- `src/db/safety.ts`: `assertNonProductionDb()` — throws unless the active DB name matches `/(_lab|_test|test)$/` or `ALLOW_DB_WRITES=I_KNOW` is set.
- `scripts/seed-lab.ts` (`npm run seed:lab`): synthetic, no real PII. ~50 businesses with 1–3 branches around Guadalajara/CDMX, points + stamps systems, rewards, ~2k users, ~50k transactions spread over 90 days, consistent `userpoints` balances (derived from the generated transactions so P3 reconciliation starts at 0 mismatches). Idempotent (`--reset` drops lab collections first).

**Done when**
- `./lab.sh up` → instances log `Connected to MongoDB` and Atlas shows writes only in `rewardshub_lab`.
- `npm run seed:lab` refuses to run against the production DB name.

### P0.4 Stop leaking secrets in business responses
Found while mapping the code: `business.service.toPublic` includes `passHash` and `branchPassHash`, and some handlers send it straight to clients.
- Add a public DTO for client responses (`toPublicResponse` in `business.service.ts`) and use it in `GET /business/all` (no coordinates), `POST /business/locations`, `PUT /business/locations/:locationId`, `DELETE /business/locations/:locationId` and the unmounted `getBusinessesByCategory`. Keep the raw `toPublic` for internal use (`req.business`, auth).
- `updateBusiness` / `uploadLogo` already pick fields by hand: keep their exact shape (key `name`).
- `POST /business/admin-pin/generate`: secret-only. `403` when `ADMIN_SECRET` is unset or `x-admin-secret` doesn't match (today it is open when `ADMIN_SECRET` is unset). Nothing in the frontend calls it; businesses use `/reset`.
- `GET /auth/:id`: requires `authenticate`. Returns the user only to that same user, or to a business that has a `UserPoints.businessPoints` entry or a transaction with that user; otherwise `404`. Shape unchanged: `{id, username, email, profilePicture, createdAt}`.
- **Done when:** tests prove none of these responses contain `passHash`, `branchPassHash`, `adminPinHash`, `refreshTokens`, `rotatedRefreshTokens`, `verificationToken`, `resetPasswordToken`, `resetPasswordExpires`; admin-pin and `/auth/:id` access rules are covered.

### P0.5 Green test baseline
- `tests/auth.user.test.ts` / `tests/auth.business.test.ts` need a real `TEST_MONGO_URI` and call routes that no longer exist (`/business/register`, `/business/login`, email/password `/auth/register`). Rewrite them on `MongoMemoryServer`, mocking `../src/services/firebase.service` and `stripe`, against the real `/auth/register` + `/auth/login` (Firebase `idToken` + `role`).
- Fallback only if a suite can't be salvaged: move it to `tests/legacy/` and add `testPathIgnorePatterns` in `jest.config.cjs`.

### P0.6 JSON 404 + error handler
- `src/app.ts` has neither; `next(err)` (delivery controller, CORS rejection, invalid JSON) falls into Express's HTML handler. Add at the end of `app.ts`: JSON `404 { message: 'not found' }` and an error handler that preserves `err.status` / `err.statusCode` (e.g. `400` for invalid JSON) and answers `500 { message }` otherwise.

---

## P1 — Atomic writes (Escrituras atómicas)

**Problem today** (`src/services/userPoints.service.ts`, `src/controllers/*.ts`):
- `addPointsAndStamps` / `subtractPointsAndStamps` do **read → modify in JS → `save()`**. Two cashiers (or two API instances behind the ALB) updating the same user lose an update; two concurrent subtracts can both pass the balance check.
- Points update and `Transaction` insert are separate writes → a crash between them leaves balances and history out of sync.
- A client retry after a timeout (common on mobile + ALB) adds points twice.
- `delivery.controller.claimCode` checks `isRedeemed` then sets it at the very end → a code can be claimed twice concurrently.
- `membership.controller.redeemDailyBenefit` has the same check-then-set race.
- The Stripe webhook has no dedupe by `event.id` (Stripe delivers at-least-once).

### P1.1 Transaction helper + replica-set tests
- `src/db/withTransaction.ts`: `withTransaction(fn: (session) => Promise<T>)` built on `mongoose.connection.transaction()` (retries `TransientTransactionError` / `UnknownTransactionCommitResult`). Atlas is a replica set, so transactions work there.
- `tests/helpers/replset.ts`: start a `MongoMemoryReplSet` (single node) — transactions do **not** work on the standalone `MongoMemoryServer` used today. Existing tests keep their current setup.

### P1.2 Conditional `$inc` in `userPoints.service`
Rewrite both functions as atomic updates (all with `{ session }`):
1. **Ensure structure exists** (idempotent, cheap):
   - `updateOne({ userId }, { $setOnInsert: { userId, businessPoints: [] } }, { upsert: true })`
   - `updateOne({ userId, 'businessPoints.businessId': { $ne: biz } }, { $push: { businessPoints: { businessId: biz, points: 0, stamps: 0, lastVisit: now, rewardSystems: [] } } })`
   - per reward system: `updateOne({ userId, businessPoints: { $elemMatch: { businessId: biz, 'rewardSystems.rewardSystemId': { $ne: rs } } } }, { $push: { 'businessPoints.$[bp].rewardSystems': { rewardSystemId: rs, points: 0, stamps: 0, lastUpdated: now } } }, { arrayFilters: [{ 'bp.businessId': biz }] })`
2. **Add:** one `updateOne` with `$inc` on `businessPoints.$[bp].points|stamps` and `businessPoints.$[bp].rewardSystems.$[rsN].points|stamps` (one array filter identifier per system: `rs0`, `rs1`, …), plus `$set` of `lastVisit` / `lastUpdated`.
3. **Subtract (conditional):** same `$inc` with negative values, **and the filter enforces sufficient balance** — `$and` of one `businessPoints: { $elemMatch: { businessId: biz, rewardSystems: { $elemMatch: { rewardSystemId: rs, points: { $gte: n } } } } }` clause per system. `matchedCount === 0` → re-read once to build the same error messages as today (`Insufficient points…`, `User has no stamps in reward system…`).
4. Keep the exported signatures and `PublicUserPoints` return shape (read the doc back with the session at the end).
- Note: `min: 0` schema validators don't run on `$inc`; the filter is the guard. Add a unit test proving balances never go negative.

### P1.3 Wrap each business operation in one transaction
- `userPoints.controller.addPointsOrStamps` / `subtractPointsOrStamps`: points update + `transactionService.createTransaction(..., { session })` inside `withTransaction`. Add an optional `session` param to `createTransaction` (and to the work-shift lookup it calls).
- `delivery.controller.claimCode`: **first** statement in the transaction is
  `findOneAndUpdate({ code, isRedeemed: false, expiresAt: { $gt: now } }, { $set: { isRedeemed: true, redeemedBy, redeemedAt: now } }, { session, new: true })` → `null` ⇒ re-read to answer `404` / `409 already redeemed` / `400 expired` exactly as today. Then points + transaction.
- `membership.controller.redeemDailyBenefit`: single conditional `findOneAndUpdate` (`status: 'active'`, `endDate >= now`, and `lastRedeemedDate` null **or** `< start of today UTC`). No match ⇒ re-read to choose between 404 / 409 expired / 409 already redeemed today. Also fix `lastRedeemedBusinessName` (today always `null` because the `Business` DTO has no `name`) → `business.username`.
- `membership.controller.activateMembership`: check-then-create race. Add a **partial unique index** `{ userId: 1, planId: 1 }` with `partialFilterExpression: { status: 'active' }` and map duplicate key `11000` to the existing `409`. Before the index can build on a real DB, duplicates must be gone → `scripts/find-duplicate-memberships.ts` (**read-only**, lists duplicate active memberships; a human runs it and resolves them).
- Neither membership handler has a try/catch today; with P0.6 errors become JSON 500s. Branch resolution (`resolveBranchId`) in `userPoints.controller` moves **before** the points update so a branch error can't leave points without a transaction.

### P1.4 Idempotency-Key middleware
- Model `src/models/idempotencyKey.model.ts`: `{ scope, key, requestHash, status: 'in_progress' | 'completed', responseStatus, responseBody, createdAt }`, unique index `{ scope: 1, key: 1 }`, TTL 24 h on `createdAt`. `scope` = `${actorId}:${method}:${route}`; `requestHash` = sha256 of the canonical JSON body.
- `src/middleware/idempotency.middleware.ts`:
  - header absent → pass through (backward compatible with installed app versions); log a counter. `IDEMPOTENCY_REQUIRED=true` makes it `400`.
  - insert `in_progress`; on duplicate key: `completed` + same hash → replay stored status/body with header `Idempotent-Replayed: true`; different hash → `422`; still `in_progress` → `409` + `Retry-After: 1`.
  - on response: store body if status < 500; on 5xx/thrown error delete the record so the client can retry.
- Apply to: `POST /user-points/add`, `POST /user-points/subtract`, `POST /delivery/claim`, `POST /memberships/activate`, `POST /memberships/redeem`.
- `src/app.ts`: add `Idempotency-Key` to CORS `allowedHeaders` and `Idempotent-Replayed` to `exposedHeaders`.
- Update `RewardsHub_API.postman_collection.json` (`Idempotency-Key: {{$guid}}`). Note for the front/mobile teams: generate one UUID per scan/redeem action and reuse it on retries.

### P1.5 Stripe webhook dedupe by `event.id`
- Model `src/models/stripeEvent.model.ts`: `_id = event.id`, `type`, `status: 'processing' | 'processed'`, `receivedAt`, `processedAt`; TTL 30 days.
- `webhook.controller.handleStripeWebhook` after signature check: insert `processing`; duplicate + `processed` → `200 { received: true, duplicate: true }`; duplicate + `processing` younger than 5 min → `409` (Stripe retries); older → take over. Failure → delete record, `500`.
- Out-of-order protection: store `lastStripeEventAt` on the subscription and ignore `customer.subscription.updated` events with `event.created` older than it.
- `subscription.model.ts`: `stripeSubscriptionId` is `sparse` but has no index, and `updateSubscriptionStatus` looks it up on every event → add `subscriptionSchema.index({ stripeSubscriptionId: 1 }, { sparse: true })`.
- Verified with unit tests + `stripe trigger` locally/Render (the lab ALB is HTTP — see constraint 9).

### P1.6 Tests (`tests/atomic.*.test.ts`, on the replica set helper)
- 20 parallel `subtract 10` on a balance of 100 → exactly 10 succeed (`200`), 10 fail (`400 Insufficient…`), final balance 0, exactly 10 `subtract` transactions.
- 50 parallel `add` → final balance equals the sum, 50 transactions.
- 5 parallel requests with the same `Idempotency-Key` → 1 transaction; the others `409` or replay.
- Same key, different body → `422`.
- 2 parallel `claimCode` with the same code → one `200`, one `409`.
- Simulated failure after the points update (mock `createTransaction` to throw) → balance unchanged (rollback).
- Same Stripe `event.id` twice → handler side effects run once.
- Existing suites still green.

### P1.7 Lab demo
- `scripts/load/concurrent-redeem.ts`: fires N concurrent subtracts at the ALB URL for a seeded user and prints final balance vs expected. Add the scenario to *Demostraciones* in `infra/aws/README.md`.

---

## P2 — MongoDB: `2dsphere` on branches + `daily_stats`

### P2.1 GeoJSON on branch locations
- `src/models/business.model.ts` → `locationSchema`: add `geo: { type: { type: String, enum: ['Point'], default: 'Point' }, coordinates: [Number] }` (`[lng, lat]`). Keep `latitude` / `longitude` — the API returns them.
- `pre('validate')` hook on the location subdocument keeps `geo` in sync with `latitude`/`longitude`. All location writes go through `doc.save()` (`addBranch`, `updateLocation`, `removeBranch`), so the hook covers them — verify with a test.
- Index: `businessSchema.index({ 'locations.geo': '2dsphere' })`. Keep the old lat/lng index until P2.2 ships, then drop it.
- `scripts/migrate-locations-geo.ts`: backfill `geo` for existing docs, `--dry-run` default, idempotent, calls `assertNonProductionDb()` unless `--prod` is passed explicitly (to be run by a human against prod later, after Render is updated).

### P2.2 Rewrite the geo queries
- `findNearbyBusinesses`: `$geoNear` (`key: 'locations.geo'`, `maxDistance` in metres, `query: { isVerified: true, status: 'active' }`, `spherical: true`), then the existing per-branch expansion + `calculateDistance` filter + sort in JS. Add an optional `limit` (default 200) so the 5000 km "all" path is bounded.
- `findBusinessesInBounds`: `$geoWithin: { $geometry: Polygon }` built from the bounds (clamp lat to ±85, split if the box crosses the antimeridian).
- **Contract:** `tests/business.nearby.test.ts` must pass unchanged; add equivalent tests for `/in-bounds` and `/all` before changing them. `MongoMemoryServer` supports 2dsphere.

### P2.3 `daily_stats` collection
- Model `src/models/dailyStat.model.ts`:
  ```
  { businessId, branchId (null = whole business), day: 'YYYY-MM-DD' (UTC day),
    txCount, addCount, subtractCount, redeemCount,
    pointsAdded, stampsAdded, pointsRedeemed, stampsRedeemed,
    revenueWithPoints (sum purchaseAmount on type 'add' with totalPointsChange > 0 — getBusinessStats rule),
    revenueAllAdds (sum purchaseAmount on every 'add' — getTimeSeriesStats / getKpiSummary rule),
    newClients (users whose first-ever transaction with the business is that day),
    uniqueClients, computedAt }
  ```
  Unique index `{ businessId: 1, branchId: 1, day: 1 }`.
- **Days are UTC, not business timezone.** Today `getTimeSeriesStats` / `getKpiSummary` group by UTC day but start their window with `setHours(0)` in *server local* time; they only agree with UTC days if the server runs in UTC. `infra/aws/user_data.sh.tftpl` adds `TZ=UTC` to `/etc/rewardshub.env` (Render already runs in UTC). The two revenue rules differ today; storing both keeps every reader's numbers identical.
- Counting rules to reproduce: points/stamps/branch counts = `type:'add'` only; redemption = `type:'redeem'`; new client = `$min createdAt` of any type per (user, business).
- `src/services/dailyStats.service.ts`:
  - `computeDailyStats(businessId, day)` → aggregation over `transactions` grouped by `$dateToString` (UTC); written with **`bulkWrite` upserts** (portable on every Atlas tier; no `$merge` dependency).
  - `getDailyStats(businessId, from, to, branchId?)`.
- Readers (`businessStats.service.getTimeSeriesStats`, `getKpiSummary`, `getBranchComparison`): `STATS_SOURCE=daily` → closed days from `daily_stats` + today's partial computed live; unset/`live` → current code path. Nothing changes until the flag is flipped.
- Test: for seeded data, `daily` and `live` return identical numbers for the last 30 days, across 2 timezones.

---

## P3 — New worker jobs (Trabajos nuevos)

Reuse the existing pipeline: EventBridge → SQS → worker → `JobRun` lock → DLQ. No new infra besides EventBridge rules.

### P3.1 Extend the job protocol (backward compatible)
- `src/queue/jobs.ts`: add `'daily-stats'`, `'reconcile-balances'` (and later `'replicate-dynamo'`, P5) to `JOB_TYPES`. Optional `params` object in the message (e.g. `{ "day": "2026-11-18", "businessId": "…" }`), validated per type; `jobRunKey` appends a short hash of `params` when present. Old messages (no `params`) parse exactly as today.
- `src/worker.ts`: register handlers; handlers receive `params`. Update `JobHandlers` type and `tests/queue.processor.test.ts`.
- `infra/aws/scheduler.tf`: add to `local.scheduled_jobs` with new variables:
  - `daily_stats_schedule = "cron(15 6 * * ? *)"` (≈00:15 Mexico City). The job recomputes the **last 2 local days for every business** so all timezones are covered and late transactions are absorbed (upserts are idempotent).
  - `reconcile_schedule = "cron(30 7 * * ? *)"`.
  - The `input_template` stays `{type, scheduledAt}`.
- `infra/aws/lab.sh enqueue <type> [json-params]`.

### P3.2 `daily-stats` job — `src/jobs/dailyStats.job.ts`
- Iterates active businesses with a cursor, calls `computeDailyStats` per (business, day). Returns `{ businesses, rows, ms }` (stored in `JobRun.result`).
- `params.day` / `params.from..to` → backfill mode (`./lab.sh enqueue daily-stats '{"from":"2026-08-01","to":"2026-11-18"}'`). Large ranges are split into one message per week to stay well under the 15 min visibility (the heartbeat already extends it, but keep jobs small).

### P3.3 `reconcile-balances` job — `src/jobs/reconcile.job.ts`
Reconciles **balances vs. the ledger and rewards**:
1. Aggregate `transactions` → expected `(userId, businessId, rewardSystemId) → Σ pointsChange, Σ stampsChange`.
2. Stream `userpoints` and compare each `rewardSystems[]` entry; also check `businessPoints.points/stamps == Σ rewardSystems` and no negative values.
3. Flag `subtract`/`redeem` transactions whose `rewardId` no longer exists.
- Writes `src/models/reconciliationRun.model.ts` `{ runKey, checked, mismatchCount, sample: first 100 mismatches, startedAt, finishedAt }`.
- Publishes CloudWatch metric `RewardsHub/ReconciliationMismatches` (see P6.3) and logs a summary.
- **Report-only.** Fixing is a separate script `scripts/reconcile-fix.ts --run <runKey> --apply` that only a human runs, with `assertNonProductionDb()`.
- Expect mismatches on legacy production-like data (balances that predate the ledger); on `seed:lab` data it must report 0, and after manually corrupting one balance it must report exactly 1.

### P3.4 Tests
- Processor tests for the new types and `params` hashing.
- Job tests on `MongoMemoryReplSet` with a small seed: daily-stats idempotent (run twice → same rows), reconciliation detects an injected mismatch.

---

## P4 — Redis (ElastiCache): business-map cache + shared rate limits

### P4.0 Probe the lab first (≈10 min, manual)
In a lab session: `aws elasticache create-cache-cluster --cache-cluster-id rh-probe --engine redis --cache-node-type cache.t3.micro --num-cache-nodes 1 --profile academy` → wait for `available` → delete it. If it fails (SCP or service-linked role), use the EC2 fallback below. Record the result in `infra/aws/README.md` → *Limitaciones*.

### P4.1 Terraform — `infra/aws/redis.tf`
- `var.redis_mode = "elasticache" | "ec2" | "off"` (default `"off"` until the probe passes).
- `elasticache`: `aws_elasticache_subnet_group` (existing public subnets), `aws_security_group.redis` (6379 **only** from `aws_security_group.api` and `.worker`), `aws_elasticache_cluster` engine `redis` 7.x, `cache.t3.micro`, 1 node, no snapshots.
- `ec2` fallback: one `t3.micro` AL2023 instance (`dnf install -y valkey` or `redis6`), bind 0.0.0.0, `protected-mode no`, same SG; launch with `LabInstanceProfile`.
- Output `redis_endpoint`; `user_data.sh.tftpl` adds `REDIS_URL=redis://<endpoint>:6379` when mode ≠ off.
- `lab.sh status`: show Redis status/endpoint.

### P4.2 Client — `src/cache/redis.ts`
- `ioredis`, lazy singleton, `isCacheEnabled()` = `Boolean(REDIS_URL)`.
- Fail-open settings: `connectTimeout: 2000`, `commandTimeout: 200`, `maxRetriesPerRequest: 1`, `enableOfflineQueue: false`. Any cache error ⇒ log + fall through to Mongo. Redis down must never take the API down.
- Close on SIGTERM in `index.ts` / `worker.ts`.

### P4.3 Business-map cache (cache-aside)
- Endpoints: `GET /business/nearby`, `/business/in-bounds`, `/business/all`.
- Key: `bizmap:v{version}:{endpoint}:{quantized params}` — lat/lng rounded to 3 decimals (~110 m), radius and bounds rounded; TTL 120 s (`CACHE_BIZMAP_TTL`).
- Invalidation by version bump (`INCR bizmap:version`, no `SCAN`) on: `addBranch`, `updateLocation`, `removeBranch`, `updateBusiness` (status/name), `updateBusinessLogo`, `deleteBusiness`, `verifyBusinessEmail`, subscription status changes from the webhook / `activateSubscription`.
- Response header `X-Cache: HIT|MISS|BYPASS` for the demo.

### P4.4 Shared rate limits
- `express-rate-limit` + `rate-limit-redis` (memory store when Redis is off — that's the "before" for the demo: limits per instance, effectively ×N behind the ALB).
- Routes and keys:
  - `/auth/login*`, `/auth/register*`, `/business/forgot-password`, `/business/reset-password`: per IP, e.g. 10 / 15 min.
  - Admin PIN verification (`adminPin.routes`): **per business id**, 5 / 15 min — PIN brute force is the real risk.
  - `/report/generate`, `/report/preview` (PDF, CPU heavy): per business, 10 / min.
- Relies on `TRUST_PROXY=1` (already set) for the real client IP. WAF stays as the coarse edge limit (1000 / 5 min / IP).
- Tests: with a Redis mock (`ioredis-mock`) shared between two app instances, the limit is global.

### P4.5 Demo
- Hit `/business/nearby` repeatedly → `X-Cache` flips to `HIT`; edit a branch → next call `MISS`.
- 20 bad logins through the ALB (round robin across instances) → `429` after the 10th regardless of instance.
- Kill Redis (`redis_mode=off` + roll, or stop the EC2) → API keeps answering (`X-Cache: BYPASS`).

---

## P5 — DynamoDB read replica (stats & reports)

### P5.0 Probe
`aws dynamodb create-table` with `PAY_PER_REQUEST`, put/get an item from an EC2 instance using `LabInstanceProfile`, delete. Also confirm `cloudwatch:PutMetricData` works from the instance (needed in P3.3/P6.3).

### P5.1 Terraform — `infra/aws/dynamodb.tf`
- `var.enable_dynamo` (default false). `PAY_PER_REQUEST`, no PITR, no global tables.
- `rewardshub-daily-stats`: PK `pk = BIZ#<businessId>`, SK `sk = DAY#<yyyy-mm-dd>#BR#<branchId|ALL>`.
- `rewardshub-transactions`: PK `pk = BIZ#<businessId>`, SK `sk = <createdAt ISO>#<txId>`; GSI `byShift` (PK `BIZ#<businessId>#SHIFT#<workShiftId>`, SK createdAt) for shift reports.
- Table names → `/etc/rewardshub.env` (`DDB_DAILY_STATS_TABLE`, `DDB_TRANSACTIONS_TABLE`).

### P5.2 Replication mechanism — incremental sync job (recommended for the lab)
- New job type `replicate-dynamo` scheduled every 10 min (`rate(10 minutes)`).
- Checkpoint doc in Mongo `replication_checkpoints` `{ _id: 'transactions' | 'daily_stats', lastSeenAt, lastSeenId }`.
- Reads `transactions` with `updatedAt > checkpoint` (and `daily_stats` with `computedAt > checkpoint`) in pages of 500, writes with `BatchWriteItem` (25 items/request, retry `UnprocessedItems` with backoff), advances the checkpoint **after** each successful page. Writes are idempotent (same PK/SK overwrites), so a retried message is safe; the `JobRun` lock prevents two workers syncing at once.
- Why not change streams: needs a long-lived single consumer + resume-token management outside the existing queue/lock/DLQ pattern; keep it as a stretch goal.
- **Scaling-alarm side effect:** frequent scheduled messages can trip `jobs-backlog` (≥1 visible for 2 min) and churn workers. Switch the scale-out alarm to `ApproximateAgeOfOldestMessage > 120` or require ≥3 visible messages. Do this in the same PR.

### P5.3 Readers
- `src/replica/dynamo.ts`: client with the SQS credential strategy (`DDB_AWS_PROFILE` or instance metadata).
- `STATS_SOURCE=dynamo` → `businessStats.service` time series / KPIs / branch comparison read from `rewardshub-daily-stats`; `report.service` reads transactions by business + date range (+ shift via GSI) from `rewardshub-transactions`.
- On any Dynamo error → fall back to the Mongo path and log.
- Header `X-Data-Freshness: <checkpoint ISO>` so the UI can show "datos al …".
- `scripts/compare-stats-sources.ts`: for N businesses compare `live` vs `daily` vs `dynamo` → must match up to the checkpoint.
- `lab.sh status`: print replication lag (now − checkpoint).

---

## P6 — Grafana on CloudWatch

### P6.1 Terraform — `infra/aws/grafana.tf`
- `var.enable_grafana` (default false), `var.admin_cidr` (your public IP `/32`, required when enabled).
- One `t3.micro` AL2023 instance in a public subnet, `LabInstanceProfile` (gives the CloudWatch read access), SG: TCP 3000 from `admin_cidr` only.
- `user_data_grafana.sh.tftpl`: install Grafana OSS from the official RPM repo, write provisioning files, start `grafana-server`.
  - `datasources/cloudwatch.yaml`: CloudWatch, auth "AWS SDK Default", default region `us-east-1`.
  - Dashboards provisioned from `infra/aws/grafana/dashboards/*.json` (uploaded through the existing artifacts bucket, versioned in git).
  - Admin password from `random_password` → sensitive output; optional anonymous Viewer for the class demo.
- Single instance on purpose (dashboards are code, so it's disposable). Public IP changes per lab session → `./lab.sh grafana` prints the current URL.

### P6.2 Dashboard `RewardsHub · Lab` (JSON in git)
- **Entrada:** ALB `RequestCount`, `TargetResponseTime` p50/p95, `HTTPCode_Target_5XX_Count`, `HTTPCode_ELB_5XX_Count`, `HealthyHostCount`/`UnHealthyHostCount`; WAF `BlockedRequests` for `rate-limit-per-ip`.
- **Cómputo:** ASG `GroupInServiceInstances` (api, worker), EC2 `CPUUtilization` by ASG with the 60 % target line.
- **Cola:** SQS `ApproximateNumberOfMessagesVisible`, `…NotVisible`, `ApproximateAgeOfOldestMessage`; DLQ visible messages; alarm state annotations for `jobs-backlog` / `jobs-empty`.
- **Datos:** ElastiCache `CPUUtilization`, `CurrConnections`, `CacheHits`/`CacheMisses` (if P4); DynamoDB consumed RCU/WCU, `ThrottledRequests` (if P5).
- **App (custom namespace `RewardsHub`):** reconciliation mismatches, replication lag seconds, idempotent replays, cache hit ratio.

### P6.3 Custom metrics from the app
- `src/observability/metrics.ts`: in-process counters flushed every 60 s with `PutMetricData` (namespace `RewardsHub`, dimension `Role=api|worker`), same credential strategy as SQS, enabled by `METRICS_ENABLED=true`, fail-silent. No CloudWatch agent needed.

---

## 4. Environment variables introduced

| Variable | Where set | Used by | Default (unset) |
|---|---|---|---|
| `DB_NAME` | `/etc/rewardshub.env` | P0 | DB from `MONGO_URI` |
| `MONGO_MAX_POOL_SIZE` | `/etc/rewardshub.env` | P0 | driver default |
| `ALLOW_DB_WRITES` | shell, manual | P0 scripts | refuse prod |
| `IDEMPOTENCY_REQUIRED` | `.env` / user data | P1 | `false` |
| `STATS_SOURCE` | user data | P2/P5 | `live` |
| `REDIS_URL`, `CACHE_BIZMAP_TTL` | user data | P4 | cache/limits in-memory |
| `DDB_DAILY_STATS_TABLE`, `DDB_TRANSACTIONS_TABLE`, `DDB_AWS_PROFILE` | user data / local | P5 | Dynamo off |
| `METRICS_ENABLED`, `METRICS_AWS_PROFILE` | user data / local | P3/P6 | off |

## 5. New Terraform variables

`lab_db_name`, `daily_stats_schedule`, `reconcile_schedule`, `replicate_schedule`, `redis_mode`, `enable_dynamo`, `enable_grafana`, `admin_cidr`. Add each to `terraform.tfvars.example` with a comment.

## 6. Suggested order of Claude Code sessions

| # | Tasks | Owner |
|---|---|---|
| 1 | P0.4–P0.6, then P0.1–P0.3 | unassigned |
| 2 | P1.1–P1.3, P1.6 (partial) | unassigned |
| 3 | P1.4, P1.5, P1.6, P1.7 | unassigned |
| 4 | P2.1, P2.2 | unassigned |
| 5 | P2.3 | unassigned |
| 6 | P3.1–P3.4 | unassigned |
| 7 | P4.0–P4.5 | team |
| 8 | P6.1–P6.3 (base panels) | team |
| 9 | P5.0–P5.3 + alarm change + Grafana panels | team |

## 7. Final acceptance (end-to-end in the lab)

1. `./lab.sh up` with all flags on → `./lab.sh status` shows healthy API targets, workers, Redis, Dynamo tables, Grafana URL, replication lag < 15 min.
2. `npm run seed:lab`, then `./lab.sh enqueue daily-stats '{"from":"…","to":"…"}'` → `daily_stats` filled; `reconcile-balances` → 0 mismatches.
3. Concurrency demo (P1.7) → final balance exactly as expected, no duplicates with repeated `Idempotency-Key`.
4. Map demo → `X-Cache: HIT`; login brute-force → `429` across instances.
5. Stats endpoints with `STATS_SOURCE=dynamo` match `live` (compare script).
6. Grafana shows ALB, ASG, SQS, WAF, Redis, Dynamo and custom panels moving during a load test.
7. `./lab.sh down` destroys everything (verify no leftover ElastiCache/Dynamo/EC2 in the console).
8. Update the architecture diagram: move the pieces to **Listo**, remove the red "misma base que producción" warning.