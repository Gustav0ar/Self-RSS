# Plan 009: Pin one Bun runtime across local development, docs, and CI

> **Executor instructions**: Follow every step and verification gate. Preserve
> unrelated working-tree changes. Update the status row in `plans/README.md`
> when complete.
>
> **Drift check**: `git diff --stat 5a2575a..HEAD -- mise.toml package.json README.md .github/workflows/ci.yml .github/workflows/security.yml`
> Compare live values before editing; stop if CI intentionally moved to a
> different Bun release.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `5a2575a`, 2026-07-24

## Why this matters

CI pins Bun 1.3.14, `mise.toml` installs `latest`, and the README permits older
versions. Reproducible tooling prevents lockfile, test-runner, and generated
artifact differences between contributors and CI.

## Current state

- `mise.toml:2`: `bun = "latest"`.
- `.github/workflows/ci.yml:18` and `security.yml`: Bun 1.3.14.
- `README.md:9,39`: names 1.3.14 but also says 1.3.10 or higher.
- `package.json` has no `packageManager` field.

## Scope

In scope: `mise.toml`, `package.json`, `README.md`,
`.github/workflows/ci.yml`, `.github/workflows/security.yml`.
Out of scope: dependency upgrades, lockfile rewrites, workflow redesign.

## Steps

1. Make Bun 1.3.14 the single declared version in all five locations. Add
   `"packageManager": "bun@1.3.14"` to `package.json`. Do not regenerate
   `bun.lock` unless Bun proves it necessary.
2. Search the repository for stale Bun version declarations and correct only
   documentation/configuration declarations, not historical changelog text.
3. Run the gates below.

## Test plan and done criteria

- `rg -n 'bun = "latest"|1\.3\.10 or higher' mise.toml README.md package.json .github/workflows`
  returns no matches.
- `bun --version` reports 1.3.14 in a freshly trusted mise environment.
- `bun install --frozen-lockfile`, `bun run lint`, and `bun run typecheck` exit 0.
- `git diff --exit-code -- bun.lock` exits 0.
- Only in-scope files plus `plans/README.md` are modified.

## STOP conditions

Stop if Bun 1.3.14 is unavailable, the frozen lockfile changes, or a newer
version is already deliberately pinned on the execution branch.

## Maintenance notes

Future Bun upgrades must update mise, package metadata, docs, CI, and the
lockfile in one reviewed change.
