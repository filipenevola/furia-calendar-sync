# HLTV migration validation — 2026-09-08

## Scope and source

Four team pages (FURIA 8297, Legacy 12468, paiN 4773, MIBR 9215), verified by both
name and numeric ID. Test fixtures are minimal public HTML excerpts captured
2026-09-08; they contain no browser cookies or credentials.

## Evidence so far

- 24 automated tests, 84 assertions: UTC milliseconds, midnight boundary,
  calendar timezone, source failures, explicit empty schedule, identity checks,
  derby/rematch deduplication, pagination, legacy migration, dry-run zero writes,
  retry safety and propagated Calendar errors.
- Three Mac read-only rounds succeeded at 12:31:31Z, 12:32:15Z, 12:32:57Z.
  Those first rounds included optional match-detail fetching.
- First us-5 experiment (v1, JobRun `o8xGSYs57N776rQyC`) **FAILED**, exit 1:
  HLTV HTTP 403 on Legacy's match-detail page after all four team pages loaded.
  No Calendar access or writes occurred. This was a release-gate failure, not
  a successful migration. Production was not stopped.
- v2 removes the optional match-detail dependency. Only team pages are needed
  for the schedule. Format/venue/stream metadata is omitted rather than invented.

## Timezone cross-check

Captured team-page timestamps and separate match pages agree:

| Match | UTC | America/Campo_Grande |
| --- | --- | --- |
| Legacy vs Alliance (2397608) | Sep 9, 06:00 | Sep 9, 02:00 |
| MIBR vs 9z (2397604) | Sep 9, 06:00 | Sep 9, 02:00 |
| paiN vs Back to Back (2397731) | Sep 9, 23:00 | Sep 9, 19:00 |

FURIA vs GamerLegion was listed but had already started, so was correctly excluded
from upcoming writes. Listing all four teams does not imply all four have future
fixtures in every run.

## Release gate

Pending: successful repeated us-5 reads, live Calendar plan, write + idempotent
repeat, scheduled JobRun, and stopped old environment. Do not claim cutover based
on local tests or JOB_READY alone.

## v2 gate passed (read-only)

- Mac team-page-only rounds: 12:34:45Z, 12:35:21Z, 12:35:58Z, all success.
- us-5 JobRun `efFuAoTBTMA2cezR3`, content `7rrHYxaHZpcNMDFf2` (v2):
  **SUCCEEDED**, exit 0, 12:34:37Z–12:36:18Z.
- Three server rounds at 12:34:54Z, 12:35:34Z, 12:36:15Z each validated all four
  team pages, found the same three future fixtures, and read the real calendar.
  Plan each time: 3 creates, 0 updates, 0 migrations. **Zero writes**.
- Runtime-variable values and BUILD/DEPLOY scope compared equal against all four
  original variables. Secret values never included in evidence or source control.
- Same 24 tests/84 assertions pass under both `TZ=UTC` and `TZ=Pacific/Auckland`.
