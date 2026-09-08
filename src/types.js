/**
 * @typedef {Object} Match
 * @property {string} matchId - Stable HLTV match ID (reschedules keep the same ID).
 * @property {Date} date - UTC instant from HLTV data-unix milliseconds.
 * @property {string} team - Canonical tracked team (FURIA, Legacy, paiN, MIBR).
 * @property {number} teamId - HLTV team ID.
 * @property {string} opponent
 * @property {number} opponentId
 * @property {string} competition
 * @property {string} format - Empty unless confirmed; never infer BO3/BO5.
 * @property {string} location - Empty unless confirmed.
 * @property {string} source - hltv.org
 * @property {string} url - HLTV match page for user reference.
 */
export {};
