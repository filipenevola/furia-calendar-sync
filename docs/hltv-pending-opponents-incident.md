# Pending bracket opponents incident — 2026-09-09

All timestamps below are UTC unless explicitly localized.

## Confirmed impact and causes

- FURIA–PARIVISION (2397610): HLTV moved to 12:55Z (08:55 Campo Grande),
  while a read-only Google Calendar check at 12:35:08Z found the single managed
  event still at 12:00Z (08:00). Calendar timezone was correct.
- Last successful scheduled sync: u9CaSTeHKwP9sqs9Q at 07:30Z, still using 12:00Z.
- Ten scheduled runs from 08:00Z through 12:30Z failed. Eight emitted an HLTV
  parser error before Calendar access: four MIBR, then four Legacy.
- Live HTML reproduces the defect: bracket opponents are unlinked spans,
  e.g. PARIVISION/FURIA winner and Astralis/BETBOOM winner. Requiring two linked
  IDs rejected valid fixtures and the all-team safety gate blocked every update.
- The other two failures are separate infrastructure failures in namespace/create:
  rmdmBSupHRCBpgZsC (10:30Z, ETIMEDOUT, terminal 10:44:02Z) and
  wmhnsFL9DWgPqfNzP (12:00Z, ECONNRESET, terminal 12:10:18Z).
  Both have statusReason runJobRunError, no returned exitCode or application logs.
  Infrastructure diagnosis is handed off to Filipe; no claim it is repaired.

## Fix and pre-deploy validation

- PR #2, merge 289945b87935d0f0b6557399010da407d3051d4d.
- Parse both linked teams and explicit unlinked bracket/TBD/TBA placeholders.
  Preserve the exact source label; absent opponent IDs stay null and are omitted
  from Calendar teamIds. Do not infer that FURIA won a bracket.
- Stable hltv_<matchId> means both rescheduling and opponent resolution update
  the existing event instead of creating duplicates.
- Malformed/unknown opponents, missing team identity, source access failures and
  conflicting snapshots still fail closed. No silent partial sync introduced.
- Captured two minimal real HTML fixtures. 28 tests / 104 assertions passed under
  TZ=UTC and TZ=Pacific/Auckland; CI run 34352783174 passed tests and deployment.
- Three local source-only rounds at 12:42:56Z, 12:43:33Z and 12:44:10Z passed,
  each finding all four fixtures including FURIA 12:55Z.
- v4 SohTq5xNukSbjWmQ7 reached JOB_READY with exact merge commit.

## Production verification

- us-5 read-only JobRun 853JghHXFT6A2CYgD SUCCEEDED, exit 0. Three rounds
  at 12:46:18Z, 12:46:59Z and 12:47:39Z: all four fixtures and real Calendar
  reads; plan 2 creates/2 updates, zero writes.
- Write + independent readback uqNevAK6ddcsLHJFy SUCCEEDED, exit 0, finished
  12:48:56Z. Created 2 bracket fixtures and updated 2 existing events.
  Readback 12:48:54Z confirmed exactly one event per HLTV ID and FURIA at 12:55Z,
  with America/Campo_Grande, before the advertised start.
- Repeat + independent readback vWF33R3nzjwG6P35o SUCCEEDED, exit 0, finished
  12:49:59Z. Created 0, updated 4; all four events verified again at 12:49:56Z.
- Old environment XfX3mdKCBKPEtzXAv remains STOPPED with preserved v5.
- Schedule remains revision 3, enabled every 30 minutes in America/Campo_Grande;
  no schedule/configuration changes were made for this repair.
- Unmodified 13:00Z schedule created dSddc6QRBPQseq3hP on v4, trigger SCHEDULED:
  SUCCEEDED, exit 0, 13:00:03Z–13:00:33Z. This proves recovery through the actual
  scheduler, not just an API/manual run. Earlier infrastructure failures remain
  unexplained and require the separate investigation, despite this successful run.
