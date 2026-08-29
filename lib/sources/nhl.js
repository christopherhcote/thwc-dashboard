const { politeGet } = require('../httpClient');
const db = require('../../db');

// api-web.nhle.com is the free, unauthenticated API the current NHL.com site
// runs on. Like mlb.js, this could not be exercised live from the sandbox
// this was written in (blocked egress) - the boxscore shape in particular is
// wrapped defensively below since it has changed format before and couldn't
// be double-checked here.
const BASE_URL = 'https://api-web.nhle.com/v1';

// Franchises active at some point in the last several seasons. UTA replaced
// ARI starting in the 2024-25 season; both are kept so older seasons still resolve.
const TEAMS = [
    'ANA', 'ARI', 'BOS', 'BUF', 'CGY', 'CAR', 'CHI', 'COL', 'CBJ', 'DAL', 'DET', 'EDM', 'FLA',
    'LAK', 'MIN', 'MTL', 'NSH', 'NJD', 'NYI', 'NYR', 'OTT', 'PHI', 'PIT', 'SJS', 'SEA', 'STL',
    'TBL', 'TOR', 'UTA', 'VAN', 'VGK', 'WSH', 'WPG'
];

function seasonCode(year) {
    return `${year}${year + 1}`;
}

function sumSkaterStats(skaters) {
    const totals = { goals: 0, assists: 0, points: 0, shots: 0, hits: 0, pim: 0, blockedShots: 0 };
    (skaters || []).forEach(p => {
        totals.goals += Number(p.goals) || 0;
        totals.assists += Number(p.assists) || 0;
        totals.points += Number(p.points) || 0;
        totals.shots += Number(p.shots) || 0;
        totals.hits += Number(p.hits) || 0;
        totals.pim += Number(p.pim) || 0;
        totals.blockedShots += Number(p.blockedShots) || 0;
    });
    return totals;
}

async function fetchTeamSeasonGames(team, season) {
    const response = await politeGet(`${BASE_URL}/club-schedule-season/${team}/${season}`);
    return (response.data && response.data.games) || [];
}

async function fetchBoxscore(gameId) {
    const response = await politeGet(`${BASE_URL}/gamecenter/${gameId}/boxscore`);
    return response.data;
}

async function backfillSeason(year) {
    const season = seasonCode(year);
    const seasonLabel = `${year}-${String(year + 1).slice(-2)}`;

    const gamesById = {};
    for (const team of TEAMS) {
        try {
            const games = await fetchTeamSeasonGames(team, season);
            games.forEach(g => { gamesById[g.id] = g; });
        } catch (error) {
            // Franchise didn't exist / wasn't in this season under this abbreviation - expected for some.
            console.error(`NHL: couldn't fetch schedule for ${team} ${season}:`, error.message);
        }
    }

    let gamesProcessed = 0;
    let gamesSkipped = 0;

    for (const game of Object.values(gamesById)) {
        if (game.gameType !== 2 && game.gameType !== 3) continue; // 2 = regular season, 3 = playoffs
        if (!game.homeTeam || game.homeTeam.score === undefined) continue; // not yet played

        if (db.isGameIngested('nhl', seasonLabel, game.id)) {
            gamesSkipped++;
            continue;
        }

        const homeTeamId = db.upsertTeam('nhl', game.homeTeam.id, game.homeTeam.placeName ? `${game.homeTeam.placeName.default} ${game.homeTeam.commonName.default}` : game.homeTeam.abbrev, game.homeTeam.abbrev);
        const awayTeamId = db.upsertTeam('nhl', game.awayTeam.id, game.awayTeam.placeName ? `${game.awayTeam.placeName.default} ${game.awayTeam.commonName.default}` : game.awayTeam.abbrev, game.awayTeam.abbrev);

        const gameId = db.upsertGame({
            league: 'nhl',
            externalId: game.id,
            season: seasonLabel,
            seasonType: game.gameType === 3 ? 'POST' : 'REG',
            gameDate: game.gameDate,
            homeTeamId,
            awayTeamId,
            homeScore: game.homeTeam.score,
            awayScore: game.awayTeam.score
        });

        try {
            const boxscore = await fetchBoxscore(game.id);
            const byGame = boxscore.playerByGameStats || {};

            const sides = [
                { key: 'homeTeam', teamId: homeTeamId, isHome: true },
                { key: 'awayTeam', teamId: awayTeamId, isHome: false }
            ];

            sides.forEach(({ key, teamId, isHome }) => {
                const teamPlayers = byGame[key] || {};
                const skaters = [...(teamPlayers.forwards || []), ...(teamPlayers.defense || [])];
                const goalies = teamPlayers.goalies || [];
                const teamMeta = boxscore[key] || {};

                db.upsertTeamGameStats(gameId, teamId, isHome, {
                    sog: teamMeta.sog,
                    ...sumSkaterStats(skaters)
                });

                skaters.forEach(p => {
                    db.upsertPlayerGameStats(gameId, teamId, p.playerId, p.name && p.name.default, {
                        position: p.position,
                        goals: p.goals, assists: p.assists, points: p.points,
                        shots: p.shots, hits: p.hits, pim: p.pim, blockedShots: p.blockedShots,
                        toi: p.toi
                    });
                });

                goalies.forEach(g => {
                    db.upsertPlayerGameStats(gameId, teamId, g.playerId, g.name && g.name.default, {
                        position: 'G',
                        saveShotsAgainst: g.saveShotsAgainst,
                        savePctg: g.savePctg,
                        goalsAgainst: g.goalsAgainst,
                        decision: g.decision,
                        toi: g.toi
                    });
                });
            });
        } catch (error) {
            console.error(`NHL: failed to fetch/parse boxscore for game ${game.id}:`, error.message);
        }

        db.markGameIngested('nhl', seasonLabel, game.id);
        gamesProcessed++;
    }

    return { gamesProcessed, gamesSkipped };
}

module.exports = { backfillSeason };
