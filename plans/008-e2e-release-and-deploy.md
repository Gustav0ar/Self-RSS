# Plan 008: Verify, audit, deploy, and smoke test the complete fix set

> **Executor instructions**: This plan is the release gate for plans 001-007. Do not start until every implementation plan is `DONE` or explicitly `REJECTED` with a regression-based rationale in `plans/README.md`. If any gate fails, stop, preserve diagnostics, and do not deploy the failing SHA.
>
> **Drift check (run first)**: `git status -sb` and `git log --oneline --decorate -5`

## Status

- **Priority**: P0
- **Effort**: M
- **Risk**: HIGH
- **Depends on**: plans 001-007
- **Category**: dx
- **Planned at**: commit `b14d79b`, 2026-06-19

## Why this matters

The user requested e2e implementation through deployment, with no skipped checks. This plan defines the exact local, CI, security, container, deployment, and post-deploy criteria required before the work is considered complete.

## Current state

Repo commands:

```json
// package.json:10-17
"lint": "biome check .",
"typecheck": "bun run --filter '*' typecheck",
"test:unit": "bun run --filter '*' test:unit",
"test:integration": "bun scripts/run-api-integration.ts",
"test:e2e": "bun scripts/run-playwright.ts",
"test:all": "bun run test && bun run test:integration && bun run test:e2e"
```

CI:

- `.github/workflows/ci.yml` runs lint, typecheck, OpenAPI generation drift check, unit tests, API integration, Playwright E2E, and build.
- `.github/workflows/security.yml` runs CodeQL, secret scan, and high/critical filesystem vulnerability scan.
- `.github/workflows/containers.yml` builds and pushes API and web images.
- `.github/workflows/deploy.yml` deploys after a successful Containers workflow and checks container health for Redis, API, web, and worker.

Deployment docs:

- `DEPLOY.md` is the source of truth for VPS deployment.
- Production deploy uses the protected `production` environment.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Git status | `git status -sb` | only intended changes present |
| OpenAPI drift | `bun run openapi:generate` then `git diff --exit-code -- packages/api/openapi.json` | exit 0 unless reviewed intentional OpenAPI change |
| Lint | `bun run lint` | exit 0 |
| Typecheck | `bun run typecheck` | exit 0 |
| Unit tests | `bun run test:unit` | exit 0 |
| Integration tests | `bun run test:integration` | exit 0 |
| Playwright install | `bun run --filter '@self-feed/web' playwright:install` | exit 0 |
| E2E tests | `bun run test:e2e` | exit 0 |
| Build | `bun run build` | exit 0 |
| Dependency audit | `bun audit --audit-level high` | exit 0 |
| Workflow list | `gh run list --branch main --limit 10 --json databaseId,workflowName,status,conclusion,headSha,createdAt,displayTitle,url` | shows relevant runs |

## Scope

**In scope**:

- Running verification.
- Reviewing changed files.
- Committing the complete fix set.
- Pushing the intended commit to production according to repo guidance.
- Watching and, if authorized, approving the matching production deployment.
- Post-deploy smoke checks.

**Out of scope**:

- Approving a deploy for an older SHA.
- Deploying with failing local checks or failing CI/Security/Containers.
- Changing production secrets.
- Bypassing the protected environment gate.

## Git workflow

Use the repo guidance from `AGENTS.md` / `CLAUDE.md`:

- Before committing or pushing, run `git status -sb` and `git log --oneline --decorate -5`.
- If local `main` has unrelated commits, create or use a clean branch based on `origin/main`.
- When only this work should go to production, push with `git push origin HEAD:main`.
- Confirm the pushed commit list is exactly intended.

## Steps

### Step 1: Confirm implementation plan status

Open `plans/README.md`. Plans 001-007 must be `DONE` or `REJECTED` with a regression-based reason.

**Verify**: no implementation plan is still `TODO`, `IN PROGRESS`, or `BLOCKED`.

### Step 2: Inspect final diff for scope and security

Run:

- `git status -sb`
- `git diff --stat`
- `git diff --check`
- `git diff -- packages/api packages/web packages/shared .env.example docker-compose.yml nginx.conf DEPLOY.md package.json bun.lock`

Review for:

- no secret values;
- no unrelated refactors;
- no accidental generated noise;
- no source changes outside plan scope unless documented by a plan;
- security-sensitive proxy/rate-limit behavior covered by tests.

**Verify**: `git diff --check` exits 0 and manual review finds only intended changes.

### Step 3: Run local generated-contract gate

Run:

1. `bun run openapi:generate`
2. `git diff --exit-code -- packages/api/openapi.json`

If OpenAPI changes are expected, review the diff and ensure API/web/shared contract changes are intentional. If not expected, fix the source or committed generated file.

**Verify**: command exits 0, or an intentional OpenAPI diff is reviewed and committed.

