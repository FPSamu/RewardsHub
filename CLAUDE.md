# CLAUDE.md — RewardsHub (branch `sistemas-escalables`)

Backend: Node 22 + Express + TypeScript + Mongoose (MongoDB Atlas). Worker: `src/worker.ts` consuming SQS.
Infra for the course lives in `infra/aws/` (Terraform + `lab.sh`). Production runs on **Render** — never change `render.yaml` or production config from this branch.

The current work plan is in `docs/PLAN-pending-architecture.md`. Work one task ID at a time.

## Commands
- Node 22 comes from nvm: prefix every node/npm/npx command with `. ~/.nvm/nvm.sh && `.
- `npm run typecheck` · `npm test` · `npm run lint` · `npm run build`
- **Git is FORBIDDEN except read-only commands** (`git status`, `git diff`, `git log`).
  Never commit, push, create/switch branches, stash, reset, merge or use `gh`.
- **AWS is allowed ONLY in the AWS Academy Learner Lab**: profile `academy`, region `us-east-1`,
  through `infra/aws` (`./lab.sh`, `terraform`, `aws`). Only touch resources created by this
  Terraform state or the temporary probe resources (name them `rh-probe*` and delete them after).
- Terraform must always use `env_file = "../../.env.lab"`. NEVER deploy or upload `.env`.
- If AWS credentials are expired or invalid, STOP and ask me to refresh them. Never try to
  work around it.
- Do NOT run `./lab.sh down` / `terraform destroy` unless I ask; at the end, remind me to do it.
- Database scripts (seed, backfills, reconcile-fix, load tests) may ONLY run against the lab
  database (`rewardshub_lab`) in MY OWN Atlas cluster from `.env.lab`. Never use `--prod`.
- NEVER touch Render, the teammate's `.env`, or their Firebase/Stripe/Atlas/email accounts.
- Never read or print `.env`; `.env.lab` may be read only to check which variables are set
  (don't print secret values).

## AWS Academy Learner Lab constraints
- Region `us-east-1`, AWS CLI profile `academy`; credentials expire every ~4 h.
- Cannot create IAM roles/policies. EC2 uses `LabInstanceProfile`. Cross-service access uses resource policies (see `infra/aws/sqs.tf`).
- SCP denies: CloudFront, `autoscaling:StartInstanceRefresh` (use `./lab.sh roll`), `s3:GetBucketObjectLockConfiguration` (create S3 buckets via CloudFormation, never `aws_s3_bucket`).
- Small instance types only (t3.micro/small/medium). Keep instance count low; lab has a fixed budget.
- HTTP only (no domain/cert). Stripe webhooks can't reach the lab.
- Every new AWS resource needs an `enable_*` / `*_mode` variable with an "off" path.

## Code rules
- New behaviour is gated by env vars and is a no-op when unset (pattern: `SQS_QUEUE_URL` / `isQueueEnabled()`). Local and Render must keep working with the current `.env`.
- AWS-only env vars go in `/etc/rewardshub.env` via `infra/aws/user_data.sh.tftpl`, not in `.env`.
- AWS SDK clients in app code must NOT use the default credential chain (the `.env` has keys for another account). Use `fromIni({ profile })` when a `*_AWS_PROFILE` var is set, else `fromInstanceMetadata()` — copy `src/queue/sqs.ts`.
- Never change API response shapes (web + 2 mobile apps). Only add fields. Pin contracts with tests first (see `tests/business.nearby.test.ts`).
- Scripts that mutate data must call `assertNonProductionDb()` (`src/db/safety.ts`).
- Tests: Jest + supertest + `mongodb-memory-server`; use `MongoMemoryReplSet` for anything that uses transactions.
- Comments and `infra/aws/README.md` are written in Spanish, matching the existing code. Update the README in the same change.
- **No git operations:** never run `git commit`, `git push`, `git checkout -b` or open PRs. Only edit files; the user reviews the diff.
- Never edit or print `.env`, `terraform.tfvars`, `*.tfstate`.