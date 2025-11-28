import { App, Plugin, PluginSettingTab, Setting, Notice, Modal, requestUrl } from 'obsidian';

interface GoogleCalendarSettings {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  accessToken: string;
  accessTokenExpiry: number; // timestamp in ms
  calendarId: string; // "primary" or specific calendar ID
}

const DEFAULT_SETTINGS: GoogleCalendarSettings = {
  clientId: '',
  clientSecret: '',
  refreshToken: '',
  accessToken: '',
  accessTokenExpiry: 0,
  calendarId: 'primary',
};

export default class GoogleCalendarPlugin extends Plugin {
  settings: GoogleCalendarSettings;

  async onload() {
    await this.loadSettings();

    // Add a command to fetch today's events
    this.addCommand({
      id: 'fetch-calendar-today',
      name: 'Fetch Google Calendar events for today',
      callback: () => this.fetchAndInsertEvents(new Date()),
    });

    // Add a command to fetch a specific date (opens date picker)
    this.addCommand({
      id: 'fetch-calendar-specific-date',
      name: 'Fetch Google Calendar events for a specific date',
      callback: () => new DatePickerModal(this.app, (date) => this.fetchAndInsertEvents(date)).open(),
    });

    // Add settings tab
    this.addSettingTab(new GoogleCalendarSettingTab(this.app, this));
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  /**
   * Ensure access token is valid; refresh if needed
   */
  async ensureValidAccessToken(): Promise<boolean> {
    if (!this.settings.refreshToken) {
      new Notice('❌ No refresh token. Go to settings and complete OAuth setup.');
      return false;
    }

    const now = Date.now();
    if (this.settings.accessToken && this.settings.accessTokenExpiry > now + 60000) {
      // Token still valid (with 1 min buffer)
      return true;
    }

    // Refresh the token
    try {
      const response = await requestUrl({
        url: 'https://oauth2.googleapis.com/token',
        method: 'POST',
        contentType: 'application/x-www-form-urlencoded',
        body: new URLSearchParams({
          client_id: this.settings.clientId,
          client_secret: this.settings.clientSecret,
          refresh_token: this.settings.refreshToken,
          grant_type: 'refresh_token',
        }).toString(),
      });

      const data = JSON.parse(response.text);
      if (data.access_token) {
        this.settings.accessToken = data.access_token;
        this.settings.accessTokenExpiry = now + (data.expires_in || 3600) * 1000;
        await this.saveSettings();
        return true;
      } else {
        new Notice('❌ Failed to refresh token. Check your OAuth credentials.');
        return false;
      }
    } catch (err) {
      new Notice(`❌ Token refresh error: ${err}`);
      return false;
    }
  }

  /**
   * Fetch events for a specific date and insert into active note
   */
  async fetchAndInsertEvents(date: Date): Promise<void> {
    if (!(await this.ensureValidAccessToken())) {
      return;
    }

    // Build time bounds for the entire day (UTC)
    const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
    const timeMin = `${dateStr}T00:00:00Z`;
    const timeMax = `${dateStr}T23:59:59Z`;

    try {
      const response = await requestUrl({
        url: `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(this.settings.calendarId)}/events` +
             `?timeMin=${encodeURIComponent(timeMin)}` +
             `&timeMax=${encodeURIComponent(timeMax)}` +
             `&singleEvents=true` +
             `&orderBy=startTime`,
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.settings.accessToken}`,
        },
      });

      const data = JSON.parse(response.text);
      const events = data.items || [];

      if (events.length === 0) {
        new Notice(`No events on ${dateStr}`);
        return;
      }

      // Format events into a readable string
      let eventText = `## Calendar Events for ${dateStr}\n\n`;
      for (const event of events) {
        const startTime = event.start?.dateTime || event.start?.date || 'All day';
        const endTime = event.end?.dateTime || event.end?.date || '';
        const title = event.summary || '(No title)';
        const description = event.description ? `\n  ${event.description}` : '';

        eventText += `- **${title}** (${startTime})${description}\n`;
      }

      // Insert into the active note
      const { MarkdownView } = require('obsidian');
      const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (activeView) {
        const editor = activeView.editor;
        editor.replaceSelection(eventText);
        new Notice(`✅ Inserted ${events.length} event(s)`);
      } else {
        new Notice('❌ No active note open');
      }
    } catch (err) {
      new Notice(`❌ Error fetching events: ${err}`);
    }
  }
}

/**
 * Settings tab for OAuth setup and calendar selection
 */
class GoogleCalendarSettingTab extends PluginSettingTab {
  plugin: GoogleCalendarPlugin;

  constructor(app: App, plugin: GoogleCalendarPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Google Calendar Setup' });

    new Setting(containerEl)
      .setName('Client ID')
      .setDesc('From Google Cloud Console OAuth 2.0 credentials')
      .addText((text) =>
        text
          .setPlaceholder('your-client-id.apps.googleusercontent.com')
          .setValue(this.plugin.settings.clientId)
          .onChange(async (value) => {
            this.plugin.settings.clientId = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Client Secret')
      .setDesc('From Google Cloud Console OAuth 2.0 credentials')
      .addText((text) =>
        text
          .setPlaceholder('your-client-secret')
          .setValue(this.plugin.settings.clientSecret)
          .onChange(async (value) => {
            this.plugin.settings.clientSecret = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Start OAuth Flow')
      .setDesc(
        'Click to open Google login in your browser. After consent, copy the authorization code and paste it below.'
      )
      .addButton((btn) =>
        btn.setButtonText('Open Google Login').onClick(() => {
          this.startOAuthFlow();
        })
      );

    new Setting(containerEl)
      .setName('Authorization Code')
      .setDesc('Paste the code from the browser after granting consent')
      .addText((text) =>
        text
          .setPlaceholder('Paste authorization code here')
          .onChange(async (value) => {
            if (value.trim()) {
              await this.exchangeCodeForToken(value.trim());
            }
          })
      );

    new Setting(containerEl)
      .setName('Calendar ID')
      .setDesc('Use "primary" for your main calendar, or paste a specific calendar ID')
      .addText((text) =>
        text
          .setPlaceholder('primary')
          .setValue(this.plugin.settings.calendarId)
          .onChange(async (value) => {
            this.plugin.settings.calendarId = value || 'primary';
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Token Status')
      .setDesc(
        this.plugin.settings.refreshToken
          ? `✅ Authenticated (expires ${new Date(this.plugin.settings.accessTokenExpiry).toLocaleString()})`
          : '❌ Not authenticated'
      );
  }

  /**
   * Start OAuth flow by opening the authorization URL
   */
  startOAuthFlow(): void {
    if (!this.plugin.settings.clientId) {
      new Notice('❌ Client ID is required');
      return;
    }

    const scopes = encodeURIComponent('https://www.googleapis.com/auth/calendar.readonly');
    const redirectUri = encodeURIComponent('urn:ietf:wg:oauth:2.0:oob');

    const authUrl =
      `https://accounts.google.com/o/oauth2/v2/auth` +
      `?client_id=${encodeURIComponent(this.plugin.settings.clientId)}` +
      `&redirect_uri=${redirectUri}` +
      `&response_type=code` +
      `&scope=${scopes}` +
      `&access_type=offline` +
      `&prompt=consent`;

    // Open in system browser
    window.open(authUrl, '_blank');

    new Notice('📖 Google login page opened in your browser. Copy the authorization code and paste it in the settings.');
  }

  /**
   * Exchange authorization code for refresh token
   */
  async exchangeCodeForToken(code: string): Promise<void> {
    if (!this.plugin.settings.clientId || !this.plugin.settings.clientSecret) {
      new Notice('❌ Client ID and Secret are required');
      return;
    }

    try {
      const response = await requestUrl({
        url: 'https://oauth2.googleapis.com/token',
        method: 'POST',
        contentType: 'application/x-www-form-urlencoded',
        body: new URLSearchParams({
          code,
          client_id: this.plugin.settings.clientId,
          client_secret: this.plugin.settings.clientSecret,
          redirect_uri: 'urn:ietf:wg:oauth:2.0:oob',
          grant_type: 'authorization_code',
        }).toString(),
      });

      const data = JSON.parse(response.text);

      if (data.refresh_token) {
        this.plugin.settings.refreshToken = data.refresh_token;
        this.plugin.settings.accessToken = data.access_token;
        this.plugin.settings.accessTokenExpiry = Date.now() + (data.expires_in || 3600) * 1000;
        await this.plugin.saveSettings();
        new Notice('✅ OAuth setup complete! You can now use the calendar commands.');
        this.display(); // Refresh settings tab
      } else {
        new Notice('❌ Failed to get refresh token. Check your code and credentials.');
      }
    } catch (err) {
      new Notice(`❌ Error exchanging code: ${err}`);
    }
  }
}

/**
 * Modal for picking a date
 */
class DatePickerModal extends Modal {
  private dateCallback: (date: Date) => void;

  constructor(app: App, callback: (date: Date) => void) {
    super(app);
    this.dateCallback = callback;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl('h2', { text: 'Select a Date' });

    const input = contentEl.createEl('input', { type: 'date' });
    input.value = new Date().toISOString().split('T')[0];

    const buttonContainer = contentEl.createEl('div');
    buttonContainer.style.marginTop = '1rem';

    const submitBtn = buttonContainer.createEl('button', { text: 'Fetch Events' });
    submitBtn.onclick = () => {
      const selectedDate = new Date(input.value);
      this.dateCallback(selectedDate);
      this.close();
    };

    const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
    cancelBtn.style.marginLeft = '0.5rem';
    cancelBtn.onclick = () => this.close();
  }
}