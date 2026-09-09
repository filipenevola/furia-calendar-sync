# Brazilian CS Calendar Sync

Finite Bun job that synchronizes **FURIA, Legacy, paiN and MIBR** matches from HLTV
into the existing Google Calendar. The repository name is kept for compatibility.

## Source and time zones

The authoritative source is each team's **Upcoming matches** section:

- [FURIA — 8297](https://www.hltv.org/team/8297/furia)
- [Legacy — 12468](https://www.hltv.org/team/12468/legacy)
- [paiN — 4773](https://www.hltv.org/team/4773/pain)
- [MIBR — 9215](https://www.hltv.org/team/9215/mibr)

`data-unix` is an absolute UTC timestamp in **milliseconds**. Never parse the
visible localized date/time or add/subtract a fixed offset. Google receives ISO
UTC instants with `CALENDAR_TIME_ZONE` (default `America/Campo_Grande`) for display.
Example: `2026-09-09T06:00:00Z` is **02:00 in Campo Grande**, not 03:00.
The calendar viewer may display the event in their own selected timezone.

HLTV match-detail pages can be blocked independently of team pages. Production
uses only the four team pages; **format, venue and streams are omitted when not
confirmed**, rather than guessed. Event duration is an estimated two hours, not
a guaranteed finish time. Each event links to its HLTV match page and has 60/15
minute popup reminders. The detail parser remains for fixture cross-check tests,
not as a production dependency.

## Safety and identity

- All four team pages must load and validate before any calendar write.
- HTTP 403/429, challenge HTML, malformed timestamps, missing sections and
  conflicting data fail the run; they are not successful empty schedules.
- An explicit "No upcoming matches" section is a valid empty result.
- Only future matches are synchronized; live and completed matches are omitted.
- `hltv_<matchId>` identifies an event across rescheduling. A derby appears once,
  while two matches between the same teams in one event remain separate.
- Deterministic Google event IDs make retries idempotent, including an uncertain
  insert. Pagination is followed; unrelated calendar events are never modified.
- Existing Draft5 FURIA events are adopted **in place** only when opponent and
  start time (within six hours) uniquely identify them. Ambiguity aborts the plan
  before writes. A repeat sync cannot create a second copy of a migrated event.
- A title starting with `-n` (ignoring leading whitespace, as in Pager) keeps
  that marker on every update. Example: `-n 🎮 Legacy vs FURIA`. Date, opponent
  and other source-managed fields still update normally. Remove the prefix in
  Calendar to stop preserving it. New events do not get the prefix automatically.
- No automatic event deletion: disappearance from an upcoming list is not proof
  of cancellation. Existing entries for disappeared/cancelled matches need review.
- API write errors exit nonzero. Partial writes can safely be rerun by stable ID.
- No web server, in-process cron, persistent storage or public host is needed.

## Run and test

```sh
bun install --frozen-lockfile
bun test
bun run sync --dry-run                 # live HLTV, no Calendar access
bun run sync --dry-run --check-calendar # read real Calendar and preview actions
bun run test:live --check-calendar      # 3 read-only rounds, 30 seconds apart
bun run sync                           # writes unless DRY_RUN=true
```

Credentials are needed only for calendar access. `GOOGLE_CREDENTIALS` accepts a
Google service-account JSON object or its base64 encoding. Share the existing
calendar with that service account with edit access. `GOOGLE_CALENDAR_ID` accepts
its raw ID or base64-encoded ID. Do not commit credentials. Optional
`SLACK_ERROR_WEBHOOK` preserves failure notifications. `DRY_RUN=true` is an
additional environment-level write guard; `--dry-run` always prevents writes.
`VALIDATION_ROUNDS` and `VALIDATION_INTERVAL_MS` tune the read-only live script.

## Quave ONE

See [quaveone.md](quaveone.md) for exact IDs and [validation evidence](docs/hltv-validation.md).

The new entity is a **Job** (`dockerPreset: JOB`), not an always-on App. Its command
runs once and exits. Set `maxConcurrency: 1`, `backoffLimit: 0`, timeout 600s. A
recurring schedule lives on the **environment**, separate from `jobConfig`:

- Cron: `*/30 * * * *` (same cadence as the old service).
- Timezone: `America/Campo_Grande`.
- Job settings require Apply changes; schedule updates take effect immediately.
- Successful build state is `JOB_READY`; a successful execution is `SUCCEEDED`.

Before cutover: deploy with `DRY_RUN=true`, keep schedule disabled, and require
several successful read-only runs **from us-5**, not just from the Mac. Then stop
(the old environment is never deleted), enable real writes, verify the first
write and an idempotent repeat, and finally enable recurring runs. Preserve the
old v5 deployment and its variables for rollback.

Rollback: disable the new schedule first, wait/cancel any active run, restore
`DRY_RUN=true`, then start the old environment's preserved v5. Do not deploy this
new finite-job code into the old web App. Old source is commit `8c7dbe5`.

Docs read via MCP: [App Types](https://docs.quave.cloud/deploy/app-types),
[Jobs](https://docs.quave.cloud/deploy/jobs).
