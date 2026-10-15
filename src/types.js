/**
 * @typedef {Object} Match
 * @property {string} matchId - Liquipedia fixture key: tournament section, stage and both teams (stable across reschedules).
 * @property {Date} date - UTC instant from Liquipedia data-timestamp seconds.
 * @property {string} team - Canonical tracked team (FURIA, Legacy, MIBR).
 * @property {null} teamId - Liquipedia exposes no numeric team IDs.
 * @property {string} opponent - Team name or exact placeholder label (TBD).
 * @property {null} opponentId
 * @property {string} competition
 * @property {string} format - Empty unless confirmed; never infer BO3/BO5.
 * @property {string} location - Empty unless confirmed.
 * @property {string} source - liquipedia.net
 * @property {string} url - Liquipedia tournament section for user reference.
 */
export {};
