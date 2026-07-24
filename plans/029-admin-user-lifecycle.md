# Plan 029: Deliver a safe cross-platform administration console

> **Executor instructions**: Implement contracts first, then API invariants,
> then web and Android clients. Use existing Hono route/service/repository
> layering, React Query failure states, and localized Compose UI. Never expose
> password hashes, refresh token material, or audit details containing secrets.
>
> **Drift check**: `git diff --stat b34c5b9..HEAD -- packages/shared/src packages/api/src/routes/admin.ts packages/api/src/services/auth.service.ts packages/api/src/repositories packages/api/src/openapi packages/api/tests packages/web/src/providers/auth.tsx packages/web/src/routes packages/web/src/components packages/web/src/hooks packages/web/tests packages/android/app/src/main packages/android/app/src/test packages/api/openapi.json`

## Status

- **State**: DONE
- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: plan 022
- **Category**: direction
- **Planned at**: commit `b34c5b9`, 2026-07-24

## Why this matters

The backend exposes registration locking and user creation, but web has no
admin UI and Android fetches admin settings without passing them to its
settings screen. Operators cannot list, disable, reactivate, or reset users
through the product even though `users.isActive` and audit logging already
exist.

## Current state

- `packages/api/src/routes/admin.ts:20-65` supports app settings and creating a
  user only.
- `packages/api/src/db/schema.ts:27-39` already stores role and active state.
- `packages/web/src/providers/auth.tsx:14-25` stores email but not the
  authenticated user's role/id.
- `packages/android/.../SettingsViewModel.kt:164-193` loads/toggles the
  registration lock, but `screens/ScreenContracts.kt:88-107` and
  `screens/SettingsTab.kt` omit admin state/actions.
- Audit entries are written before returning from admin mutations; preserve
  that pattern.

## Product and security decisions

- Admins may list users, create users, change role, activate/deactivate, reset
  a password, and control registration.
- An admin cannot deactivate or demote their own current account.
- The last active admin cannot be demoted or deactivated.
- Password reset revokes every durable session belonging to the target user.
- User enumeration remains admin-only, paginated, and rate-limited.
- Clients render admin navigation only from the server-returned role; a hidden
  UI is not an authorization boundary.

## Scope

**In scope**: shared admin schemas/contracts, repository/service/routes,
OpenAPI, audit events, role-aware web auth state and admin route, Android admin
settings/users UI, localization, unit/integration/E2E/Android tests.

**Out of scope**: invitations/email delivery, deleting users/data, OAuth,
impersonation, bulk CSV operations, or exposing raw audit logs.

## Steps

1. Define shared paginated admin-user responses and validated create/update/
   password-reset requests. Use a dedicated response type containing only id,
   email, role, active state, and timestamps.
2. Add repository methods for paginated list/count and guarded updates. Add
   service-level invariants for self-mutation and last-active-admin safety
   inside a database transaction. Password reset must hash through the existing
   password utility and revoke all target sessions fail-closed.
3. Add `GET /admin/users`, `PATCH /admin/users/:id`, and
   `POST /admin/users/:id/reset-password`; retain existing endpoints. Apply
   admin middleware/rate limits and emit audit actions with identifiers but no
   plaintext password.
4. Extend integration tests for authorization, pagination, duplicate email,
   concurrent last-admin mutations, self-demotion/deactivation, inactive login,
   session revocation after reset, and sanitized responses. Regenerate OpenAPI.
5. Change web AuthProvider to retain the full sanitized user and clear it at
   every auth boundary. Add an `/admin` route and role-gated navigation. Build
   an accessible console for registration, user creation/listing, role/active
   changes, reset confirmation, failure/retry, pending states, and pagination.
6. Retain the authenticated Android `User` in auth state. Remove the
   unconditional ordinary-user admin request. Plumb admin state/actions into
   SettingsTab and add localized adaptive Compose controls for the same safe
   operations; ordinary users must neither call nor render admin endpoints.
7. Add web unit/E2E and Android unit/Compose tests for admin and ordinary-user
   flows, destructive confirmations, server errors, and last-admin messages.

## Verification

- `mise exec -- bun run test:unit`, `mise exec -- bun run test:integration`,
  and `mise exec -- bun run test:e2e` exit 0.
- `mise exec -- bun run openapi:generate` yields reviewed admin-only changes.
- `mise exec -- bun run android:check`, typecheck, lint, and build exit 0.
- API tests prove authorization and invariants even when clients bypass UI.

## STOP conditions

Stop if an invariant cannot be enforced transactionally, if reset could leave
an old session active, if any response/log contains a hash or plaintext
password, or if Android role state cannot be restored reliably after process
restart.

## Maintenance notes

Every new admin mutation needs authorization, a service invariant, rate
limiting, audit logging, confirmation UX, and tests on both sides of the role
boundary.
