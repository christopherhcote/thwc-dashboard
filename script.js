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
