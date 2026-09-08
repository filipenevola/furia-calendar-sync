# Quave ONE — Brazilian CS Calendar Sync

Account: **filipenevola**, `KPADFfTBDQnk8J2Yv`.

## New Job

- App: **br-cs-calendar-sync**, `CPFsLhPHnPC9QAfch`, `dockerPreset: JOB`.
- Environment: **production**, `rt4rMyvTuqNBZiZLX`, region **us-5**.
- CLI env: `filipenevola-br-cs-calendar-sync-production`.
- Resources: 1 zCloud, 0.5 CPU, 512 MB. No public host or persistent volume.
- Job: `bun run src/job.js`, `/app`, timeout 600s, backoff 0, maxConcurrency 1.
- Schedule: `*/30 * * * *`, `America/Campo_Grande`.
- Variables copied from old production, retaining values and build/runtime scope.
  Slack webhook is now marked secret. `CALENDAR_TIME_ZONE` and `DRY_RUN` are added.
- During validation: `DRY_RUN=true`, command has `--dry-run`, schedule disabled.
- [Dashboard](https://app.quave.cloud/account/KPADFfTBDQnk8J2Yv/app/CPFsLhPHnPC9QAfch/env/rt4rMyvTuqNBZiZLX)

## Preserved old App — rollback target

- App: **furia-calendar-sync**, `tPtbt6w5LP9bR9oPq`, `CUSTOM`.
- Environment: **production**, `XfX3mdKCBKPEtzXAv`, region **us-5**.
- CLI env: `filipenevola-furia-calendar-sync-production`.
- Deployment: `wa-furia-calendar-sync-production`.
- Preserved content: **v5**, `dRAfGbvp4EJndzHam`.
- Resources: 1 container, 1 zCloud, 0.5 CPU, 512 MB, volume `/data`.
- Must remain RUNNING until validation passes; then STOPPED, never deleted.
- [Dashboard](https://app.quave.cloud/account/KPADFfTBDQnk8J2Yv/app/tPtbt6w5LP9bR9oPq/env/XfX3mdKCBKPEtzXAv)

See `docs/hltv-validation.md` for release state and evidence. No secret values
belong in this file. Never use the old environment token to deploy the new code.
