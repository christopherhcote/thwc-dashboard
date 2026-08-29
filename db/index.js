const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', 'data', 'sports.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

function upsertTeam(league, externalId, name, abbreviation) {
    db.prepare(`
        INSERT INTO teams (league, external_id, name, abbreviation)
        VALUES (@league, @externalId, @name, @abbreviation)
        ON CONFLICT(league, external_id) DO UPDATE SET
            name = excluded.name,
            abbreviation = excluded.abbreviation
    `).run({ league, externalId: String(externalId), name, abbreviation });

    return db.prepare('SELECT id FROM teams WHERE league = ? AND external_id = ?')
        .get(league, String(externalId)).id;
}

function upsertGame(game) {
    db.prepare(`
        INSERT INTO games (league, external_id, season, season_type, game_date, home_team_id, away_team_id, home_score, away_score)
        VALUES (@league, @externalId, @season, @seasonType, @gameDate, @homeTeamId, @awayTeamId, @homeScore, @awayScore)
        ON CONFLICT(league, external_id) DO UPDATE SET
            season = excluded.season,
            season_type = excluded.season_type,
            game_date = excluded.game_date,
            home_team_id = excluded.home_team_id,
            away_team_id = excluded.away_team_id,
            home_score = excluded.home_score,
            away_score = excluded.away_score
    `).run({
        league: game.league,
        externalId: String(game.externalId),
        season: String(game.season),
        seasonType: game.seasonType || null,
        gameDate: game.gameDate || null,
        homeTeamId: game.homeTeamId,
        awayTeamId: game.awayTeamId,
        homeScore: game.homeScore !== undefined ? game.homeScore : null,
        awayScore: game.awayScore !== undefined ? game.awayScore : null
    });

    return db.prepare('SELECT id FROM games WHERE league = ? AND external_id = ?')
        .get(game.league, String(game.externalId)).id;
}

function upsertTeamGameStats(gameId, teamId, isHome, stats) {
    db.prepare(`
        INSERT INTO team_game_stats (game_id, team_id, is_home, stats)
        VALUES (@gameId, @teamId, @isHome, @stats)
        ON CONFLICT(game_id, team_id) DO UPDATE SET
            is_home = excluded.is_home,
            stats = excluded.stats
    `).run({ gameId, teamId, isHome: isHome ? 1 : 0, stats: JSON.stringify(stats || {}) });
}

function upsertPlayerGameStats(gameId, teamId, playerExternalId, playerName, stats) {
    db.prepare(`
        INSERT INTO player_game_stats (game_id, team_id, player_external_id, player_name, stats)
        VALUES (@gameId, @teamId, @playerExternalId, @playerName, @stats)
        ON CONFLICT(game_id, player_external_id) DO UPDATE SET
            team_id = excluded.team_id,
            player_name = excluded.player_name,
            stats = excluded.stats
    `).run({
        gameId,
        teamId,
        playerExternalId: String(playerExternalId),
        playerName: playerName || null,
        stats: JSON.stringify(stats || {})
    });
}

function isGameIngested(league, season, externalGameId) {
    return !!db.prepare(
        'SELECT 1 FROM ingest_progress WHERE league = ? AND season = ? AND external_game_id = ?'
    ).get(league, String(season), String(externalGameId));
}

function markGameIngested(league, season, externalGameId) {
    db.prepare(`
        INSERT INTO ingest_progress (league, season, external_game_id, completed_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(league, season, external_game_id) DO UPDATE SET completed_at = excluded.completed_at
    `).run(league, String(season), String(externalGameId));
}

function getGames(league, season) {
    if (season) {
        return db.prepare('SELECT * FROM games WHERE league = ? AND season = ? ORDER BY game_date').all(league, String(season));
    }
    return db.prepare('SELECT * FROM games WHERE league = ? ORDER BY season, game_date').all(league);
}

function getTeams(league) {
    return db.prepare('SELECT * FROM teams WHERE league = ? ORDER BY name').all(league);
}

function getBoxscore(gameId) {
    const teamStats = db.prepare(`
        SELECT tgs.*, t.name AS team_name, t.abbreviation
        FROM team_game_stats tgs JOIN teams t ON t.id = tgs.team_id
        WHERE tgs.game_id = ?
    `).all(gameId).map(row => ({ ...row, stats: JSON.parse(row.stats || '{}') }));

    const playerStats = db.prepare('SELECT * FROM player_game_stats WHERE game_id = ?')
        .all(gameId)
        .map(row => ({ ...row, stats: JSON.parse(row.stats || '{}') }));

    return { teamStats, playerStats };
}

function insertOddsSnapshot(league, game) {
    db.prepare(`
        INSERT INTO odds_snapshots (league, fetched_at, external_game_id, start_time, home_team, away_team, moneyline, spread, total)
        VALUES (@league, datetime('now'), @externalGameId, @startTime, @homeTeam, @awayTeam, @moneyline, @spread, @total)
    `).run({
        league,
        externalGameId: game.gameId !== undefined ? String(game.gameId) : null,
        startTime: game.startTime || null,
        homeTeam: game.homeTeam || null,
        awayTeam: game.awayTeam || null,
        moneyline: JSON.stringify(game.moneyline || null),
        spread: JSON.stringify(game.spread || null),
        total: JSON.stringify(game.total || null)
    });
}

function getOddsSnapshots(league, { team, sinceHours } = {}) {
    const clauses = ['league = ?'];
    const params = [league];

    if (team) {
        clauses.push('(home_team LIKE ? OR away_team LIKE ?)');
        params.push(`%${team}%`, `%${team}%`);
    }
    if (sinceHours) {
        clauses.push("fetched_at >= datetime('now', ?)");
        params.push(`-${Number(sinceHours)} hours`);
    }

    const rows = db.prepare(`
        SELECT * FROM odds_snapshots WHERE ${clauses.join(' AND ')} ORDER BY fetched_at DESC
    `).all(...params);

    return rows.map(row => ({
        ...row,
        moneyline: JSON.parse(row.moneyline || 'null'),
        spread: JSON.parse(row.spread || 'null'),
        total: JSON.parse(row.total || 'null')
    }));
}

module.exports = {
    db,
    upsertTeam,
    upsertGame,
    upsertTeamGameStats,
    upsertPlayerGameStats,
    isGameIngested,
    markGameIngested,
    getGames,
    getTeams,
    getBoxscore,
    insertOddsSnapshot,
    getOddsSnapshots
};
