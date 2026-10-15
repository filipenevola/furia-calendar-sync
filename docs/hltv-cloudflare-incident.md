# HLTV Cloudflare challenge — 2026-10-15

All timestamps below are UTC unless explicitly localized.

## What happened

- From about 2026-10-13 11:00 every scheduled run was skipped with
  `HLTV HTTP 403` (90 in a row by 2026-10-15 08:01, when Slack got the
  block-streak warning). The Calendar was untouched, as designed.
- Impact: FURIA vs Legacy (Thunderpick World Championship 2026, Group B winners
  match, 16:00 UTC / 12:00 Campo Grande on 2026-10-15) was never added.
- Cause: HLTV now serves a Cloudflare managed challenge (`cf-mitigated: challenge`,
  "Just a moment...") to every non-browser request. On 2026-10-15 at 11:57 it
  happened from the Mac too: with Bun's default fetch, with curl, and with a
  browser User-Agent. It is no longer intermittent or datacenter-only, so retrying
  cannot help. We don't try to get around the challenge.

## Fix

- The source is now Liquipedia's MediaWiki API (`action=parse` on each team page),
  which allows automated reads. It sends an identifying User-Agent and gzip, and
  waits 31 seconds between parse requests to stay within the rate limit.
- New fixture key `lp_<sha256(tournament section | stage | both teams)>`. Existing
  `hltv_*` events are adopted in place: the one managed event for the same teams
  within six hours is patched with the new key, so nothing is duplicated and the
  `-n` prefix is kept.
- The skip/streak behavior is unchanged; a 403/429 or API `ratelimited` counts as
  a block. The Slack text now says "The match source" instead of "HLTV".
- Lost: HLTV match IDs and team IDs. Format, venue and streams were already omitted.
