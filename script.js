document.getElementById('show-pickups').addEventListener('click', async function() {
    const events = await fetch('http://localhost:5500/getCalendarEvents').then(res => res.json());
    const eventsList = document.getElementById('output');
    eventsList.innerHTML = '';

    events.forEach(event => {
        const eventElement = document.createElement('p');
        eventElement.textContent = `Event: ${event.summary}, Start: ${event.start}, End: ${event.end}`;
        eventsList.appendChild(eventElement);
    });
});

document.getElementById('coming-soon').addEventListener('click', async function() {
    const events = await fetch('http://localhost:5500/getCalendarEventsForTomorrow').then(res => res.json());
    const eventsList = document.getElementById('output');
    eventsList.innerHTML = '';

    events.forEach(event => {
        const eventElement = document.createElement('p');
        eventElement.textContent = `Event: ${event.summary}, Start: ${event.start}, End: ${event.end}`;
        eventsList.appendChild(eventElement);
    });
});

document.getElementById('run-now').addEventListener('click', async function() {
    const events = await fetch('http://localhost:5500/runnow', { method: 'GET' }).then(res => res.json());
    const eventsList = document.getElementById('output');
    eventsList.innerHTML = '';

    events.forEach(event => {
        const eventElement = document.createElement('p');
        eventElement.textContent = `Appointment name: ${event["Service Name"]}, Appointment Time: ${event["Appointment Time"]}, Creation Time: ${event["Creation Time"]}`;

        const addButton = document.createElement('button');
        addButton.textContent = 'Add to Calendar';
        addButton.addEventListener('click', async () => {
            await fetch('http://localhost:5500/addEvent', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(event)
            });
            await refreshEvents();
        });

        eventElement.appendChild(addButton);
        eventsList.appendChild(eventElement);
    });
});

async function refreshEvents() {
    const events = await fetch('http://localhost:5500/runnow', { method: 'GET' }).then(res => res.json());
    const eventsList = document.getElementById('output');
    eventsList.innerHTML = '';

    events.forEach(event => {
        const eventElement = document.createElement('p');
        eventElement.textContent = `Appointment name: ${event["Service Name"]}, Appointment Time: ${event["Appointment Time"]}, Creation Time: ${event["Creation Time"]}`;

        const addButton = document.createElement('button');
        addButton.textContent = 'Add to Calendar';
        addButton.addEventListener('click', async () => {
            await fetch('http://localhost:5500/addEvent', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(event)
            });
            await refreshEvents();
        });

        eventElement.appendChild(addButton);
        eventsList.appendChild(eventElement);
    });
}

function formatOdds(n) {
    if (n === null || n === undefined) return '-';
    return n > 0 ? `+${n}` : `${n}`;
}

function renderLeagueTable(league, games) {
    const container = document.createElement('div');

    const heading = document.createElement('h3');
    heading.textContent = league.toUpperCase();
    container.appendChild(heading);

    if (games.error) {
        const errorEl = document.createElement('p');
        errorEl.textContent = `Error: ${games.error}`;
        container.appendChild(errorEl);
        return container;
    }

    if (!games.length) {
        const emptyEl = document.createElement('p');
        emptyEl.textContent = 'No games found.';
        container.appendChild(emptyEl);
        return container;
    }

    const table = document.createElement('table');
    table.className = 'odds-table';
    table.innerHTML = `
        <thead>
            <tr>
                <th>Start Time</th>
                <th>Away</th>
                <th>Home</th>
                <th>Moneyline</th>
                <th>Spread</th>
                <th>Total</th>
            </tr>
        </thead>
    `;

    const tbody = document.createElement('tbody');
    games.forEach(game => {
        const row = document.createElement('tr');

        const moneylineText = (game.moneyline || [])
            .map(o => `${o.team} ${formatOdds(o.odds)}`)
            .join(' / ') || '-';

        const spreadText = (game.spread || [])
            .map(o => `${o.team} ${o.line > 0 ? '+' : ''}${o.line} (${formatOdds(o.odds)})`)
            .join(' / ') || '-';

        const totalText = (game.total || [])
            .map(o => `${o.side} ${o.line} (${formatOdds(o.odds)})`)
            .join(' / ') || '-';

        row.innerHTML = `
            <td>${game.startTime ? new Date(game.startTime).toLocaleString() : '-'}</td>
            <td>${game.awayTeam || '-'}</td>
            <td>${game.homeTeam || '-'}</td>
            <td>${moneylineText}</td>
            <td>${spreadText}</td>
            <td>${totalText}</td>
        `;
        tbody.appendChild(row);
    });
    table.appendChild(tbody);
    container.appendChild(table);

    return container;
}

async function loadOdds(league) {
    const oddsOutput = document.getElementById('odds-output');
    oddsOutput.innerHTML = 'Loading...';

    try {
        if (league === 'all') {
            const oddsByLeague = await fetch('http://localhost:5500/api/odds').then(res => res.json());
            oddsOutput.innerHTML = '';
            Object.keys(oddsByLeague).forEach(lg => {
                oddsOutput.appendChild(renderLeagueTable(lg, oddsByLeague[lg]));
            });
        } else {
            const games = await fetch(`http://localhost:5500/api/odds/${league}`).then(res => res.json());
            oddsOutput.innerHTML = '';
            oddsOutput.appendChild(renderLeagueTable(league, games));
        }
    } catch (error) {
        console.error('Error fetching odds:', error);
        oddsOutput.innerHTML = 'Error loading odds.';
    }
}

['mlb', 'nfl', 'nba', 'nhl', 'all'].forEach(league => {
    document.getElementById(`odds-${league}`).addEventListener('click', () => loadOdds(league));
});

document.getElementById('force-now').addEventListener('click', async function() {
    try {
        const response = await fetch('http://localhost:5500/forcenow', { method: 'POST' });
        if (response.ok) {
            alert('All appointments are added to the calendar');
        } else {
            alert('Failed to add appointments to the calendar');
        }
    } catch (error) {
        console.error('Error:', error);
        alert('An error occurred while adding appointments');
    }
});
