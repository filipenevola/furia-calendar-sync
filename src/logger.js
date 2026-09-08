import { createLogger } from '@quave/logger';

const REPO = 'filipenevola/furia-calendar-sync';
const BRANCH = process.env.GIT_BRANCH || 'main';
const APP_ENV_ID = process.env.QUAVE_APP_ENV_ID || 'rt4rMyvTuqNBZiZLX';
const CURSOR_TAG = `<@U0A52LNRDK3> repo=${REPO}, branch=${BRANCH}\nUse Quave ONE MCP to investigate: get-logs appEnvId=${APP_ENV_ID}, get-app-env-status appEnvId=${APP_ENV_ID}, get-app-env-pods appEnvId=${APP_ENV_ID}`;

// Initialize logger with Slack error webhook
const slackWebhookUrl = process.env.SLACK_ERROR_WEBHOOK;

// Validate Slack webhook URL format
function isValidSlackWebhook(url) {
  if (!url) return false;
  return typeof url === 'string' && 
         url.startsWith('https://hooks.slack.com/services/') &&
         url.length > 40;
}

const isSlackEnabled = isValidSlackWebhook(slackWebhookUrl);

if (process.env.SLACK_ERROR_WEBHOOK && !isSlackEnabled) {
  console.warn('[LOGGER] SLACK_ERROR_WEBHOOK appears to be invalid - Slack notifications disabled');
  console.warn('[LOGGER] Webhook URL should start with: https://hooks.slack.com/services/');
} else if (!isSlackEnabled) {
  console.warn('[LOGGER] SLACK_ERROR_WEBHOOK not set - Slack notifications disabled');
}

const baseLogger = createLogger({
  appName: 'br-cs-calendar-sync',
  environment: process.env.NODE_ENV || 'production',
  debug: {
    enabled: true,
    filter: ['SYNC'],
  },
  slack: {
    enabled: isSlackEnabled,
    webhookUrl: isSlackEnabled ? slackWebhookUrl : undefined,
    webhookUrls: isSlackEnabled ? {
      error: slackWebhookUrl,
    } : undefined,
    skipInDevelopment: false,
  },
});

export const logger = {
  ...baseLogger,
  error(message, ...rest) {
    baseLogger.error(`${message}\n\n${CURSOR_TAG}\n\nwhat is going on?`, ...rest);
  },
  errorBackground(message, ...rest) {
    baseLogger.errorBackground(`${message}\n\n${CURSOR_TAG}\n\nwhat is going on?`, ...rest);
  },
};

// Helper to ensure errors are always Error objects for proper Slack formatting
export function ensureError(error) {
  if (error instanceof Error) {
    return error;
  }
  if (typeof error === 'string') {
    return new Error(error);
  }
  if (error && typeof error === 'object') {
    const err = new Error(error.message || error.error || 'Unknown error');
    if (error.code) err.code = error.code;
    if (error.stack) err.stack = error.stack;
    return err;
  }
  return new Error(String(error));
}
