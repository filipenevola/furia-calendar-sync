# HLTV 403 job failures — 2026-10-13

All timestamps below are UTC unless explicitly localized.

## What happened

- Eight scheduled runs failed (exit 1, `BackoffLimitExceeded`): 2026-10-12
  22:00 and 22:30, then 2026-10-13 00:00, 01:30, 03:30, 06:30, 07:30, 08:30.
  There were no failed runs from 2026-10-06 until 22:00 on 2026-10-12.
  Successful runs were interleaved; e.g. 09:00, 09:30, 10:00 succeeded on the
  same content v5 (`vXn8zYA2HYYiRteF7`).
- Inspected logs: 08:30 (`h86d8zPG7MXmkgGjb`) got `HLTV HTTP 403` on
  `/team/8297/furia`; 07:30 (`WCoDKczjTW2DkWG9S`) got it on `/team/12468/legacy`.
  The other six failures have the same signature (exit 1 within ~2 minutes) but
  their logs were not opened.
- Cause: HLTV intermittently blocks requests from the us-5 datacenter egress.
  A local dry run from the Mac at 10:25 also got a 403 on `/team/9215/mibr`, then
  loaded the page on the retry 60 seconds later. Quave ONE ran, reported and
  alerted on the Job correctly; this was not a platform failure.
- Impact: none on the Calendar. The all-pages-must-load gate stopped each failed
  run before any Calendar access, and the next successful run brought it up to date.
  The cost was a Slack alert for each blocked run.

## Fix

- A 403/429 or challenge page is an `HltvBlockedError` (`blocked: true`). It is
  still never retried immediately and never treated as an empty schedule.
- `fetchMatches` waits 60 seconds and retries a blocked team page **once per run**.
  The block is logged as a `"status":"warning"` line and reported in `blocks`.
- If HLTV blocks again, `sync` returns `"status":"skipped"` with the reason, without
  reading or writing the Calendar. `job.js` logs that line and exits 0 with no Slack alert.
- Every other failure (parser/layout drift, 5xx after retries, Calendar errors)
  still exits 1 and alerts. Conflicting team-page snapshots now use the same
  Calendar-untouched skip, without changing the block streak.
- Known gap: the Job has no persistent state, so a block that lasts for hours
  shows up only as consecutive `skipped` runs in the logs, without an alert.

## paiN removed

Filipe asked to stop syncing paiN on 2026-10-13. paiN (4773) was removed from
`TEAMS`, so its team page is no longer fetched. This also means one fewer HLTV
request per run. A FURIA/Legacy/MIBR match against paiN still syncs from the
tracked team's page. The 10:00 run listed 0 upcoming paiN matches, so the Calendar
has no future paiN-only events to clean up. Past events were left as they are,
since the sync never deletes events.

## Production verification

- PR #4, merge commit 91f98013b9ded3de247a584ddae31d0afc03c2aa. CI run 38383547668:
  tests passed and the deploy succeeded (new content `YsKGxpDWNbLNRbYMz`).
- First scheduled run on the new content: `wGfNCbHu7ZFpbeSqd` (10:30) SUCCEEDED,
  exit 0. Coverage listed only FURIA, Legacy and MIBR. HLTV did not block that
  run, so the skip path has been proven only by tests and the local live retry.

## Follow-up: block streak and Factory reporting (same day)

Filipe saw Slack errors after the first fix; all eight were from before it was deployed.
He asked to stay quiet about 403s unless they persist, to drop the Cursor tag, and
to send real failures to Filipe Nevola Factory.

- Consecutive skipped runs are counted in one private event on the service account's
  own calendar. Slack gets one warning on blocked runs 10, 20, 30, …
  (`BLOCK_NOTIFY_EVERY`). Any successful sync resets the count, so blocks that come
  and go never notify. The counter only matters when HLTV stops the sync for hours.
- Real failures `POST /work` to the work controller with a stable fingerprint
  (numbers and URLs normalized), so repeats join the open work item. A reporting
  failure is logged and never hides the original error.
- The Slack error no longer tags Cursor; it states the failure and the Factory work ID.
- `FACTORY_WORK_BEARER` was added as a secret runtime variable on
  `rt4rMyvTuqNBZiZLX` (the controller's `WORK_BEARER`).
- PR #5, merge dea8ae1; deployed as content `NKKbsmP5PXKLkLiyp`. One-off production
  JobRun `eYYuvgpog5pRGBoru` used the real service account to record blocked runs
  (1, 2), reset (`previousStreak` 2, then 0), and `GET /work` → 200 with the bearer.
  No synthetic failure was posted, so no paid Factory investigation was started.
- Same Factory reporting shipped to palmeiras-calendar-sync (PR #3, bf0082a, v65).
