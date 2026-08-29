const { politeGet } = require('../httpClient');
const db = require('../../db');

// There's no official free NBA API. This uses the same JSON endpoints
// stats.nba.com serves to its own site - what the community's `nba_api`
// Python package wraps - which requires these specific headers or it 403s.
// No API key involved, but this is the least standardized of the four
// sources and the one most likely to need small fixes; it could not be
// exercised live from the sandbox this was written in (blocked egress).
const BASE_URL = 'https://stats.nba.com/stats';
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    Origin: 'https://www.nba.com',
    Referer: 'https://www.nba.com/',
    'x-nba-stats-origin': 'stats',
    'x-nba-stats-token': 'true'
};

const IDENTIFYING_COLUMNS = new Set([
    'SEASON_ID', 'TEAM_ID', 'TEAM_ABBREVIATION', 'TEAM_NAME', 'PLAYER_ID', 'PLAYER_NAME',
    'GAME_ID', 'GAME_DATE', 'MATCHUP', 'WL', 'VIDEO_AVAILABLE'
]);

function seasonLabel(year) {
    return `${year}-${String(year + 1).slice(-2)}`;
}

function rowsToObjects(resultSet) {
    return resultSet.rowSet.map(row => {
        const obj = {};
        resultSet.headers.forEach((header, i) => { obj[header] = row[i]; });
        return obj;
    });
}

function statsOnly(row) {
    const stats = {};
    Object.entries(row).forEach(([key, value]) => {
        if (!IDENTIFYING_COLUMNS.has(key)) stats[key] = value;
    });
    return stats;
}

// PlayerOrTeam is 'T' for one row per team per game, 'P' for one row per player per game.
async function fetchLeagueGameLog(season, playerOrTeam) {
    const url = `${BASE_URL}/leaguegamelog?Counter=0&Direction=DESC&LeagueID=00&PlayerOrTeam=${playerOrTeam}` +
        `&Season=${season}&SeasonType=Regular+Season&Sorter=DATE`;
    const response = await politeGet(url, { headers: HEADERS }, { retries: 3, delayMs: 600 });
    return rowsToObjects(response.data.resultSets[0]);
}

async function backfillSeason(year) {
    const season = seasonLabel(year);

    const teamRows = await fetchLeagueGameLog(season, 'T');
    const playerRows = await fetchLeagueGameLog(season, 'P');

    const byGame = {};
    teamRows.forEach(row => {
        if (!byGame[row.GAME_ID]) byGame[row.GAME_ID] = [];
        byGame[row.GAME_ID].push(row);
    });

    // GAME_ID -> { dbGameId, teamDbIdByExternalId: { TEAM_ID -> db team id } }
    const gameLookup = {};
    let gamesProcessed = 0;

    Object.entries(byGame).forEach(([externalGameId, rows]) => {
        if (rows.length !== 2) return; // incomplete data for this game, skip

        const homeRow = rows.find(r => (r.MATCHUP || '').includes('vs.'));
        const awayRow = rows.find(r => (r.MATCHUP || '').includes('@'));
        if (!homeRow || !awayRow) return;

        const homeTeamId = db.upsertTeam('nba', homeRow.TEAM_ID, homeRow.TEAM_NAME, homeRow.TEAM_ABBREVIATION);
        const awayTeamId = db.upsertTeam('nba', awayRow.TEAM_ID, awayRow.TEAM_NAME, awayRow.TEAM_ABBREVIATION);

        const gameId = db.upsertGame({
            league: 'nba',
            externalId: externalGameId,
            season,
            seasonType: 'REG',
            gameDate: homeRow.GAME_DATE,
            homeTeamId,
            awayTeamId,
            homeScore: homeRow.PTS,
            awayScore: awayRow.PTS
        });

        db.upsertTeamGameStats(gameId, homeTeamId, true, statsOnly(homeRow));
        db.upsertTeamGameStats(gameId, awayTeamId, false, statsOnly(awayRow));

        gameLookup[externalGameId] = {
            gameId,
            teamDbIdByExternalId: { [homeRow.TEAM_ID]: homeTeamId, [awayRow.TEAM_ID]: awayTeamId }
        };
        gamesProcessed++;
    });

    let playerRowsProcessed = 0;
    playerRows.forEach(row => {
        const gameRef = gameLookup[row.GAME_ID];
        if (!gameRef) return;
        const teamId = gameRef.teamDbIdByExternalId[row.TEAM_ID];
        if (!teamId) return;

        db.upsertPlayerGameStats(gameRef.gameId, teamId, row.PLAYER_ID, row.PLAYER_NAME, statsOnly(row));
        playerRowsProcessed++;
    });

    return { gamesProcessed, playerRowsProcessed };
}

module.exports = { backfillSeason };
