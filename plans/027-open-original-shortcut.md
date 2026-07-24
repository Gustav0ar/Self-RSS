# Plan 027: Make the web `v` shortcut open the publisher article

> **Drift check**: `git diff --stat b34c5b9..HEAD -- packages/shared/src packages/api/src/repositories/article-search.ts packages/api/src/repositories/article.repository.ts packages/api/src/services/article-cache.model.ts packages/api/src/services/article.service.ts packages/api/src/openapi packages/web/src/components/articles/feed-view.tsx packages/web/tests packages/api/tests packages/api/openapi.json`

## Status

- **State**: DONE
- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `b34c5b9`, 2026-07-24

## Why this matters

Help and README promise that `v` opens the original publisher page, but the
handler opens another internal reader tab. Keyboard-first users receive the
wrong action, and the current unit test codifies the mismatch.

## Current state

- `packages/web/src/components/help/keyboard-help.tsx:12-20` labels `v` as
  “Open original article.”
- `packages/web/src/components/articles/feed-view.tsx:256-263` opens
  `/articles/:id`.
- `packages/shared/src/contracts/api.ts:141-155` omits `canonicalUrl` from
  `ArticleListItem`, although repository detail paths already select it.
- `packages/api/src/repositories/article-search.ts:74` must be updated with
  every list-field addition because search uses explicit SQL aliases.

## Scope

In scope: canonical URL on article list/search/cache/OpenAPI contracts, web
shortcut behavior, safe fallback/copy, API/web tests. Out of scope: reader
enrichment, URL rewriting, Android sharing, or changing the internal article
route.

## Steps

1. Add nullable `canonicalUrl` to the shared list contract and every API list,
   search, cached-list, and mapping path. Regenerate OpenAPI.
2. Add API unit/integration tests proving normal article lists, cached lists,
   and FTS search all return the same canonical URL.
3. Change `onOpenExternal` to open the canonical URL with
   `noopener,noreferrer`. If it is missing or invalid, keep the user in the
   reader and expose a concise non-destructive status rather than opening an
   internal duplicate.
4. Replace the incorrect test expectation and add keyboard E2E coverage for
   valid and absent canonical URLs.

## Verification

- `mise exec -- bun run test:unit`, `mise exec -- bun run test:integration`,
  and `mise exec -- bun run test:e2e` exit 0.
- `mise exec -- bun run openapi:generate` produces reviewed intentional drift
  only for `ArticleListItem.canonicalUrl`.
- Typecheck, lint, and build pass.

## STOP conditions

Stop if the canonical URL would be derived from unsanitized article HTML or if
one list path cannot provide it without an N+1 query.

## Maintenance notes

Keep explicit search SQL, repository projections, cache models, shared
contracts, and OpenAPI synchronized whenever article-list fields change.
