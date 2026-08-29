# thwc-dashboard

## Betting odds (DraftKings)

`GET /api/odds` (all leagues) and `GET /api/odds/:league` (`mlb`, `nfl`, `nba`, `nhl`) pull live odds
from DraftKings' public sportsbook feed. See `lib/draftkings.js` - if a league starts coming back
empty, DraftKings likely changed that league's `eventGroupId`; find the new one via your browser's
Network tab on `sportsbook.draftkings.com` and update `LEAGUE_EVENT_GROUPS`.

## Historical team/player data

`node scripts/backfill.js` pulls 5 seasons of game logs plus per-game team and player box scores for
MLB, NFL, NBA, and NHL into a local SQLite database at `data/sports.db`.

```
node scripts/backfill.js                      # all 4 leagues, last 5 seasons
node scripts/backfill.js --leagues=mlb,nhl     # just these leagues
node scripts/backfill.js --years=2023,2024     # just these seasons (season start year)
```

MLB and NHL fetch one HTTP request per game, so a full 5-season run can take a while (tens of
thousands of requests) - progress is checkpointed, so re-running the same command after an
interruption picks up where it left off instead of re-fetching everything.

Once populated, read it back over HTTP:
- `GET /api/teams/:league`
- `GET /api/games/:league?season=YYYY`
- `GET /api/games/:league/:gameId/boxscore`

Or query `data/sports.db` directly - `teams`, `games`, `team_game_stats`, `player_game_stats`
(the latter two store the sport-specific stat line as a JSON column, since MLB/NFL/NBA/NHL box
scores don't share a column set).

Data sources: MLB Stats API, the NHL's public API, stats.nba.com (NBA has no official free API -
this is the same endpoint the community's `nba_api` package uses, and the most likely of the four
to need adjustment if it changes), and nflverse's public GitHub-hosted CSVs for NFL. All are free
and require no API key, but none are official supported APIs - treat this as best-effort.

## Analytics

Derived from the backfilled game logs (`lib/analytics.js`):
- `GET /api/teams/:league/:teamId/summary?season=YYYY&lastN=10` - record (overall/home/away), scoring
  averages, current streak, and form over the last N games.
- `GET /api/matchup/:league?teamA=ID&teamB=ID&limit=20` - head-to-head game history and each team's
  record in the series.

`teamId` is this app's internal id from `GET /api/teams/:league`, not the league's own id.

## Odds history

Every `/api/odds` or `/api/odds/:league` call also appends a snapshot of what DraftKings returned into
`odds_snapshots` (append-only - DK only exposes the current line, so this is how a line-movement
history builds up over time; there's no way to backfill odds from before this table existed).
`GET /api/odds-history/:league?team=name&sinceHours=24` reads it back.
