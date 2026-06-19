# Plan 004: Enforce category hierarchy integrity across API, database, and web UI

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the STOP conditions occurs, stop and report. When done, update `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat b14d79b..HEAD -- packages/api/src/db/schema.ts packages/api/src/repositories/category.repository.ts packages/api/src/services/category.service.ts packages/api/src/services/opml-export.service.ts packages/api/tests/unit/category.service.test.ts packages/api/tests/integration/app.integration.test.ts packages/web/src/components/management/category-dialog.tsx packages/web/tests/unit/category-dialog.test.tsx packages/shared/src/contracts/api.ts`

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `b14d79b`, 2026-06-19

## Why this matters

Categories are hierarchical, but the server only rejects a category being its own direct parent. A user or API client can create cycles such as A -> B -> A, and deleting a parent with no direct feeds can leave children pointing at a missing parent. OPML export starts from root categories, so cyclic or orphaned categories can disappear from exports and tree-dependent UI.

## Current state

```ts
// packages/api/src/db/schema.ts:99-104
id: uuidPrimaryKey('id'),
userId: uuid('user_id')
  .notNull()
  .references(() => users.id, { onDelete: 'cascade' }),
parentCategoryId: uuid('parent_category_id'),
```

```ts
// packages/api/src/services/category.service.ts:114-120
if (data.parentCategoryId === categoryId) {
  throw AppError.badRequest('Category cannot be its own parent');
}
if (data.parentCategoryId) {
  const parent = await this.categoryRepo.findById(data.parentCategoryId, userId);
  if (!parent) throw AppError.notFound('Parent category not found');
}
```

```ts
// packages/api/src/services/category.service.ts:137-142
const feedCount = await this.categoryRepo.feedCount(categoryId);
if (feedCount > 0) {
  throw AppError.badRequest('Cannot delete category with feeds. Move or delete feeds first.');
}
return this.categoryRepo.delete(categoryId, userId);
```

```ts
// packages/web/src/components/management/category-dialog.tsx:34-36
const parentOptions = useMemo(
  () => categories.filter((item) => item.id !== category?.id),
  [categories, category?.id],
);
```

OPML export renders only from `parentCategoryId = null` at `opml-export.service.ts:53-55`.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| API unit focus | `bun run --filter '@self-feed/api' test -- tests/unit/category.service.test.ts tests/unit/opml-export.service.test.ts` | exit 0 |
| Web unit focus | `bun run --filter '@self-feed/web' test -- tests/unit/category-dialog.test.tsx` | exit 0 |
| API integration focus | `bun run --filter '@self-feed/api' test:integration -- tests/integration/app.integration.test.ts` | exit 0 |
| Migration generation, if schema changes | `bun run db:generate` | exit 0 and creates/reconciles migration |
| Typecheck | `bun run typecheck` | exit 0 |

## Scope

**In scope**:

- `packages/api/src/db/schema.ts`
- `packages/api/src/repositories/category.repository.ts`
- `packages/api/src/services/category.service.ts`
- `packages/api/tests/unit/category.service.test.ts`
- `packages/api/tests/integration/app.integration.test.ts`
- `packages/web/src/components/management/category-dialog.tsx`
- `packages/web/tests/unit/category-dialog.test.tsx`
- Generated Drizzle migration if a database constraint is added

**Out of scope**:

- Redesigning category tree response shape.
- Changing OPML import semantics except to preserve valid parent chains.
- Deleting or auto-reparenting user categories without an explicit migration strategy.

## Git workflow

- Branch: `advisor/api-web-findings-e2e`
- Suggested commit subject: `Enforce category hierarchy integrity`

## Steps

### Step 1: Add repository helpers for hierarchy checks

Add focused methods to `CategoryRepository`:

- `findDescendants(userId: string, categoryId: string)` or `isDescendant(userId, candidateParentId, categoryId)`.
- `childCount(categoryId: string)` or `hasChildren(categoryId: string)`.

Implementation options:

- For the current scale, loading all user categories and walking parent links in service code is acceptable and easy to test.
- A recursive SQLite CTE is acceptable if kept small and covered by integration tests.

Do not rely on the web UI to enforce integrity.

