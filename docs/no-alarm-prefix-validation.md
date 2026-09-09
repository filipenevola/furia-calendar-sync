# Preserve no-alarm prefix — 2026-09-09

- PR #3; merge b5caf76ff52a465ce5f3baa8a23fce9f98ff96af.
- Matches Pager's current title rule: trimStart().startsWith('-n').
  Only the marker is user-owned; canonical title, time and other fields continue
  to update. Removing the marker in Calendar is respected. New events are unmarked.
- Covered ordinary updates, rescheduling/opponent changes, legacy adoption,
  insert-409 recovery, dry-run plans, repeated writes and explicit marker removal.
- 34 tests / 128 assertions pass under UTC and Pacific/Auckland.
- CI 34355618008 passed and deployed exact merge as v5, vXn8zYA2HYYiRteF7.
- Production JobRun C8QNgHFt7Pw4jRgaW SUCCEEDED, exit 0, finished 13:16:07Z.
  One read-only plan followed by two real sync/readback rounds, 13:15:35Z and
  13:16:05Z: each created 0 and updated 3. Readbacks verified unique fixture IDs,
  exact titles, UTC instants and America/Campo_Grande.
- No upcoming event had the -n marker in those production rounds (markedUpdated=0).
  Actual marker preservation is covered by automated tests, not claimed as
  exercised on a user-marked production event. No live alarms were disabled to
  seed a test.
- Schedule and environment variables unchanged. No side worktree created.
