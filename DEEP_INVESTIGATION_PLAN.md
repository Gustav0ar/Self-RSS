# Deep Investigation Findings - Implementation Plan

## HIGH Priority Issues

### 1. Accessibility - Android Missing contentDescription [HIGH]
**Impact**: TalkBack users cannot identify navigation icons
**Files**: SelfFeedApp.kt, Tabs.kt, ArticleReaderPane.kt
**Fix**: Add descriptive contentDescription to all bottom nav icons and meaningful icons
**Risk**: LOW - purely additive, improves accessibility

### 2. Accessibility - Color Contrast [HIGH]
**Impact**: BrandPrimary (#7C8CFF) may not meet WCAG AA on light backgrounds
**Files**: Color.kt
**Fix**: Test and adjust color if needed, or document that light theme uses darker variant
**Risk**: LOW - color adjustments

### 3. Architecture - Large Services [HIGH]
**Impact**: FeedSyncService (1115 lines), ArticlesViewModel (622 lines) are hard to maintain
**Files**: feed-sync.service.ts, ArticlesViewModel.kt
**Fix**: Extract smaller focused classes/services (low priority, defer to later)
**Risk**: MEDIUM - refactoring could introduce bugs

### 4. Edge Case - Unix Timestamp Overflow [HIGH]
**Impact**: Cursor pagination could fail for dates beyond 2038
**File**: article-cursor.ts
**Fix**: Add bounds validation for timestamp values
**Risk**: LOW - defensive addition

### 5. Edge Case - Redis Rate Limit Failure [MEDIUM]
**Impact**: Rate limiting throws when Redis is unavailable
**File**: rate-limiter.ts
**Fix**: Fail open or closed gracefully when Redis is down
**Risk**: LOW - defensive improvement

## MEDIUM Priority Issues

### 6. Observability - No Error Tracking [MEDIUM]
**Impact**: No centralized error tracking (Sentry, etc.)
**Files**: API, Web, Android
**Fix**: Add Sentry SDK to all platforms
**Risk**: MEDIUM - requires API keys and configuration

### 7. Mobile - No PWA Support [MEDIUM]
**Impact**: Web app cannot be installed or work offline
**Files**: Web package
**Fix**: Add manifest.json, service worker
**Risk**: MEDIUM - could be time-consuming

### 8. Mobile - No Deep Links [MEDIUM]
**Impact**: Cannot open articles from external links
**Files**: Android
**Fix**: Add intent filters for deep links
**Risk**: LOW - additive feature

## LOW Priority (Document Only)

- No formal ADRs - document major decisions
- No changelog versioning - requires release process
- No push notifications - feature decision
- No app shortcuts/widgets - nice to have

## Implementation Order

1. **Fix accessibility issues** (low risk, high impact)
2. **Fix edge cases** (low risk, prevents future bugs)
3. **Consider observability additions** (requires setup)

## Verification Checklist

- [ ] Android contentDescription added
- [ ] Color contrast verified
- [ ] Timestamp overflow protection added
- [ ] Rate limiter graceful degradation added
- [ ] All tests pass
- [ ] No lint errors
- [ ] No typecheck errors
