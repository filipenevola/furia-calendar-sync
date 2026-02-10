/**
 * Retrieval logic for draft5.gg
 * 
 * This module fetches FURIA CS match data from draft5.gg.
 * Draft5.gg is a Next.js app that embeds match data in __NEXT_DATA__ script tag.
 * To change the data source, create a new retrieval module and update the import in sync.js.
 * All functions here must return matches in the standardized Match format.
 */

import { logger, ensureError } from '../logger.js';
import * as cheerio from 'cheerio';

const DRAFT5_TEAM_URL = 'https://draft5.gg/equipe/330-FURIA';
const DRAFT5_UPCOMING_URL = 'https://draft5.gg/equipe/330-FURIA/proximas-partidas';

const DRAFT5_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
  'Cache-Control': 'no-cache'
};

/**
 * Fetches HTML from a URL with retry logic
 * @param {string} url - URL to fetch
 * @param {number} retries - Number of retry attempts
 * @returns {Promise<string|null>} - HTML content or null if page not found
 */
async function fetchHTML(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      logger.debug(`[RETRIEVAL] Fetching HTML: ${url} (attempt ${i + 1}/${retries})`);
      const response = await fetch(url, { headers: DRAFT5_HEADERS });
      
      if (response.ok) {
        const html = await response.text();
        logger.debug(`[RETRIEVAL] Success! Got ${html.length} bytes`);
        return html;
      }
      
      if (response.status === 404 || response.status === 410) {
        logger.info(`[RETRIEVAL] Page not found (${response.status}): ${url}`);
        return null;
      }
      
      logger.warn(`[RETRIEVAL] HTTP ${response.status} - ${response.statusText}`);
    } catch (error) {
      logger.warn(`[RETRIEVAL] Attempt ${i + 1} failed: ${error.message}`);
    }
    
    if (i < retries - 1) {
      const delay = 1000 * (i + 1);
      logger.debug(`[RETRIEVAL] Waiting ${delay}ms before retry...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  
  throw new Error(`Failed to fetch HTML after ${retries} attempts`);
}

/**
 * Extracts __NEXT_DATA__ JSON from HTML page
 * @param {string} html - HTML content
 * @returns {Object|null} - Parsed JSON data or null
 */
function extractNextData(html) {
  const $ = cheerio.load(html);
  const scriptTag = $('script#__NEXT_DATA__');
  
  if (scriptTag.length === 0) {
    logger.warn('[RETRIEVAL] No __NEXT_DATA__ script tag found');
    return null;
  }
  
  try {
    return JSON.parse(scriptTag.html());
  } catch (err) {
    logger.warn(`[RETRIEVAL] Failed to parse __NEXT_DATA__: ${err.message}`);
    return null;
  }
}

/**
 * Cleans HTML tags from venue place string
 * @param {string} venuePlace - Venue string with possible HTML tags
 * @returns {string} - Clean venue string
 */
function cleanVenuePlace(venuePlace) {
  if (!venuePlace) return '';
  return venuePlace.replace(/<br\s*\/?>/gi, ', ').replace(/<[^>]+>/g, '').trim();
}

/**
 * Converts a draft5.gg match object to standardized Match format
 * @param {Object} match - Match object from draft5.gg API
 * @returns {Match|null} - Standardized match or null if invalid
 */
function convertMatch(match) {
  try {
    // matchDate is a Unix timestamp (seconds since epoch, UTC)
    const matchDate = new Date(match.matchDate * 1000);
    
    if (isNaN(matchDate.getTime())) {
      logger.warn(`[RETRIEVAL] Invalid match date for match ${match.matchId}`);
      return null;
    }
    
    // Determine opponent (FURIA is teamId 330)
    const isFuriaTeamA = match.teamA?.teamId === 330;
    const opponent = isFuriaTeamA ? match.teamB : match.teamA;
    
    if (!opponent || !opponent.teamName) {
      logger.warn(`[RETRIEVAL] Missing opponent data for match ${match.matchId}`);
      return null;
    }
    
    // Tournament info
    const tournament = match.tournament || {};
    const tournamentName = tournament.tournamentName || 'Unknown Tournament';
    const venuePlace = cleanVenuePlace(tournament.venuePlace);
    const isLan = tournament.isLan || false;
    
    // Stream info
    let broadcast = '';
    if (match.mainStream && match.mainStream.streamChannel) {
      const platform = match.mainStream.streamPlatform || 'Twitch';
      broadcast = `${platform}: ${match.mainStream.streamChannel}`;
    }
    
    // Format (MD3, MD5, etc.)
    const format = match.bestOf ? `MD${match.bestOf}` : '';
    
    return {
      date: matchDate,
      opponent: opponent.teamName,
      isHome: isFuriaTeamA,
      competition: tournamentName,
      location: isLan ? (venuePlace || 'LAN') : 'Online',
      broadcast: broadcast,
      format: format,
      source: 'draft5.gg'
    };
  } catch (err) {
    logger.warn(`[RETRIEVAL] Failed to convert match ${match?.matchId}: ${err.message}`);
    return null;
  }
}

/**
 * Fetches matches from a specific draft5.gg page
 * @param {string} url - URL to fetch
 * @returns {Promise<Match[]>} - Array of matches
 */
async function fetchMatchesFromPage(url) {
  const html = await fetchHTML(url);
  if (!html) return [];
  
  const nextData = extractNextData(html);
  if (!nextData) return [];
  
  const pageProps = nextData.props?.pageProps || {};
  const rawMatches = pageProps.matches || [];
  
  logger.info(`[RETRIEVAL] Found ${rawMatches.length} upcoming matches from ${url}`);
  
  const matches = [];
  for (const rawMatch of rawMatches) {
    // Skip finished matches
    if (rawMatch.isFinished || rawMatch.isOver) {
      continue;
    }
    
    const match = convertMatch(rawMatch);
    if (match) {
      matches.push(match);
    }
  }
  
  return matches;
}

/**
 * Retrieves FURIA matches from draft5.gg
 * Fetches both the main team page and the upcoming matches page
 * @returns {Promise<Match[]>} Array of matches in standardized format
 */
export async function fetchFuriaMatches() {
  logger.info('[RETRIEVAL] Fetching FURIA matches from draft5.gg...');
  
  try {
    const now = new Date();
    logger.info(`[RETRIEVAL] Current date/time: ${now.toISOString()}`);
    
    const allMatches = [];
    
    // Fetch from both pages to maximize coverage
    const pages = [
      { url: DRAFT5_TEAM_URL, name: 'Team Summary' },
      { url: DRAFT5_UPCOMING_URL, name: 'Upcoming Matches' },
    ];
    
    for (const page of pages) {
      try {
        logger.info(`[RETRIEVAL] Fetching ${page.name} from ${page.url}...`);
        const matches = await fetchMatchesFromPage(page.url);
        
        logger.info(`[RETRIEVAL] Found ${matches.length} matches from ${page.name}`);
        allMatches.push(...matches);
        
        // Small delay between requests
        await new Promise(r => setTimeout(r, 500));
      } catch (err) {
        logger.warn(`[RETRIEVAL] Failed to fetch ${page.name}:`, err.message);
        // Continue with other pages even if one fails
      }
    }
    
    // Deduplicate by matchId (same match may appear on both pages)
    const uniqueMatches = [];
    const seenOpponents = new Set();
    
    for (const match of allMatches) {
      const key = `${match.opponent}_${match.competition}_${match.date.getTime()}`;
      if (!seenOpponents.has(key)) {
        seenOpponents.add(key);
        uniqueMatches.push(match);
      }
    }
    
    logger.info(`[RETRIEVAL] Total unique matches found: ${uniqueMatches.length}`);
    return uniqueMatches;
  } catch (err) {
    const error = ensureError(err);
    logger.error('[RETRIEVAL] Failed to fetch matches', error);
    throw err;
  }
}
