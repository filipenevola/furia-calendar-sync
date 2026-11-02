# Liquipedia request timeout — production failure

## What happened

- A scheduled run failed with the message `The operation timed out.`
  (`br-cs-calendar-sync-job:bb1eb23759efeea2d4f25e2f8acb8b53`), exited 1 and was
  reported to Filipe Nevola Factory.
- The message is Bun's `AbortSignal.timeout` error. The only uncaught timeout in
  the job is the 30-second `action=parse` request in `fetchPage`; the Factory's own
  15-second request timeout is caught by `reportToFactory`.
- `fetchPage` retried the timeout three times with a 31-second pause and then threw
  the raw `TimeoutError`. `fetchMatches` only turns `blocked` errors into a skipped
  run, so the timeout propagated to `job.js`, which exited 1 and alerted.

## Root cause

A Liquipedia request that never answers (a hanging connection, which is how an
anti-bot/rate-limit response often behaves) was treated as a hard data failure.
A source that refuses to serve is not data: the run must skip with the Calendar
untouched, exactly like an HTTP 403/429 or API `ratelimited`.

## Fix

- `fetchPage` classifies `TimeoutError` (including an undici `fetch failed` cause)
  as a `SourceBlockedError` instead of retrying it in place. `fetchMatches` then
  applies its existing one-per-run patient retry after 60 seconds, and a second
  timeout skips the run: exit 0, no Slack alert, block streak unchanged in behavior.
- No Calendar access happens before retrieval succeeds, so a skipped run cannot
  leave a partial write.
- A persistently unreachable source still surfaces through the existing block
  streak (Slack warning every 10th consecutive skipped run).

## Evidence

- Reproduced before the fix: a fetch that throws `TimeoutError` retried 3 times in
  `fetchPage` and `sync` propagated the raw error with the exact reported message
  and fingerprint.
- Regression test `a hanging source request is a block, so the run skips instead of
  failing` covers both the single-attempt block classification and the skipped run
  with zero calendar writes.
- `bun test`: 38 pass, 0 fail.
