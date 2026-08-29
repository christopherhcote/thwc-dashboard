#!/usr/bin/env node

// Pulls 5 seasons of game logs + team/player box scores for MLB, NFL, NBA,
// and NHL into data/sports.db (SQLite).
//
// Usage:
//   node scripts/backfill.js                          # all leagues, last 5 seasons
//   node scripts/backfill.js --leagues=mlb,nhl         # just these leagues
//   node scripts/backfill.js --years=2023,2024         # just these seasons
//
// MLB and NHL fetch one HTTP request per game (thousands of requests per
// season) and can take a long time - progress is checkpointed in the
// ingest_progress table, so re-running the same command after an
// interruption skips games already pulled in a prior run.

const sources = {
    mlb: require('../lib/sources/mlb'),
    nfl: require('../lib/sources/nfl'),
    nba: require('../lib/sources/nba'),
    nhl: require('../lib/sources/nhl')
};

function parseArgs(argv) {
    const args = {};
    argv.forEach(arg => {
        const match = arg.match(/^--([^=]+)=(.*)$/);
        if (match) args[match[1]] = match[2];
    });
    return args;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));

    const currentYear = new Date().getFullYear();
    const defaultYears = [4, 3, 2, 1, 0].map(offset => currentYear - offset);

    const leagues = args.leagues ? args.leagues.split(',') : Object.keys(sources);
    const years = args.years ? args.years.split(',').map(Number) : defaultYears;

    for (const league of leagues) {
        const source = sources[league];
        if (!source) {
            console.error(`Unknown league "${league}". Supported: ${Object.keys(sources).join(', ')}`);
            continue;
        }

        for (const year of years) {
            console.log(`\n=== ${league.toUpperCase()} ${year} ===`);
            const start = Date.now();
            try {
                const result = await source.backfillSeason(year);
                const seconds = ((Date.now() - start) / 1000).toFixed(1);
                console.log(`${league.toUpperCase()} ${year} done in ${seconds}s:`, result);
            } catch (error) {
                console.error(`${league.toUpperCase()} ${year} failed:`, error.message);
            }
        }
    }
}

main().then(() => {
    console.log('\nBackfill complete.');
    process.exit(0);
}).catch(error => {
    console.error('Backfill failed:', error);
    process.exit(1);
});
