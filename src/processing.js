/**
 * Match processing logic
 * 
 * This module processes matches from retrieval logic before syncing to calendar.
 * Works with standardized Match format - independent of retrieval source.
 */

import { logger } from './logger.js';

/**
 * Generates a unique key for a match based on teams and competition
 * This key is stable even when date/time changes, preventing duplicates
 * @param {Match} match - Match object
 * @returns {string} Unique key for the match
 */
export function getMatchUniqueKey(match) {
  // Normalize team names and competition for consistent keys
  const normalize = (str) => str.toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  const opponent = normalize(match.opponent);
  const competition = normalize(match.competition);
  
  // Key format: furia_vs_{opponent}_{competition}
  return `furia_vs_${opponent}_${competition}`;
}

/**
 * Filters and processes matches: removes past matches, deduplicates, sorts
 * @param {Match[]} matches - Raw matches from retrieval logic
 * @returns {Match[]} Processed matches ready for calendar sync
 */
export function processMatches(matches) {
  const now = new Date();
  
  // Filter for future matches only
  const futureMatches = matches.filter(match => match.date > now);
  
  // Remove duplicates using unique key (teams + competition)
  // If same teams+competition appears multiple times, keep the one with the earliest date
  const matchMap = new Map();
  
  for (const match of futureMatches) {
    const key = getMatchUniqueKey(match);
    const existing = matchMap.get(key);
    
    if (!existing || match.date < existing.date) {
      matchMap.set(key, match);
    }
  }
  
  const uniqueMatches = Array.from(matchMap.values());
  
  // Sort by date
  uniqueMatches.sort((a, b) => a.date.getTime() - b.date.getTime());
  
  logger.info(`[PROCESSING] Processed ${matches.length} matches: ${uniqueMatches.length} unique upcoming fixtures`);
  
  // Log first few matches
  uniqueMatches.slice(0, 5).forEach((match, idx) => {
    const diff = match.date.getTime() - now.getTime();
    const diffDays = Math.floor(diff / (1000 * 60 * 60 * 24));
    logger.info(`[PROCESSING] Match ${idx + 1}: vs ${match.opponent} - ${match.competition} - Date: ${match.date.toISOString()}, diff: ${diffDays} days${match.format ? ` - ${match.format}` : ''}${match.broadcast ? ` - 📺 ${match.broadcast}` : ''}`);
  });
  
  return uniqueMatches;
}