### Step 4: Run full local quality gates

Run in this order:

1. `bun run lint`
2. `bun run typecheck`
3. `bun run test:unit`
4. `bun run test:integration`
5. `bun run --filter '@self-feed/web' playwright:install`
6. `bun run test:e2e`
7. `bun run build`
8. `bun audit --audit-level high`

Expected: every command exits 0.

If any command fails:

- fix the regression if it is within the implemented plan scope;
- rerun the failed command and any affected broader command;
- if the failure indicates a plan is unsafe, mark that plan `REJECTED` or `BLOCKED` with the reason and stop before deployment.

### Step 5: Commit the verified changes

Run:

- `git status -sb`
- `git log --oneline --decorate -5`

Commit all intended implementation and plan status changes. Use a short imperative commit subject, for example:

`Fix API and web review findings`

**Verify**: `git status -sb` is clean after commit, or only intentional untracked local artifacts remain and are ignored.

### Step 6: Push the intended SHA to main

Confirm the branch contains only intended commits relative to `origin/main`:

`git log --oneline origin/main..HEAD`

If correct, push:

`git push origin HEAD:main`

**Verify**: push succeeds and the remote main SHA matches local `HEAD`.

### Step 7: Watch CI, Security, and Containers

Run:

`gh run list --branch main --limit 10 --json databaseId,workflowName,status,conclusion,headSha,createdAt,displayTitle,url`

Identify runs for the pushed `headSha`. Watch the relevant runs:

`gh run watch <run-id> --exit-status`

Required successful workflows for the same `headSha`:

- `CI`
- `Security`
- `Containers`

If any fail, open logs with `gh run view <run-id> --log-failed`, fix the issue in a new commit, push again, and restart this step for the new SHA.

### Step 8: Approve the matching production deployment if authorized

The Deploy workflow usually waits on the protected `production` environment. Check pending approvals:

`gh api /repos/Gustav0ar/Self-RSS/actions/runs/<deploy-run-id>/pending_deployments`

Only approve if all are true:

- the pending deploy `headSha` matches the SHA from Step 6;
- `CI`, `Security`, and `Containers` passed for that same SHA;
- `current_user_can_approve` is true;
- no newer commit has superseded this deploy.

Approve with:

`gh api --method POST /repos/Gustav0ar/Self-RSS/actions/runs/<deploy-run-id>/pending_deployments --input -`

Input JSON shape:

```json
{"environment_ids":[123],"state":"approved","comment":"Approve deploy for <sha> after CI, Security, and Containers passed"}
```

Use the actual environment id from the pending deployments response. Do not approve an older waiting deploy.

**Verify**: `gh run watch <deploy-run-id> --exit-status` exits 0.

### Step 9: Post-deploy smoke checks

Use the production origin from deployment configuration. Do not print or expose secrets.

Run:

- `curl -fsS https://<production-host>/health`
- `curl -fsSI https://<production-host>/`

Expected:

- health returns success;
- web root returns a successful HTTP status;
- no obvious API/web container errors in the Deploy workflow diagnostics.

If production host cannot be identified from non-secret configuration or operator-provided context, mark this plan `BLOCKED: production host needed for smoke check`. Do not invent a host.

### Step 10: Final status update

Update `plans/README.md`:

- Plan 008 status to `DONE`.
- Any rejected finding must include the regression reason.
- Include the deployed SHA in a short note if the operator wants status tracked in the plan index.

Commit the status update only if the operator wants plan status committed after deployment. Otherwise leave it as local documentation.

## Test plan

This plan's test plan is the full local and remote release gate:

- local lint, typecheck, unit, integration, E2E, build, audit;
- GitHub CI, Security, Containers;
- Deploy workflow;
- production smoke checks.

## Done criteria

- [ ] Plans 001-007 are implemented or explicitly rejected due to a regression.
- [ ] Local lint/typecheck/unit/integration/E2E/build/audit all pass.
- [ ] OpenAPI generation has no unreviewed drift.
- [ ] The exact intended SHA is pushed to `main`.
- [ ] GitHub `CI`, `Security`, and `Containers` succeed for that SHA.
- [ ] `Deploy` succeeds for that SHA.
- [ ] Production health and web smoke checks pass.
- [ ] No secrets were printed, committed, or added to plans.

## STOP conditions

- Any local quality gate fails twice after reasonable fixes.
- `bun audit --audit-level high` reports a high/critical advisory.
- GitHub Security fails.
- The Deploy workflow is waiting for approval but `current_user_can_approve` is false.
- A newer commit supersedes the pending deploy.
- Post-deploy smoke checks fail.
- The only way forward would require changing production secrets or bypassing protected deployment rules.

## Maintenance notes

Reviewer focus: treat deployment as part of the fix, not an afterthought. The work is not complete until the same SHA that passed local and remote checks is deployed and smoke-tested.
