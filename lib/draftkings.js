const axios = require('axios');

// DraftKings' public sportsbook site calls this JSON API to render its own odds
// boards - no auth required. Each "event group" id below is the league-level
// group DK's site currently uses. DK reshuffles these ids occasionally
// (especially across seasons), so if a league starts returning empty results,
// open sportsbook.draftkings.com/leagues/<sport>/<league>, check the Network
// tab for a request to `.../eventgroups/<id>?format=json`, and update the id
// here.
const LEAGUE_EVENT_GROUPS = {
    mlb: 84240,
    nfl: 88808,
    nba: 42648,
    nhl: 42133
};

const BASE_URL = 'https://sportsbook.draftkings.com/sites/US-SB/api/v5/eventgroups';

function americanOddsToNumber(odds) {
    if (odds === undefined || odds === null || odds === '') return null;
    const n = Number(odds);
    return Number.isNaN(n) ? null : n;
}

// DK nests offers as offerCategories -> offerSubcategoryDescriptors ->
// offerSubcategory.offers (an array of arrays of offer objects, one inner
// array per game). We flatten those and bucket them by eventId + market type.
function extractMarketsByEvent(eventGroup) {
    const marketsByEvent = {};

    const categories = eventGroup.offerCategories || [];
    categories.forEach(category => {
        const subcategories = category.offerSubcategoryDescriptors || [];
        subcategories.forEach(sub => {
            const offerRows = (sub.offerSubcategory && sub.offerSubcategory.offers) || [];
            offerRows.forEach(offerRow => {
                offerRow.forEach(offer => {
                    const eventId = offer.eventId;
                    if (!eventId) return;
                    if (!marketsByEvent[eventId]) {
                        marketsByEvent[eventId] = { moneyline: null, spread: null, total: null };
                    }

                    const label = (offer.label || sub.name || '').toLowerCase();
                    const outcomes = offer.outcomes || [];

                    if (label.includes('moneyline')) {
                        marketsByEvent[eventId].moneyline = outcomes.map(o => ({
                            team: o.label,
                            odds: americanOddsToNumber(o.oddsAmerican)
                        }));
                    } else if (label.includes('point spread') || label.includes('run line') || label.includes('puck line')) {
                        marketsByEvent[eventId].spread = outcomes.map(o => ({
                            team: o.label,
                            line: o.line !== undefined ? Number(o.line) : null,
                            odds: americanOddsToNumber(o.oddsAmerican)
                        }));
                    } else if (label.includes('total') || label.includes('over/under')) {
                        marketsByEvent[eventId].total = outcomes.map(o => ({
                            side: o.label,
                            line: o.line !== undefined ? Number(o.line) : null,
                            odds: americanOddsToNumber(o.oddsAmerican)
                        }));
                    }
                });
            });
        });
    });

    return marketsByEvent;
}

function normalizeEvents(eventGroup, league) {
    const events = eventGroup.events || [];
    const marketsByEvent = extractMarketsByEvent(eventGroup);

    return events.map(event => {
        const markets = marketsByEvent[event.eventId] || { moneyline: null, spread: null, total: null };
        return {
            league,
            gameId: event.eventId,
            name: event.name,
            startTime: event.startDate,
            awayTeam: event.teamName1 || null,
            homeTeam: event.teamName2 || null,
            moneyline: markets.moneyline,
            spread: markets.spread,
            total: markets.total
        };
    });
}

async function fetchLeagueOdds(league) {
    const key = league.toLowerCase();
    const eventGroupId = LEAGUE_EVENT_GROUPS[key];
    if (!eventGroupId) {
        throw new Error(`Unsupported league "${league}". Supported: ${Object.keys(LEAGUE_EVENT_GROUPS).join(', ')}`);
    }

    const response = await axios.get(`${BASE_URL}/${eventGroupId}?format=json`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 10000
    });

    const eventGroup = response.data && response.data.eventGroup;
    if (!eventGroup) {
        return [];
    }

    return normalizeEvents(eventGroup, key);
}

async function fetchAllOdds() {
    const leagues = Object.keys(LEAGUE_EVENT_GROUPS);
    const results = await Promise.allSettled(leagues.map(fetchLeagueOdds));

    const odds = {};
    results.forEach((result, i) => {
        const league = leagues[i];
        if (result.status === 'fulfilled') {
            odds[league] = result.value;
        } else {
            console.error(`Error fetching ${league} odds:`, result.reason.message);
            odds[league] = { error: result.reason.message };
        }
    });

    return odds;
}

module.exports = { LEAGUE_EVENT_GROUPS, fetchLeagueOdds, fetchAllOdds };
