# Contributing

Thanks for helping improve SelfFeed.

## Development Setup

1. Install Bun.
2. Run `bun install`.
3. Copy `.env.example` to `packages/api/.env`.
4. Start Redis with `bun run dev:infra`.
5. Run the app with `bun run dev`.

SQLite data is stored locally and is ignored by Git.

## Checks

Before opening a pull request, run:

```bash
bun run lint
bun run typecheck
bun run test:unit
bun run build
bun audit --audit-level high
```

Run integration and E2E tests when changing API, auth, sync, database, or web flows:

```bash
bun run test:integration
bun run test:e2e
```

Regenerate and commit OpenAPI output after API contract changes:

```bash
bun run openapi:generate
```

For production-bound changes, run the full workspace suite:

```bash
bun run test:all
```

Android is checked separately:

```bash
bun run android:check
```

## Pull Requests

- Keep changes focused.
- Update shared contracts before downstream API/web/Android consumers when payload shapes change.
- Regenerate `packages/api/openapi.json` after API contract changes.
- Include tests for behavior changes.
- Do not commit generated build output, local databases, or real secrets.
