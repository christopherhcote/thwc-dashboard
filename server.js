const cors = require('cors');
const express = require('express');
const { fetchLeagueOdds, fetchAllOdds, LEAGUE_EVENT_GROUPS } = require('./lib/draftkings');
const sportsDb = require('./db');

const SUPPORTED_LEAGUES = new Set(['mlb', 'nfl', 'nba', 'nhl']);

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/odds', async (req, res) => {
    try {
        const odds = await fetchAllOdds();
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
        res.json(games);
    } catch (error) {
        console.error(`Error fetching ${league} odds:`, error.message);
        res.status(500).json({ error: `Error fetching ${league} odds` });
    }
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

let listener = app.listen(process.env.PORT || 5500, function() {
    console.log("Your app is listening on port " + listener.address().port);
});