**Verify**: Add unit coverage through `CategoryService` mocks, or repository integration coverage if using SQL. Run `bun run --filter '@self-feed/api' test -- tests/unit/category.service.test.ts` -> exit 0.

### Step 2: Reject cycles on update

In `CategoryService.update`, when `parentCategoryId` is provided and non-null:

1. Verify the parent exists and belongs to the same user.
2. Reject direct self-parent as today.
3. Reject any parent that is a descendant of the category being edited.

Use `AppError.badRequest` with a clear message such as `Category cannot be moved under one of its descendants.`

**Verify**: Add tests:

- direct self-parent is still rejected;
- unknown parent is still rejected;
- moving a parent under a child is rejected;
- moving under an unrelated category succeeds.

Run API category unit tests -> exit 0.

### Step 3: Reject parent deletion while children exist

In `CategoryService.delete`, reject deletion if the category has child categories, even when it has no direct feeds. Keep the existing feed-count rejection.

Error message should be user-actionable, for example `Cannot delete category with subcategories. Move or delete subcategories first.`

**Verify**: Add tests:

- category with direct feeds is rejected as today;
- category with children and no feeds is rejected;
- category with no feeds and no children deletes.

Run API category unit tests -> exit 0.

### Step 4: Add database-level protection if safe

Update `packages/api/src/db/schema.ts` so `parentCategoryId` references `categories.id` with a deliberate delete behavior. Prefer `onDelete: 'restrict'` because service code should prevent deleting parents before children.

Before generating a migration:

- Inspect current Drizzle self-reference syntax for SQLite. If needed, use the supported `AnySQLiteColumn` pattern.
- Generate a migration with `bun run db:generate`.
- Inspect the generated migration manually. It must not drop category data.
- If existing production data could contain invalid parent ids, include a preflight cleanup/check migration or stop and ask for a data repair decision.

If adding the DB constraint requires a risky table rebuild and no invalid data audit can be performed, STOP and report. Do not silently skip the DB layer; the finding includes database integrity.

**Verify**: `bun run db:generate` -> exit 0. Then run `bun run --filter '@self-feed/api' test:integration -- tests/integration/app.integration.test.ts` -> exit 0.

### Step 5: Filter descendants out of the web parent dropdown

In `CategoryDialog`, compute descendant ids for the category being edited and exclude both the current category and all descendants from `parentOptions`.

Use existing `CategoryWithCounts.parentCategoryId` fields. Do not require `children` to be present because the list may be flat.

**Verify**: Extend `category-dialog.test.tsx`:

- sample categories include at least grandparent -> parent -> child.
- when editing grandparent, both parent and child are absent from parent options.
- unrelated categories remain available.

Run `bun run --filter '@self-feed/web' test -- tests/unit/category-dialog.test.tsx` -> exit 0.

### Step 6: Add end-to-end API regression coverage

In `app.integration.test.ts`, extend category CRUD coverage or add a focused test:

- create root, child, grandchild;
- reject moving root under child or grandchild;
- reject deleting root while child exists;
- allow deleting a leaf with no feeds;
- verify OPML export still includes valid nested categories after allowed operations.

**Verify**: `bun run --filter '@self-feed/api' test:integration -- tests/integration/app.integration.test.ts` -> exit 0.

## Test plan

- API unit tests for cycle prevention and child deletion prevention.
- API integration tests for real route behavior and migration-backed DB behavior.
- Web unit tests for descendant filtering.
- Existing OPML export/import tests continue to pass.

## Done criteria

- [ ] API rejects category cycles at any depth.
- [ ] API rejects deleting categories with child categories.
- [ ] Database layer has a reviewed FK or the plan is blocked with documented migration risk.
- [ ] Web parent picker excludes descendants, not only the current category.
- [ ] API and web focused tests pass.
- [ ] `bun run typecheck` exits 0.
- [ ] `plans/README.md` status row updated.

## STOP conditions

- Generated migration would drop or rewrite category data without a safe migration strategy.
- Current production data has invalid category parent references and needs explicit repair.
- Preventing cycles requires changing the public category response shape.
- UI tests reveal the categories list is not flat and descendant computation would be unreliable without a larger state change.

## Maintenance notes

Reviewer focus: server-side validation is the security boundary. The web filter improves UX but must not be the only protection.
