import { createHash, randomUUID } from 'node:crypto';

// Filipe Nevola Factory: the Warren work controller investigates real failures
// and opens a fix PR or asks on GitHub. HLTV blocks are not sent here.
const REPOSITORY = 'filipenevola/furia-calendar-sync';
const SOURCE = 'br-cs-calendar-sync-job';
const APP_ENV_ID = process.env.QUAVE_APP_ENV_ID || 'rt4rMyvTuqNBZiZLX';
const DEFAULT_URL = 'https://work-controller-production-filipenevola.svc-us5.zcloud.ws';
const RUNS_LINK = `https://app.quave.cloud/account/KPADFfTBDQnk8J2Yv/app/CPFsLhPHnPC9QAfch/env/${APP_ENV_ID}?tab=RUNS`;

// Same failure class -> same fingerprint, so repeats join the active work item
// instead of starting new investigations. Volatile IDs, numbers and URLs are ignored.
export function fingerprint(message) {
  const normalized = String(message).replace(/https?:\/\/\S+/g, '<url>').replace(/\d+/g, '#');
  return `${SOURCE}:${createHash('sha256').update(normalized).digest('hex').slice(0, 32)}`;
}

export function workRequest(error) {
  return {
    type: 'bug',
    repository: REPOSITORY,
    source: SOURCE,
    externalId: `${process.env.HOSTNAME || 'local'}-${randomUUID()}`,
    fingerprint: fingerprint(error.message),
    title: `Calendar sync job failed: ${error.message}`.slice(0, 250),
    description: [
      'The scheduled HLTV -> Google Calendar sync job failed in production and exited 1.',
      'The run stopped before or during Calendar writes; partial writes are safe to rerun by stable ID.',
      `Investigate with Quave ONE MCP: list-app-env-job-runs and get-app-env-job-run-logs appEnvId=${APP_ENV_ID}.`,
      'HLTV 403/429/challenge blocks are expected and handled separately; they are never reported here.',
    ].join('\n'),
    context: {
      message: error.message.slice(0, 16000),
      ...(error.stack ? { stack: error.stack.slice(0, 16000) } : {}),
      environment: 'production',
    },
    links: [RUNS_LINK],
  };
}

// Never throws: a reporting failure must not hide the original error.
export async function reportToFactory(error, { fetchImpl = fetch, env = process.env } = {}) {
  const bearer = env.FACTORY_WORK_BEARER;
  if (!bearer) return { reported: false, reason: 'FACTORY_WORK_BEARER not set' };
  try {
    const response = await fetchImpl(`${env.FACTORY_WORK_URL || DEFAULT_URL}/work`, {
      method: 'POST',
      headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
      body: JSON.stringify(workRequest(error)),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return { reported: false, reason: `work controller HTTP ${response.status}` };
    const { work, duplicate } = await response.json();
    return { reported: true, workId: work?.id, duplicate: Boolean(duplicate) };
  } catch (reportError) {
    return { reported: false, reason: reportError.message };
  }
}
