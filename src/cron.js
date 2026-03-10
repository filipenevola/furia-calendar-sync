/**
 * Cron scheduler for daily sync
 * 
 * Handles automatic scheduling of the sync process using node-cron.
 * The schedule can be customized via the CRON_SCHEDULE environment variable.
 */

import cron from 'node-cron';
import { sync } from './sync.js';
import { logger } from './logger.js';

/**
 * Starts the cron scheduler for periodic sync
 * 
 * Default schedule: every 30 minutes
 * Can be overridden with CRON_SCHEDULE env var
 */
export function startCronScheduler() {
  const cronSchedule = process.env.CRON_SCHEDULE || '*/30 * * * *';

  logger.info(`📅 Scheduling sync with cron: ${cronSchedule}`);

  cron.schedule(cronSchedule, async () => {
    logger.info('⏰ Scheduled sync triggered');
    try {
      await sync();
      logger.info('✅ Scheduled sync completed successfully');
    } catch (err) {
      logger.error('❌ Scheduled sync failed', err);
    }
  }, {
    scheduled: true,
    timezone: 'UTC'
  });

  logger.info('✅ Sync scheduler started');
}
