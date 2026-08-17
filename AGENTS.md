# Repository Agent Instructions

These instructions apply to every coding agent working in this repository.

## Database migration safety

- Every persistent database schema change must include a clear, explicit forward migration in the same change. This applies to API/Drizzle databases, Android Room databases, and any future persistent store.
- Always increment the appropriate schema or database version. Never publish two different schemas under the same version.
- Migrations must preserve existing user data, sessions, offline caches, and queued mutations. Do not use destructive migration fallbacks, clear application data, or delete a database unless Gustavo explicitly approves that data loss.
- Add migration tests for every supported upgrade path. When a historical schema variant exists, keep a regression fixture for that exact layout or identity hash and verify both schema validation and data preservation.
- Validate both a clean database creation and an upgrade from the latest released schema before considering a database change complete.
