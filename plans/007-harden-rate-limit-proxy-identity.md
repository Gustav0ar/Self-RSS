# Plan 007: Harden unauthenticated rate-limit identity behind trusted proxies

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. Keep this defensive: do not add misuse walkthroughs or secret material to tests, logs, or commit text. If anything in the STOP conditions occurs, stop and report. When done, update `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat b14d79b..HEAD -- packages/api/src/utils/rate-limit.ts packages/api/src/config/env.ts packages/api/tests/unit/rate-limiter.test.ts docker-compose.yml nginx.conf .env.example DEPLOY.md`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `b14d79b`, 2026-06-19

## Why this matters

Unauthenticated rate-limit buckets identify clients by proxy headers when `TRUST_PROXY=true`. Production enables `TRUST_PROXY`, and nginx forwards the `X-Forwarded-For` chain. Trusting the first forwarded address is only safe if every upstream strips untrusted incoming values. A more explicit trusted-hop parser makes the rate limiter robust to common proxy-chain configurations.

## Current state

```ts
// packages/api/src/utils/rate-limit.ts:6-20
function getRateLimitIdentity(c: Context): string {
  const userId = c.get('userId') as string | undefined;
  if (userId) return userId;
  if (!getEnv().TRUST_PROXY) return 'anonymous';
  const forwardedFor = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  if (forwardedFor) return forwardedFor;
  const realIp = c.req.header('x-real-ip')?.trim();
  if (realIp) return realIp;
  return 'anonymous';
}
```

```yaml
# docker-compose.yml:48-50
CORS_ALLOWED_ORIGINS: ${CORS_ALLOWED_ORIGINS:?CORS_ALLOWED_ORIGINS is required (e.g. https://rss.yourdomain.com)}
TRUST_PROXY: "true" # Required for proper rate limiting behind Traefik
```

```nginx
# nginx.conf:29-31
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
```

Existing unit coverage at `packages/api/tests/unit/rate-limiter.test.ts:121-135` expects the first forwarded address.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| API rate-limit tests | `bun run --filter '@self-feed/api' test -- tests/unit/rate-limiter.test.ts tests/unit/env.test.ts` | exit 0 |
| API security tests | `bun run --filter '@self-feed/api' test -- tests/unit/security.test.ts` | exit 0 |
| Typecheck | `bun run typecheck` | exit 0 |
| Audit | `bun audit --audit-level high` | exit 0 |

## Scope

**In scope**:

- `packages/api/src/utils/rate-limit.ts`
- `packages/api/src/config/env.ts`
- `packages/api/tests/unit/rate-limiter.test.ts`
- `packages/api/tests/unit/env.test.ts`
- `.env.example`
- `docker-compose.yml`
- `DEPLOY.md`

**Out of scope**:

- Replacing the Redis rate limiter.
- Changing authenticated users to IP-based buckets.
- Logging raw forwarded header chains in production.

## Git workflow

- Branch: `advisor/api-web-findings-e2e`
- Suggested commit subject: `Harden proxy rate limit identity`

## Steps

### Step 1: Add explicit trusted proxy hop configuration

Add an env var such as `TRUSTED_PROXY_HOPS` to `packages/api/src/config/env.ts`.

Recommended default:

- `0` when `TRUST_PROXY=false` because headers are ignored.
- `1` when production uses Traefik in front of the web nginx proxy, because the forwarded chain contains the upstream proxy hop appended before nginx forwards to the API.

Because env defaults are static in Zod, use a numeric default of `1` and only read it when `TRUST_PROXY` is true. Document that deployments without an upstream proxy before nginx can set it to `0`.

Validation: integer, min `0`, max a small number such as `10`.

**Verify**: Extend `env.test.ts` for parsing/default behavior. Run `bun run --filter '@self-feed/api' test -- tests/unit/env.test.ts` -> exit 0.

### Step 2: Parse forwarded addresses from the trusted side

Update `getRateLimitIdentity`:

- Authenticated users still use `userId`.
- If `TRUST_PROXY=false`, keep returning `anonymous`.
- Parse `x-forwarded-for` into trimmed entries.
- Ignore empty entries.
- Validate entries as IP addresses using Node's `net.isIP` or an equivalent safe parser.
- Choose the address immediately before the configured number of trusted proxy hops from the right side of the chain.
- If the forwarded chain is missing or too short, fall back to a validated `x-real-ip`.
- If no valid proxy-derived identity exists, return `anonymous`.

Do not log raw header values. If you add debug logging, log only whether parsing failed, not the header content.

**Verify**: Update `rate-limiter.test.ts`:

- authenticated user still wins over headers;
- untrusted proxy mode still uses `anonymous`;
- trusted proxy with a single valid forwarded address and `TRUSTED_PROXY_HOPS=0` uses that address;
- trusted proxy with a multi-hop chain and `TRUSTED_PROXY_HOPS=1` uses the address before the trusted hop;
- invalid/empty header entries are ignored or fall back safely;
- existing first-address expectation is removed or updated.

Run `bun run --filter '@self-feed/api' test -- tests/unit/rate-limiter.test.ts` -> exit 0.

### Step 3: Document and configure production

Update:

- `.env.example` with `TRUSTED_PROXY_HOPS=0` near `TRUST_PROXY=false` for local development.
- `docker-compose.yml` with `TRUSTED_PROXY_HOPS: ${TRUSTED_PROXY_HOPS:-1}` near `TRUST_PROXY`.
- `DEPLOY.md` production environment notes explaining when to use `1` and when to use `0`. Do not include secrets.

**Verify**: `bun run lint` -> exit 0. Documentation files should have no secret values.

### Step 4: Re-run security checks

Run:

- `bun run --filter '@self-feed/api' test -- tests/unit/rate-limiter.test.ts tests/unit/env.test.ts tests/unit/security.test.ts`
- `bun audit --audit-level high`

Expected: both exit 0.

## Test plan

- Unit tests for header parsing and trusted-hop selection.
- Env parsing tests for `TRUSTED_PROXY_HOPS`.
- Existing route rate-limit behavior still passes.
- Local audit has no high/critical advisory.

## Done criteria

- [ ] Rate limiter no longer blindly trusts the first forwarded address.
- [ ] Trusted proxy hop count is configurable and documented.
- [ ] Invalid forwarded values do not become rate-limit identities.
- [ ] Authenticated user ids still take precedence.
- [ ] Focused API tests pass.
- [ ] `bun audit --audit-level high` exits 0.
- [ ] `plans/README.md` status row updated.

## STOP conditions

- Production proxy topology cannot be determined well enough to set a safe default.
- Tests reveal Hono or deployment infrastructure provides a canonical remote address that should be used instead of headers.
- The fix requires logging raw client IP chains or other sensitive request metadata.

## Maintenance notes

Reviewer focus: this is a hardening change. Confirm the selected default matches the real Traefik -> nginx -> API path before approving production deploy.
