# Brazilian CS Calendar Sync

Finite Bun job that synchronizes **FURIA, Legacy and MIBR** matches from
Liquipedia into the existing Google Calendar. The repository name is kept for compatibility.

## Source and time zones

Since 2026-10-15 the source is each team's **Upcoming Matches** section on
Liquipedia, read through its MediaWiki API (`action=parse`). HLTV now answers
every scripted request with a Cloudflare challenge, so it can no longer be used
(see [the incident](docs/hltv-cloudflare-incident.md)).

- [FURIA](https://liquipedia.net/counterstrike/FURIA)
- [Legacy](https://liquipedia.net/counterstrike/Legacy)
- [MIBR](https://liquipedia.net/counterstrike/MIBR)

The API terms are respected: an identifying `User-Agent`, gzip, and at most one
parse request every 30 seconds (a run takes about a minute).

`data-timestamp` is an absolute UTC timestamp in **seconds**. Never parse the
visible localized date/time or add/subtract a fixed offset. Google receives ISO
UTC instants with `CALENDAR_TIME_ZONE` (default `America/Campo_Grande`) for display.
Example: `2026-09-09T06:00:00Z` is **02:00 in Campo Grande**, not 03:00.
The calendar viewer may display the event in their own selected timezone.

Liquipedia's upcoming list has no format, venue or streams, so **they are
omitted** rather than guessed. Event duration is an estimated two hours, not
a guaranteed finish time. Each event links to the Liquipedia tournament section
and has 60/15 minute popup reminders.

## Safety and identity

- All team pages must load and validate before any calendar write.
- A rate-limited or blocked page (HTTP 403/429 or API `ratelimited`) is retried
  once after 60 seconds. If it is blocked again, the
  run is **skipped**: Calendar is not read or written, a `"status":"skipped"`
  line with the reason is logged, and the job exits 0 without a Slack alert.
  A block is never treated as an empty schedule. Consecutive blocked runs are
  counted; Slack gets one warning on every 10th (`BLOCK_NOTIFY_EVERY`) and a
  successful sync resets the count. The counter is a private event in the service
  account's **own** calendar (not the shared one), since the Job has no volume. See
  [the 2026-10-13 incident](docs/hltv-403-incident.md).
- When a derby's two team pages list different times (one page is a stale cached
  render), the tournament page settles it: the one listed time it confirms wins,
  after one more rate-limited request. See
  [the 2026-10-23 incident](docs/liquipedia-stale-team-page-incident.md).
- Malformed timestamps, missing sections, other HTTP errors and conflicting data
  the tournament page does not settle fail the run (exit 1); they are not successful empty schedules. Real failures
  are sent to **Filipe Nevola Factory** (the Warren work controller, `POST /work`),
  which investigates and opens a fix PR or asks on GitHub. Repeats of the same
  failure join the open work item. The Slack error says what failed and the work ID.
- An explicit "No upcoming matches" section is a valid empty result.
- Only future matches are synchronized; live and completed matches are omitted.
- `lp_<key>` identifies an event across rescheduling. The key hashes the
  tournament section, stage and both teams. A derby appears once, while two
  matches between the same teams in one event (different stages) remain separate.
- When a key is new (source switch, or a TBD opponent that resolved), the one
  managed event with the same teams within six hours is adopted **in place** and
  rewritten with the new key. More than one candidate aborts before writes.
  Existing `hltv_<matchId>` events were migrated this way.
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
bun run sync --dry-run                 # live Liquipedia, no Calendar access
bun run sync --dry-run --check-calendar # read real Calendar and preview actions
bun run test:live --check-calendar      # 3 read-only rounds, 30 seconds apart
bun run sync                           # writes unless DRY_RUN=true
```

Credentials are needed only for calendar access. `GOOGLE_CREDENTIALS` accepts a
Google service-account JSON object or its base64 encoding. Share the existing
calendar with that service account with edit access. `GOOGLE_CALENDAR_ID` accepts
its raw ID or base64-encoded ID. Do not commit credentials. Optional
`SLACK_ERROR_WEBHOOK` preserves failure notifications. `FACTORY_WORK_BEARER`
(secret, the work controller's `WORK_BEARER`) enables Factory reports;
`FACTORY_WORK_URL` overrides the controller URL. `DRY_RUN=true` is an
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
