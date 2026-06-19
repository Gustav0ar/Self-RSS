# Plan 006: Clear web data and selection state on auth boundaries

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the STOP conditions occurs, stop and report. When done, update `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat b14d79b..HEAD -- packages/web/src/main.tsx packages/web/src/providers/auth.tsx packages/web/src/providers/app-state.tsx packages/web/src/providers/query.tsx packages/web/tests/unit/auth-provider.test.tsx packages/web/tests/unit/root-layout-routing.test.tsx`

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `b14d79b`, 2026-06-19

## Why this matters

The web app stores user-scoped articles, feeds, categories, preferences, and stats in a QueryClient that survives logout/login. Query keys are not user-scoped, so switching accounts in the same tab can briefly render the previous user's cached data. Selection state can also carry previous feed/article ids across auth boundaries.

## Current state

```tsx
// packages/web/src/main.tsx:13-20
<ThemeProvider>
  <QueryProvider>
    <AuthProvider>
      <AppStateProvider>
        <RouterProvider router={router} />
      </AppStateProvider>
    </AuthProvider>
  </QueryProvider>
</ThemeProvider>
```

```tsx
// packages/web/src/providers/auth.tsx:73-101
const login = useCallback(async (email: string, password: string) => {
  const res = await apiFetch<ApiResponse<LoginResponse>>('/auth/login', ...);
  setTokens(res.data.tokens.accessToken);
  setUsername(res.data.user.email);
  setIsAuthenticated(true);
}, []);

const logout = useCallback(async () => {
  ...
  clearTokens();
  setIsAuthenticated(false);
  setUsername(null);
}, []);
```

```tsx
// packages/web/src/hooks/queries.ts:927-981
queryKey: ['preferences']
queryKey: ['stats']
```

`QueryProvider` sets a 60-second stale time at `packages/web/src/providers/query.tsx:9-12`.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Web auth tests | `bun run --filter '@self-feed/web' test -- tests/unit/auth-provider.test.tsx` | exit 0 |
| Web routing/app-state tests | `bun run --filter '@self-feed/web' test -- tests/unit/root-layout-routing.test.tsx tests/unit/feed-view-selected-article.test.tsx` | exit 0 |
| Web unit all | `bun run --filter '@self-feed/web' test -- tests/unit` | exit 0 |
| Typecheck | `bun run typecheck` | exit 0 |

## Scope

**In scope**:

- `packages/web/src/providers/auth.tsx`
- `packages/web/src/main.tsx`
- `packages/web/tests/unit/auth-provider.test.tsx`
- A small provider wrapper component if needed

**Out of scope**:

- Adding user id to every query key.
- Changing API auth semantics or token storage.
- Persisting query cache across reloads.

## Git workflow

- Branch: `advisor/api-web-findings-e2e`
- Suggested commit subject: `Clear web state on auth changes`

## Steps

### Step 1: Clear QueryClient on logout and session replacement

In `AuthProvider`, import `useQueryClient` from `@tanstack/react-query`. Because `QueryProvider` wraps `AuthProvider`, this hook is available.

Required behavior:

- On successful login, clear existing query cache before marking the new session authenticated.
- On successful register, clear existing query cache before marking the new session authenticated.
- On logout, clear tokens and query cache even if `/auth/logout` fails.
- On bootstrap failure where tokens are cleared, clear query cache as well.

Use a small local helper such as `clearSessionState()` if it keeps the code clear. Do not clear tokens after setting new tokens in login/register.

**Verify**: Extend `auth-provider.test.tsx` with `QueryClientProvider` in relevant tests. Add tests that seed a query such as `['preferences']`, call logout/login through a probe component, and assert the query data is gone.

Run `bun run --filter '@self-feed/web' test -- tests/unit/auth-provider.test.tsx` -> exit 0.

### Step 2: Reset app selection state on auth identity changes

Key `AppStateProvider` by auth identity so it remounts when the authenticated user changes or logs out.

Recommended shape in `main.tsx`:

- Keep `AuthProvider` inside `QueryProvider`.
- Add a small component inside `main.tsx`, for example `AuthScopedAppState`, that calls `useAuth()`.
- Render `<AppStateProvider key={auth.isAuthenticated ? auth.username ?? 'auth' : 'anon'}>`.

This preserves AppState behavior during normal navigation but resets selected feed/category/article when switching sessions.

**Verify**: Add or extend a web unit test with a small provider tree proving selection state resets after auth identity changes. If existing root routing tests are too heavily mocked, create a focused provider test.

### Step 3: Avoid clearing while initial bootstrap is still pending

Make sure the app does not clear a valid cache repeatedly during initial `isLoading` bootstrap. Clearing on final unauthenticated state or token failure is enough.

**Verify**: Existing `restores the session through refresh and /auth/me` test still passes and does not clear after a successful restore.

## Test plan

- AuthProvider tests for logout cache clearing, login cache clearing, register cache clearing, and failed bootstrap clearing.
- Provider/app-state test for selection reset by auth identity.
- Full web unit suite.

## Done criteria

- [ ] Query cache is cleared on logout even if logout API call fails.
- [ ] Query cache is cleared before a new login/register session renders.
- [ ] Failed bootstrap clears stale token-backed cache.
- [ ] AppState selection resets across account changes.
- [ ] `bun run --filter '@self-feed/web' test -- tests/unit/auth-provider.test.tsx` exits 0.
- [ ] `bun run --filter '@self-feed/web' test -- tests/unit` exits 0.
- [ ] `bun run typecheck` exits 0.
- [ ] `plans/README.md` status row updated.

## STOP conditions

- Clearing QueryClient breaks auth bootstrap by removing data required to complete `/auth/me`.
- Tests reveal account switching is intentionally unsupported and should force a full page reload instead. If so, stop and propose the reload strategy explicitly.

## Maintenance notes

Reviewer focus: this is a privacy boundary. Prefer clearing too much user-scoped cache over preserving stale cross-account state.
