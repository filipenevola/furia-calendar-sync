# 2026-10-23 — stale Liquipedia team page blocked every sync

## Symptom

From 2026-10-23 every run failed with
`Conflicting Liquipedia team pages for 576eaa01deb340f487af; retry next run`
and was reported to Filipe Nevola Factory (`work_7dce02f2-…`). No team synced,
including FURIA and Legacy's PGL Masters Bucharest matches on 2026-10-24.

## Root cause

`576eaa01deb340f487af` is FURIA vs Legacy, BLAST Rivals Fall 2026, Group A opening
match, listed on both team pages. Live `action=parse` responses at 21:3xZ:

| Page | `data-timestamp` | UTC |
|---|---|---|
| FURIA | 1794362400 | 2026-11-11 02:00 |
| Legacy | 1794366000 | 2026-11-11 03:00 |
| BLAST/Rivals/2026/Fall (revid 3462416) | 1794366000 | 2026-11-11 03:00 |

The match was moved by one hour. The FURIA page is a cached render that still shows
the old time, and it stays stale until the wiki re-renders it. That can take days,
so "retry next run" did not recover. Warren PR #8 would have turned the failure into
a skipped run, but that leaves every team unsynced for as long as the cache stays stale.

## Fix

The tournament page owns the match. On a disagreement, `fetchMatches` waits
`PARSE_INTERVAL_MS`, fetches that one tournament page and keeps the listed time it
confirms (a `.match-info` with the same two opponents). If it confirms neither time
or both, the run still fails closed. Agreeing pages never cause an extra request.

## Proof

- `bun test`: 37 pass. The new derby test fails without the fix.
- Live `bun run sync --dry-run` (2026-10-23 21:43Z): success, 4 fixtures, FURIA vs
  Legacy at 2026-11-11T03:00:00Z.
