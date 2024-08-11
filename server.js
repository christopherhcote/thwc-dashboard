const fs = require('fs');
const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');
const moment = require('moment-timezone');
const cors = require('cors');
const axios = require('axios');
const Papa = require('papaparse');


const auth = new GoogleAuth({
    keyFile: './config.json', 
    scopes: ['https://www.googleapis.com/auth/calendar'], 
});

const calendar = google.calendar({ version: 'v3', auth });

const timezone = 'America/New_York';

async function getCalendarEvents() {
    try {
        const calendarId = 'hastycalendar@gmail.com'; // or the ID of the calendar you want to use
        const now = moment.tz(timezone).startOf('day').format();
        console.log("now::",now);
        const endOfDay = moment.tz(timezone).endOf('day').format();
        console.log("end::",endOfDay)

        const response = await calendar.events.list({
            calendarId: calendarId,
            timeMin: now,
            timeMax: endOfDay,
            singleEvents: true,
            orderBy: 'startTime'
        });

        const events = response.data.items;
        
        // Filter out duplicate summaries
        const uniqueEvents = [];
        const seenSummaries = new Set();

        events.forEach(event => {
            const summary = event.summary;
            if (!seenSummaries.has(summary)) {
                seenSummaries.add(summary);
                uniqueEvents.push({
                    summary: summary,
                    start: event.start.dateTime || event.start.date,
                    end: event.end.dateTime || event.end.date
                });
            }
        });

        return uniqueEvents;
    } catch (error) {
        console.error('Error fetching calendar events:', error);
    }
}
async function getCalendarEventsForTomorrow() {
    try {
        const calendarId = 'hastycalendar@gmail.com'; 

        const startOfTomorrow = moment.tz(timezone).add(1, 'day').startOf('day').format();

        const endOfTomorrow = moment.tz(timezone).add(1, 'day').endOf('day').format();

        const response = await calendar.events.list({
            calendarId: calendarId,
            timeMin: startOfTomorrow,
            timeMax: endOfTomorrow,
            singleEvents: true,
            orderBy: 'startTime'
        });

        const events = response.data.items;

        // Filter out duplicate summaries
        const uniqueEvents = [];
        const seenSummaries = new Set();

        events.forEach(event => {
            const summary = event.summary;
            if (!seenSummaries.has(summary)) {
                seenSummaries.add(summary);
                uniqueEvents.push({
                    summary: summary,
                    start: event.start.dateTime || event.start.date,
                    end: event.end.dateTime || event.end.date
                });
            }
        });

        return uniqueEvents;
    } catch (error) {
        console.error('Error fetching calendar events:', error);
    }
}

async function getApiData() {
    const today = moment.tz(timezone).format('YYYY-MM-DD');
    const endOfYear = moment.tz(timezone).endOf('year').format('YYYY-MM-DD');
    const url = "https://api2.vcita.com/v2/reports?teams_view_filter=all";
    const headers = {
        'Authorization': 'Bearer f272aa9c07066d2e85a38de69bb3b85c84d9f2321dbc9fec42b8a50cc7226a30'
    };

    // Fetch the CSV data with dynamic dates
    const response = await axios.post(url, {
        "report_format": "csv",
        "report_type": "booking",
        "start_date": today,
        "end_date": endOfYear
    }, { headers: headers });

    const csvData = response.data.data.join('');
    const parsedData = Papa.parse(csvData, { header: true, skipEmptyLines: true });
    return parsedData.data;
}

async function filterApiData(apiData, calendarEvents) {
    return apiData.filter(apiItem => {
        const apiSummary = apiItem["Service Name"];
        const apiDate = moment(apiItem["Appointment Time"]).format('YYYY-MM-DD');
        return !calendarEvents.some(calendarEvent => {
            const calendarSummary = calendarEvent.summary;
            const calendarDate = moment(calendarEvent.start).format('YYYY-MM-DD');
            return apiSummary === calendarSummary && apiDate === calendarDate;
        });
    });
}

const express = require('express');
const { time } = require('console');
const app = express();
app.use(cors());
app.use(express.json());

app.get('/getCalendarEvents', async (req, res) => {
    const events = await getCalendarEvents();
    res.json(events);
});

app.get('/getCalendarEventsForTomorrow', async (req, res) => {
    const events = await getCalendarEventsForTomorrow();
    res.json(events);
});

app.get('/runnow', async (req, res) => {
    try {
        // Fetch API data and calendar events
        const apiData = await getApiData();

        const calendarEvents = await getCalendarEvents();

        // Filter API data based on calendar events
        const filteredApiData = await filterApiData(apiData, calendarEvents);

        res.json(filteredApiData);
    } catch (error) {
        console.error('Error in runnow:', error);
        res.sendStatus(500);
    }
});

app.post('/addEvent', async (req, res) => {
    try {
        const event = req.body;
        const calendarId = 'hastycalendar@gmail.com'; 
        const eventDate = moment(event["Appointment Time"], "MM/DD/YYYY HH:mm").format('YYYY-MM-DD');

        const response = await calendar.events.insert({
            calendarId: calendarId,
            resource: {
                summary: event["Service Name"],
                start: {
                    date: eventDate,
                },
                end: {
                    date: moment(eventDate).add(1, 'days').format('YYYY-MM-DD'), // The end date should be the day after
                }
            }
        });

        res.status(200).json(response.data);
    } catch (error) {
        console.error('Error adding event to calendar:', error.response ? error.response.data : error.message);
        res.status(500).send('Error adding event to calendar');
    }
});


app.post('/forcenow', async (req, res) => {
    try {
        const apiData = await getApiData();

        const calendarEvents = await getCalendarEvents();

        // Filter API data based on calendar events
        const filteredApiData = await filterApiData(apiData, calendarEvents);

        const calendarId = 'hastycalendar@gmail.com';

        // Iterate over filtered API data and add each appointment to the calendar
        const insertPromises = filteredApiData.map(async (event) => {
            const time = moment(event["Appointment Time"], "MM/DD/YYYY HH:mm").format();

            return calendar.events.insert({
                calendarId: calendarId,
                resource: {
                    summary: event["Service Name"],
                    start: {
                        dateTime: time,
                    },
                    end: {
                        dateTime: time,
                    }
                }
            });
        });

        // Wait for all events to be inserted
        await Promise.all(insertPromises);

        res.status(200).send('All events have been successfully added to the calendar');
    } catch (error) {
        console.error('Error adding events to calendar:', error.response ? error.response.data : error.message);
        res.status(500).send('Error adding events to calendar');
    }
});


let listener = app.listen(process.env.PORT || 5500, function() {
    console.log("Your app is listening on port " + listener.address().port);
});



