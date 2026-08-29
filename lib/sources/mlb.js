const { politeGet } = require('../httpClient');
const db = require('../../db');

// MLB Stats API - free, unauthenticated, and the source MLB.com's own site
// runs on. Confirmed stable in past projects, but this module could not be
// exercised against the live API from the sandbox this was written in
// (outbound access to statsapi.mlb.com was blocked there) - verify the first
// season's worth of games looks right wherever you actually run the backfill.
const BASE_URL = 'https://statsapi.mlb.com/api/v1';

function hasBattingLine(batting) {
    return batting && ((batting.atBats || 0) > 0 || (batting.plateAppearances || 0) > 0);
}

function hasPitchingLine(pitching) {
    return pitching && Number(pitching.inningsPitched || 0) > 0;
}

async function fetchBoxscore(gamePk) {
    const response = await politeGet(`${BASE_URL}/game/${gamePk}/boxscore`);
    return response.data;
}

// The schedule endpoint's embedded team objects only have {id, name} - no
// abbreviation - so team.abbreviation would otherwise end up storing the
// full name. Fetched once per process and cached, rather than hardcoding a
// team-id table (which would silently go stale across relocations/rebrands
// like Oakland -> Athletics).
let teamMetaCache = null;
async function getTeamMeta(teamId) {
    if (!teamMetaCache) {
        const response = await politeGet(`${BASE_URL}/teams?sportId=1`, {}, { retries: 2, delayMs: 0 });
        teamMetaCache = {};
        (response.data.teams || []).forEach(t => { teamMetaCache[t.id] = t; });
    }
    return teamMetaCache[teamId];
}

async function backfillSeason(year) {
    const season = String(year);
    const scheduleResp = await politeGet(`${BASE_URL}/schedule?sportId=1&season=${season}&gameType=R`);
    const dates = (scheduleResp.data && scheduleResp.data.dates) || [];

    let gamesProcessed = 0;
    let gamesSkipped = 0;

    for (const date of dates) {
        for (const game of date.games || []) {
            if (!game.status || game.status.abstractGameState !== 'Final') continue;

            const gamePk = game.gamePk;
            if (db.isGameIngested('mlb', season, gamePk)) {
                gamesSkipped++;
                continue;
            }

            const homeTeamMeta = game.teams.home.team;
            const awayTeamMeta = game.teams.away.team;
            const homeMeta = await getTeamMeta(homeTeamMeta.id);
            const awayMeta = await getTeamMeta(awayTeamMeta.id);
            const homeTeamId = db.upsertTeam('mlb', homeTeamMeta.id, homeTeamMeta.name, (homeMeta && homeMeta.abbreviation) || homeTeamMeta.name);
            const awayTeamId = db.upsertTeam('mlb', awayTeamMeta.id, awayTeamMeta.name, (awayMeta && awayMeta.abbreviation) || awayTeamMeta.name);

            const gameId = db.upsertGame({
                league: 'mlb',
                externalId: gamePk,
                season,
                seasonType: 'R',
                gameDate: game.gameDate,
                homeTeamId,
                awayTeamId,
                homeScore: game.teams.home.score,
                awayScore: game.teams.away.score
            });

            try {
                const boxscore = await fetchBoxscore(gamePk);
                const sides = [
                    { side: boxscore.teams.home, teamId: homeTeamId, isHome: true },
                    { side: boxscore.teams.away, teamId: awayTeamId, isHome: false }
                ];

                sides.forEach(({ side, teamId, isHome }) => {
                    if (!side) return;

                    db.upsertTeamGameStats(gameId, teamId, isHome, {
                        batting: (side.teamStats && side.teamStats.batting) || {},
                        pitching: (side.teamStats && side.teamStats.pitching) || {}
                    });

                    Object.values(side.players || {}).forEach(player => {
                        const batting = player.stats && player.stats.batting;
                        const pitching = player.stats && player.stats.pitching;
                        if (!hasBattingLine(batting) && !hasPitchingLine(pitching)) return;

                        db.upsertPlayerGameStats(
                            gameId,
                            teamId,
                            player.person.id,
                            player.person.fullName,
                            { position: player.position && player.position.abbreviation, batting: batting || {}, pitching: pitching || {} }
                        );
                    });
                });

                db.markGameIngested('mlb', season, gamePk);
                gamesProcessed++;
            } catch (error) {
                console.error(`MLB: failed to fetch boxscore for game ${gamePk}:`, error.message);
            }
        }
    }

    return { gamesProcessed, gamesSkipped };
}

module.exports = { backfillSeason };
