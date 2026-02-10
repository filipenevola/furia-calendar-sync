/**
 * Standardized Match format
 * 
 * All retrieval logic must return matches in this format.
 * This allows swapping retrieval implementations without affecting calendar sync.
 * 
 * @typedef {Object} Match
 * @property {Date} date - Match date/time (JavaScript Date object, UTC)
 * @property {string} opponent - Opponent team name
 * @property {boolean} isHome - true if FURIA is listed as teamA (higher seed / "home" side)
 * @property {string} competition - Tournament/competition name (e.g., "PGL Cluj-Napoca 2026")
 * @property {string} location - Venue/location name
 * @property {string} broadcast - Stream/broadcast info (e.g., "Twitch: gaules") - optional
 * @property {string} format - Match format (e.g., "MD3", "MD5") - optional
 * @property {string} source - Source identifier for debugging (e.g., "draft5.gg")
 */

export {};
