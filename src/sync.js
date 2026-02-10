/**
 * Main sync orchestration
 * 
 * This module orchestrates the entire sync process:
 * 1. Retrieve matches from data source
 * 2. Process matches (filter, deduplicate, sort)
 * 3. Sync matches to Google Calendar
 */

import { logger, ensureError } from './logger.js';
import { saveRunStatus } from './storage.js';
import { GOOGLE_CREDENTIALS } from './config.js';
import { fetchFuriaMatches } from './retrieval/draft5.js';
import { processMatches } from './processing.js';
import { syncMatchesToCalendar } from './calendar.js';

function validateEnv() {
  const missing = [];
  if (!GOOGLE_CREDENTIALS) missing.push('GOOGLE_CREDENTIALS');
  
  if (missing.length > 0) {
    const errorMsg = `Missing environment variables: ${missing.join(', ')}`;
    logger.error('[SYNC] Missing environment variables', new Error(errorMsg));
    throw new Error(errorMsg);
  }
}

export async function sync() {
  const runId = `sync-${Date.now()}`;
  const startTime = Date.now();
  
  logger.info('🎮 FURIA Calendar Sync Started', { runId });
  logger.info('══════════════════════════════════════════════════');
  
  try {
    validateEnv();
    
    // Step 1: Retrieve matches (isolated retrieval logic)
    const rawMatches = await fetchFuriaMatches();
    
    // Step 2: Process matches (filter, deduplicate, sort)
    const processedMatches = processMatches(rawMatches);
    
    if (processedMatches.length === 0) {
      logger.info('[SYNC] No upcoming matches found');
      const result = {
        runId,
        status: 'success',
        startTime: new Date(startTime).toISOString(),
        endTime: new Date().toISOString(),
        duration: Date.now() - startTime,
        fixturesFound: 0,
        fixturesCreated: 0,
        fixturesUpdated: 0,
        fixturesSkipped: 0,
      };
      
      await saveRunStatus(result);
      return result;
    }
    
    // Log matches summary
    logger.info(`[SYNC] Matches to sync: ${processedMatches.length}`);
    processedMatches.slice(0, 5).forEach(f => {
      const date = f.date.toLocaleString('pt-BR', { 
        timeZone: 'America/Sao_Paulo',
        dateStyle: 'short',
        timeStyle: 'short'
      });
      logger.info(`  ${date} - vs ${f.opponent} [${f.competition}]${f.format ? ` ${f.format}` : ''}${f.broadcast ? ` 📺 ${f.broadcast}` : ''}`);
    });
    if (processedMatches.length > 5) {
      logger.info(`  ... and ${processedMatches.length - 5} more`);
    }
    
    // Step 3: Sync to calendar (isolated calendar sync logic)
    const syncResult = await syncMatchesToCalendar(processedMatches);
    
    const result = {
      runId,
      status: 'success',
      startTime: new Date(startTime).toISOString(),
      endTime: new Date().toISOString(),
      duration: Date.now() - startTime,
      fixturesFound: processedMatches.length,
      fixturesCreated: syncResult.created,
      fixturesUpdated: syncResult.updated,
      fixturesSkipped: syncResult.skipped,
      errors: syncResult.errors.length > 0 ? syncResult.errors : undefined,
    };
    
    logger.info('══════════════════════════════════════════════════');
    logger.info('✅ Sync completed successfully', result);
    
    await saveRunStatus(result);
    return result;
  } catch (err) {
    const result = {
      runId,
      status: 'error',
      startTime: new Date(startTime).toISOString(),
      endTime: new Date().toISOString(),
      duration: Date.now() - startTime,
      error: err.message,
    };
    
    const error = ensureError(err);
    logger.error('❌ Sync failed', error);
    await saveRunStatus(result);
    throw err;
  }
}
