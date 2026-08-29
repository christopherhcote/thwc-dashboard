const { db } = require('../db');

function outcome(teamScore, oppScore) {
    if (teamScore === null || oppScore === null) return null;
    if (teamScore > oppScore) return 'W';
    if (teamScore < oppScore) return 'L';
    return 'T';
}

// All games a team played, oldest first, each annotated from that team's
// point of view (isHome, its own score vs the opponent's, W/L/T).
function getTeamGames(league, teamId, { season } = {}) {
    const clauses = ['g.league = ?', '(g.home_team_id = ? OR g.away_team_id = ?)'];
    const params = [league, teamId, teamId];
    if (season) {
        clauses.push('g.season = ?');
        params.push(String(season));
    }

    const rows = db.prepare(`
        SELECT g.*, ht.name AS home_team_name, at.name AS away_team_name
        FROM games g
        JOIN teams ht ON ht.id = g.home_team_id
        JOIN teams at ON at.id = g.away_team_id
        WHERE ${clauses.join(' AND ')}
        ORDER BY g.game_date
    `).all(...params);

    return rows
        .filter(g => g.home_score !== null && g.away_score !== null)
        .map(g => {
            const isHome = g.home_team_id === teamId;
            const teamScore = isHome ? g.home_score : g.away_score;
            const oppScore = isHome ? g.away_score : g.home_score;
            return {
                gameId: g.id,
                season: g.season,
                gameDate: g.game_date,
                isHome,
                opponentId: isHome ? g.away_team_id : g.home_team_id,
                opponentName: isHome ? g.away_team_name : g.home_team_name,
                teamScore,
                oppScore,
                result: outcome(teamScore, oppScore)
            };
        });
}

function record(games) {
    return games.reduce((acc, g) => {
        if (g.result === 'W') acc.wins++;
        else if (g.result === 'L') acc.losses++;
        else if (g.result === 'T') acc.ties++;
        return acc;
    }, { wins: 0, losses: 0, ties: 0 });
}

function currentStreak(games) {
    if (!games.length) return null;
    const last = games[games.length - 1].result;
    let count = 0;
    for (let i = games.length - 1; i >= 0 && games[i].result === last; i--) count++;
    return `${last}${count}`;
}

function average(values) {
    if (!values.length) return null;
    return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;
}

function getTeamSummary(league, teamId, { season, lastN = 10 } = {}) {
    const games = getTeamGames(league, teamId, { season });
    const homeGames = games.filter(g => g.isHome);
    const awayGames = games.filter(g => !g.isHome);
    const recent = games.slice(-lastN).reverse();

    return {
        gamesPlayed: games.length,
        overall: record(games),
        home: record(homeGames),
        away: record(awayGames),
        avgScored: average(games.map(g => g.teamScore)),
        avgAllowed: average(games.map(g => g.oppScore)),
        currentStreak: currentStreak(games),
        recentForm: record(recent),
        lastGames: recent
    };
}

function getHeadToHead(league, teamAId, teamBId, { limit = 20 } = {}) {
    const rows = db.prepare(`
        SELECT g.*, ht.name AS home_team_name, at.name AS away_team_name
        FROM games g
        JOIN teams ht ON ht.id = g.home_team_id
        JOIN teams at ON at.id = g.away_team_id
        WHERE g.league = ?
          AND ((g.home_team_id = ? AND g.away_team_id = ?) OR (g.home_team_id = ? AND g.away_team_id = ?))
          AND g.home_score IS NOT NULL AND g.away_score IS NOT NULL
        ORDER BY g.game_date DESC
        LIMIT ?
    `).all(league, teamAId, teamBId, teamBId, teamAId, limit);

    const games = rows.map(g => {
        const teamAIsHome = g.home_team_id === teamAId;
        const teamAScore = teamAIsHome ? g.home_score : g.away_score;
        const teamBScore = teamAIsHome ? g.away_score : g.home_score;
        return {
            gameId: g.id,
            season: g.season,
            gameDate: g.game_date,
            homeTeam: g.home_team_name,
            awayTeam: g.away_team_name,
            homeScore: g.home_score,
            awayScore: g.away_score,
            teamAResult: outcome(teamAScore, teamBScore)
        };
    });

    return { games, teamARecord: record(games.map(g => ({ result: g.teamAResult }))) };
}

module.exports = { getTeamGames, getTeamSummary, getHeadToHead };
