const axios = require('axios');

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Sports data hosts (MLB/NHL/NBA stats backends in particular) are free,
// unauthenticated, and unofficial - being polite (delay + limited retries)
// keeps a multi-thousand-request backfill from getting IP-throttled or
// blocked outright.
async function politeGet(url, options = {}, { retries = 3, delayMs = 300 } = {}) {
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const response = await axios.get(url, { timeout: 15000, ...options });
            await sleep(delayMs);
            return response;
        } catch (error) {
            if (attempt === retries) throw error;
            await sleep(delayMs * (attempt + 1) * 2);
        }
    }
    throw new Error('unreachable');
}

module.exports = { sleep, politeGet };
