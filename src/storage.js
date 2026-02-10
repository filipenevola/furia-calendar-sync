import { logger, ensureError } from './logger.js';
import { writeFile, readFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

// Use /data for persistent storage (mount as Docker volume)
// Falls back to /tmp if DATA_DIR is not set (for local development)
const DATA_DIR = process.env.DATA_DIR || '/data';
const STATUS_FILE = join(DATA_DIR, 'furia-sync-status.json');

/**
 * Ensures the data directory exists
 */
async function ensureDataDir() {
  if (!existsSync(DATA_DIR)) {
    try {
      await mkdir(DATA_DIR, { recursive: true });
      logger.info(`[STORAGE] Created data directory: ${DATA_DIR}`);
    } catch (err) {
      // Directory might already exist due to race condition, that's fine
      if (err.code !== 'EEXIST') {
        throw err;
      }
    }
  }
}

export async function saveRunStatus(status) {
  try {
    await ensureDataDir();
    await writeFile(STATUS_FILE, JSON.stringify(status, null, 2), 'utf-8');
    logger.debug(`[STORAGE] Saved run status to ${STATUS_FILE}`);
  } catch (err) {
    const error = ensureError(err);
    logger.error(`[STORAGE] Failed to save run status to ${STATUS_FILE}`, error);
  }
}

export async function getLatestRunStatus() {
  try {
    if (!existsSync(STATUS_FILE)) {
      logger.debug(`[STORAGE] Status file not found: ${STATUS_FILE}`);
      return {
        status: 'no_runs',
        message: 'No sync runs have been executed yet',
        storage_path: STATUS_FILE
      };
    }
    
    const content = await readFile(STATUS_FILE, 'utf-8');
    logger.debug(`[STORAGE] Read run status from ${STATUS_FILE}`);
    return JSON.parse(content);
  } catch (err) {
    const error = ensureError(err);
    logger.error(`[STORAGE] Failed to read run status from ${STATUS_FILE}`, error);
    return {
      status: 'error',
      message: `Failed to read status: ${error.message}`,
      storage_path: STATUS_FILE
    };
  }
}
