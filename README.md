# Overview

## Setup Instructions

1. Google Cloud Console Setup (one-time):
- Go to [Google Cloud Console](https://console.cloud.google.com/)
- Create a new project
- Enable Google Calendar API
- Create an OAuth 2.0 "Desktop App" credential
- Download or copy the Client ID and Client Secret

2. Plugin Setup (first run):
- Install this plugin in Obsidian
- Open Settings → Google Calendar
- Paste Client ID and Client Secret
- Click "Start OAuth Flow"
- A browser window opens; grant consent
- Copy the authorization code shown
- Paste it back into the "Authorization Code" field
- You'll see "✅ Authenticated"

3. Use the Commands:
- Cmd+P (or Ctrl+P) → "Fetch Google Calendar events for today"
- The events insert into your active note

## Adding calendars

You can sync with multiple calendars from the same account.
To sync with a calendar you'll need to find its Calendar ID
1. Go to "Calendar settings"
2. Scroll to "Integrate calendar"
3. Copy the "Calendar ID"
4. In this plugin's settings, click "+ Add Calendar"
5. Type the Display name in the first column and paste the Calendar ID in the second.
