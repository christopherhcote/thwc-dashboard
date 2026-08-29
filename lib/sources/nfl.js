const { parse } = require('csv-parse/sync');
const { politeGet } = require('../httpClient');
const db = require('../../db');

// nflverse (https://github.com/nflverse/nflverse-data) publishes the entire
// history of these files as single CSVs on GitHub releases - no auth, no
// per-request rate limiting like the other leagues' live APIs.
const GAMES_URL = 'https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv';
const PLAYER_STATS_URL = 'https://github.com/nflverse/nflverse-data/releases/download/player_stats/player_stats.csv';

const TEAM_NAMES = {
    ARI: 'Arizona Cardinals', ATL: 'Atlanta Falcons', BAL: 'Baltimore Ravens', BUF: 'Buffalo Bills',
    CAR: 'Carolina Panthers', CHI: 'Chicago Bears', CIN: 'Cincinnati Bengals', CLE: 'Cleveland Browns',
    DAL: 'Dallas Cowboys', DEN: 'Denver Broncos', DET: 'Detroit Lions', GB: 'Green Bay Packers',
    HOU: 'Houston Texans', IND: 'Indianapolis Colts', JAX: 'Jacksonville Jaguars', KC: 'Kansas City Chiefs',
    LA: 'Los Angeles Rams', LAC: 'Los Angeles Chargers', LAR: 'Los Angeles Rams', LV: 'Las Vegas Raiders',
    MIA: 'Miami Dolphins', MIN: 'Minnesota Vikings', NE: 'New England Patriots', NO: 'New Orleans Saints',
    NYG: 'New York Giants', NYJ: 'New York Jets', OAK: 'Oakland Raiders', PHI: 'Philadelphia Eagles',
    PIT: 'Pittsburgh Steelers', SD: 'San Diego Chargers', SEA: 'Seattle Seahawks', SF: 'San Francisco 49ers',
    STL: 'St. Louis Rams', TB: 'Tampa Bay Buccaneers', TEN: 'Tennessee Titans', WAS: 'Washington Commanders'
};

const NUMERIC_STAT_COLUMNS = [
    'completions', 'attempts', 'passing_yards', 'passing_tds', 'interceptions', 'sacks', 'sack_yards',
    'passing_first_downs', 'carries', 'rushing_yards', 'rushing_tds', 'rushing_first_downs',
    'receptions', 'targets', 'receiving_yards', 'receiving_tds', 'receiving_first_downs',
    'fantasy_points', 'fantasy_points_ppr'
];

let gamesCsvCache = null;
async function fetchGamesCsv() {
    if (gamesCsvCache) return gamesCsvCache;
    const response = await politeGet(GAMES_URL, { responseType: 'text' }, { retries: 2, delayMs: 0 });
    gamesCsvCache = parse(response.data, { columns: true, skip_empty_lines: true });
    return gamesCsvCache;
}

let playerStatsCsvCache = null;
async function fetchPlayerStatsCsv() {
    if (playerStatsCsvCache) return playerStatsCsvCache;
    const response = await politeGet(PLAYER_STATS_URL, { responseType: 'text' }, { retries: 2, delayMs: 0 });
    playerStatsCsvCache = parse(response.data, { columns: true, skip_empty_lines: true });
    return playerStatsCsvCache;
}

function sumStats(rows) {
    const totals = {};
    NUMERIC_STAT_COLUMNS.forEach(col => {
        totals[col] = rows.reduce((sum, row) => sum + (Number(row[col]) || 0), 0);
    });
    return totals;
}

async function backfillSeason(season) {
    const [allGames, allPlayerStats] = await Promise.all([fetchGamesCsv(), fetchPlayerStatsCsv()]);

    const seasonGames = allGames.filter(g => g.season === String(season));
    const seasonPlayerStats = allPlayerStats.filter(r => r.season === String(season) && r.season_type === 'REG');

    // (season, week, team abbreviation) -> { gameId (db id), isHome }
    const teamWeekToGame = {};

    seasonGames.forEach(g => {
        if (g.home_score === '' || g.away_score === '') return; // game not yet played

        const homeTeamId = db.upsertTeam('nfl', g.home_team, TEAM_NAMES[g.home_team] || g.home_team, g.home_team);
        const awayTeamId = db.upsertTeam('nfl', g.away_team, TEAM_NAMES[g.away_team] || g.away_team, g.away_team);

        const gameId = db.upsertGame({
            league: 'nfl',
            externalId: g.game_id,
            season: g.season,
            seasonType: g.game_type,
            gameDate: g.gameday,
            homeTeamId,
            awayTeamId,
            homeScore: Number(g.home_score),
            awayScore: Number(g.away_score)
        });

        teamWeekToGame[`${g.week}|${g.home_team}`] = { gameId, teamId: homeTeamId, isHome: true };
        teamWeekToGame[`${g.week}|${g.away_team}`] = { gameId, teamId: awayTeamId, isHome: false };
    });

    // Group player stat rows by (week, team) so we can both insert per-player
    // rows and derive a team-level box score by summing them.
    const groups = {};
    seasonPlayerStats.forEach(row => {
        const key = `${row.week}|${row.recent_team}`;
        if (!groups[key]) groups[key] = [];
        groups[key].push(row);
    });

    Object.entries(groups).forEach(([key, rows]) => {
        const gameRef = teamWeekToGame[key];
        if (!gameRef) return; // bye week, mismatched abbreviation, or game not yet played

        rows.forEach(row => {
            const stats = {};
            NUMERIC_STAT_COLUMNS.forEach(col => { stats[col] = Number(row[col]) || 0; });
            db.upsertPlayerGameStats(gameRef.gameId, gameRef.teamId, row.player_id, row.player_display_name, stats);
        });

        db.upsertTeamGameStats(gameRef.gameId, gameRef.teamId, gameRef.isHome, sumStats(rows));
    });

    return { games: seasonGames.length, playerRows: seasonPlayerStats.length };
}

module.exports = { backfillSeason };
