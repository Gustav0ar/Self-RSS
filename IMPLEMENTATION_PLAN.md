# Implementation Plan: Comprehensive Codebase Improvements

## Priority Matrix

| Priority | Category | Items | Risk Level |
|----------|----------|-------|------------|
| CRITICAL | Security | CSP headers, admin rate limiting, SSE limits | High |
| HIGH | Performance | N+1 queries, runBlocking, health check timeouts | Medium |
| HIGH | Reliability | Unhandled rejection handlers, circuit breakers | Low |
| MEDIUM | Code Quality | Large functions, duplication, magic numbers | Low |
| MEDIUM | Testing | Missing test coverage | Low |
| LOW | CI/CD | npm audit, rollback capability | Low |

## Phase 1: Security Hardening (CRITICAL/HIGH)

### 1.1 Web CSP Headers [HIGH]
- **File**: `packages/web/index.html`
- **Task**: Add Content-Security-Policy meta tag
- **Risk**: LOW - defensive addition
- **Tests**: Manual verification, no regression expected
- **Status**: TODO

### 1.2 Admin Routes Rate Limiting [HIGH]
- **File**: `packages/api/src/app.ts`, `packages/api/src/routes/admin.ts`
- **Task**: Apply rate limiting to admin routes
- **Risk**: LOW - defensive addition
- **Tests**: Unit tests for rate limit
- **Status**: TODO

### 1.3 SSE Connection Limits [MEDIUM]
- **File**: `packages/api/src/services/realtime.service.ts`
- **Task**: Add per-user SSE connection limits
- **Risk**: LOW - defensive addition
- **Tests**: Unit tests for connection limits
- **Status**: TODO

### 1.4 HSTS Header [LOW]
- **File**: `packages/api/src/middleware/common.ts`
- **Task**: Add Strict-Transport-Security header
- **Risk**: LOW - standard security header
- **Tests**: None required
- **Status**: TODO

### 1.5 Health Check Timeouts [HIGH]
- **File**: `packages/api/src/routes/health.ts`
- **Task**: Add timeout to health check dependencies
- **Risk**: LOW - improves reliability
- **Tests**: Unit test for timeout behavior
- **Status**: TODO

## Phase 2: Performance Improvements (HIGH)

### 2.1 Fix N+1 Article Updates [HIGH]
- **File**: `packages/api/src/repositories/article.repository.ts`
- **Task**: Batch UPDATE statements using CASE expressions
- **Risk**: MEDIUM - changes query behavior
- **Tests**: Integration tests required
- **Status**: TODO

### 2.2 Android runBlocking Fix [HIGH]
- **File**: `packages/android/app/src/main/java/com/selffeed/android/data/SessionStore.kt`
- **Task**: Preload session on startup, make callers suspend
- **Risk**: MEDIUM - changes session initialization
- **Tests**: Android unit tests
- **Status**: TODO

### 2.3 Redis Subscriber Reconnect [MEDIUM]
- **File**: `packages/api/src/services/realtime.service.ts`
- **Task**: Add reconnection logic for Redis subscriber
- **Risk**: LOW - improves reliability
- **Tests**: Unit tests
- **Status**: TODO

### 2.4 Unhandled Rejection Handlers [HIGH]
- **Files**: `packages/api/src/index.ts`, `packages/api/src/worker.ts`
- **Task**: Add global unhandled rejection handlers
- **Risk**: LOW - improves crash visibility
- **Tests**: None required
- **Status**: TODO

## Phase 3: Code Quality (MEDIUM)

### 3.1 Extract FeedTreeRow Component [MEDIUM]
- **File**: `packages/web/src/components/layout/sidebar.tsx`
- **Task**: Extract duplicated feed row logic into component
- **Risk**: LOW - refactoring
- **Tests**: Web unit tests
- **Status**: TODO

### 3.2 Add Type Guards [MEDIUM]
- **File**: `packages/web/src/hooks/queries.ts`
- **Task**: Replace `as` casts with type guards
- **Risk**: LOW - improves type safety
- **Tests**: Web unit tests
- **Status**: TODO

### 3.3 Create Constants File [LOW]
- **File**: `packages/web/src/lib/constants.ts` (new)
- **Task**: Extract magic numbers to named constants
- **Risk**: NONE - new file
- **Tests**: None required
- **Status**: TODO

### 3.4 Fix Force Unwrap Android [HIGH]
- **File**: `packages/android/app/src/main/java/com/selffeed/android/ui/components/ArticleReaderPane.kt:271`
- **Task**: Add null check instead of force unwrap
- **Risk**: MEDIUM - prevents crash
- **Tests**: Android unit tests
- **Status**: TODO

## Phase 4: Testing (MEDIUM)

### 4.1 Add Admin Routes Tests [HIGH]
- **File**: `packages/api/tests/unit/` (new)
- **Task**: Add tests for admin routes
- **Risk**: NONE - tests only
- **Status**: TODO

### 4.2 Add API Client Tests [HIGH]
- **File**: `packages/web/tests/unit/api.test.ts` (new)
- **Task**: Add unit tests for lib/api.ts
- **Risk**: NONE - tests only
- **Status**: TODO

### 4.3 Add ErrorBoundary Tests [MEDIUM]
- **File**: `packages/web/tests/unit/error-boundary.test.tsx` (new)
- **Task**: Test error boundary behavior
- **Risk**: NONE - tests only
- **Status**: TODO

## Phase 5: CI/CD (LOW)

### 5.1 Add npm audit [MEDIUM]
- **File**: `.github/workflows/security.yml`
- **Task**: Add bun audit step
- **Risk**: NONE - CI only
- **Status**: TODO

### 5.2 Add Rollback Capability [LOW]
- **File**: `scripts/deploy-vps.sh`
- **Task**: Implement rollback on health check failure
- **Risk**: MEDIUM - deployment logic
- **Tests**: Manual testing
- **Status**: TODO

## Verification Checklist

- [ ] All 577+ tests pass
- [ ] No lint errors
- [ ] TypeScript compilation succeeds
- [ ] Manual verification of security headers
- [ ] Android builds successfully
- [ ] API starts without errors
