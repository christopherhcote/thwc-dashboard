const cors = require('cors');
const express = require('express');
const { fetchLeagueOdds, fetchAllOdds, LEAGUE_EVENT_GROUPS } = require('./lib/draftkings');
const sportsDb = require('./db');
const analytics = require('./lib/analytics');

const SUPPORTED_LEAGUES = new Set(['mlb', 'nfl', 'nba', 'nhl']);

const app = express();
app.use(cors());
app.use(express.json());

function recordOddsSnapshots(league, games) {
    if (!Array.isArray(games)) return; // e.g. an { error } object from a failed league fetch
    games.forEach(game => {
        try {
            sportsDb.insertOddsSnapshot(league, game);
        } catch (error) {
            console.error(`Failed to store odds snapshot for ${league}:`, error.message);
        }
    });
}

app.get('/api/odds', async (req, res) => {
    try {
        const odds = await fetchAllOdds();
        Object.entries(odds).forEach(([league, games]) => recordOddsSnapshots(league, games));
        res.json(odds);
    } catch (error) {
        console.error('Error fetching odds:', error.message);
        res.status(500).json({ error: 'Error fetching odds' });
    }
});

app.get('/api/odds/:league', async (req, res) => {
    const league = req.params.league.toLowerCase();
    if (!LEAGUE_EVENT_GROUPS[league]) {
        return res.status(400).json({ error: `Unsupported league "${league}". Supported: ${Object.keys(LEAGUE_EVENT_GROUPS).join(', ')}` });
    }

    try {
        const games = await fetchLeagueOdds(league);
        recordOddsSnapshots(league, games);
        res.json(games);
    } catch (error) {
        console.error(`Error fetching ${league} odds:`, error.message);
        res.status(500).json({ error: `Error fetching ${league} odds` });
    }
});

app.get('/api/odds-history/:league', (req, res) => {
    const league = req.params.league.toLowerCase();
    if (!LEAGUE_EVENT_GROUPS[league]) {
        return res.status(400).json({ error: `Unsupported league "${league}". Supported: ${Object.keys(LEAGUE_EVENT_GROUPS).join(', ')}` });
    }
    res.json(sportsDb.getOddsSnapshots(league, { team: req.query.team, sinceHours: req.query.sinceHours }));
});

app.get('/api/teams/:league', (req, res) => {
    const league = req.params.league.toLowerCase();
    if (!SUPPORTED_LEAGUES.has(league)) {
        return res.status(400).json({ error: `Unsupported league "${league}". Supported: ${[...SUPPORTED_LEAGUES].join(', ')}` });
    }
    res.json(sportsDb.getTeams(league));
});

app.get('/api/games/:league', (req, res) => {
    const league = req.params.league.toLowerCase();
    if (!SUPPORTED_LEAGUES.has(league)) {
        return res.status(400).json({ error: `Unsupported league "${league}". Supported: ${[...SUPPORTED_LEAGUES].join(', ')}` });
    }
    res.json(sportsDb.getGames(league, req.query.season));
});

app.get('/api/games/:league/:gameId/boxscore', (req, res) => {
    const league = req.params.league.toLowerCase();
    if (!SUPPORTED_LEAGUES.has(league)) {
        return res.status(400).json({ error: `Unsupported league "${league}". Supported: ${[...SUPPORTED_LEAGUES].join(', ')}` });
    }
    res.json(sportsDb.getBoxscore(req.params.gameId));
});

app.get('/api/teams/:league/:teamId/summary', (req, res) => {
    const league = req.params.league.toLowerCase();
    if (!SUPPORTED_LEAGUES.has(league)) {
        return res.status(400).json({ error: `Unsupported league "${league}". Supported: ${[...SUPPORTED_LEAGUES].join(', ')}` });
    }
    const lastN = req.query.lastN ? Number(req.query.lastN) : undefined;
    res.json(analytics.getTeamSummary(league, Number(req.params.teamId), { season: req.query.season, lastN }));
});

app.get('/api/matchup/:league', (req, res) => {
    const league = req.params.league.toLowerCase();
    if (!SUPPORTED_LEAGUES.has(league)) {
        return res.status(400).json({ error: `Unsupported league "${league}". Supported: ${[...SUPPORTED_LEAGUES].join(', ')}` });
    }
    const { teamA, teamB, limit } = req.query;
    if (!teamA || !teamB) {
        return res.status(400).json({ error: 'Both teamA and teamB query params (team ids) are required' });
    }
    res.json(analytics.getHeadToHead(league, Number(teamA), Number(teamB), { limit: limit ? Number(limit) : undefined }));
});

let listener = app.listen(process.env.PORT || 5500, function() {
    console.log("Your app is listening on port " + listener.address().port);
});
