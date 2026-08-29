CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    league TEXT NOT NULL,
    external_id TEXT NOT NULL,
    name TEXT,
    abbreviation TEXT,
    UNIQUE(league, external_id)
);

CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    league TEXT NOT NULL,
    external_id TEXT NOT NULL,
    season TEXT NOT NULL,
    season_type TEXT,
    game_date TEXT,
    home_team_id INTEGER REFERENCES teams(id),
    away_team_id INTEGER REFERENCES teams(id),
    home_score INTEGER,
    away_score INTEGER,
    UNIQUE(league, external_id)
);
CREATE INDEX IF NOT EXISTS idx_games_league_season ON games(league, season);

-- One row per team per game. `stats` holds the sport-specific box score line
-- (e.g. FG%/rebounds for NBA, ERA/hits for MLB) as JSON since the stat set
-- differs by sport - only the fields common across all four leagues get a
-- real column.
CREATE TABLE IF NOT EXISTS team_game_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL REFERENCES games(id),
    team_id INTEGER NOT NULL REFERENCES teams(id),
    is_home INTEGER NOT NULL,
    stats TEXT,
    UNIQUE(game_id, team_id)
);

-- One row per player per game, same JSON-blob approach as team_game_stats.
CREATE TABLE IF NOT EXISTS player_game_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL REFERENCES games(id),
    team_id INTEGER NOT NULL REFERENCES teams(id),
    player_external_id TEXT NOT NULL,
    player_name TEXT,
    stats TEXT,
    UNIQUE(game_id, player_external_id)
);
CREATE INDEX IF NOT EXISTS idx_player_game_stats_game ON player_game_stats(game_id);
CREATE INDEX IF NOT EXISTS idx_player_game_stats_player ON player_game_stats(player_external_id);

CREATE TABLE IF NOT EXISTS ingest_progress (
    league TEXT NOT NULL,
    season TEXT NOT NULL,
    external_game_id TEXT NOT NULL,
    completed_at TEXT NOT NULL,
    PRIMARY KEY (league, season, external_game_id)
);

-- Append-only log of DraftKings odds pulls. DK's own event ids don't line up
-- with our internal games table (different source, and we can't backfill
-- odds history - DK only exposes the current line) so this just records
-- team names/start time as DK reports them; each /api/odds call adds one
-- row per game, building a line-movement history over time from here on.
CREATE TABLE IF NOT EXISTS odds_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    league TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    external_game_id TEXT,
    start_time TEXT,
    home_team TEXT,
    away_team TEXT,
    moneyline TEXT,
    spread TEXT,
    total TEXT
);
CREATE INDEX IF NOT EXISTS idx_odds_snapshots_lookup ON odds_snapshots(league, external_game_id, fetched_at);
