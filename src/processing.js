export function getMatchUniqueKey(match) {
  if (match.source !== 'hltv.org' || !/^\d+$/.test(match.matchId || '')) throw new Error('Missing HLTV match identity');
  return `hltv_${match.matchId}`;
}

export function processMatches(matches, now = new Date()) {
  const unique = new Map();
  for (const match of matches) {
    if (!(match.date instanceof Date) || !Number.isFinite(match.date.getTime())) throw new Error('Invalid match date');
    if (match.date <= now) continue;
    const key = getMatchUniqueKey(match);
    const prior = unique.get(key);
    if (prior && (prior.date.getTime() !== match.date.getTime() || prior.teamId !== match.teamId || prior.opponentId !== match.opponentId)) {
      throw new Error(`Conflicting duplicate match ${key}`);
    }
    unique.set(key, match);
  }
  return [...unique.values()].sort((a, b) => a.date - b.date);
}
