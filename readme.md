# Google Tasks Syncro

A smart, high-performance, and lightweight bidirectional synchronization plugin for Obsidian and Google Tasks. Keep your tasks seamlessly updated across your markdown notes and mobile devices using the official Google Tasks API.

## Features

- **True Bidirectional Sync:** Modifying a task's text or checking it off in your mobile Google Tasks app updates your Obsidian note instantly on the next sync, and vice versa.
- **Smart Conflict Resolution:** Uses strict timestamps (`mtime` from local file vs `updated` from Google Cloud) to ensure the latest change always wins without destroying data.
- **Metadata & Emoji Preservation:** Naturally respects and preserves your Obsidian Tasks styling, including due dates (📅), priorities (⏫, 🔼, 🔽), and native block links (`^hashes`).
- **Contextual Lists Mapping:** Automatically synchronizes tasks into specific Google Task Lists based on the name of the folder where the active note resides, fallbacking to a default "Inbox" list.
- **Automated Background Timer:** Runs quietly in the background at your preferred interval or triggers instantly with a single ribbon icon click.

## How it Works (Under the Hood)

The engine scans your active markdown files looking for checklists (`- [ ]` or `- [x]`) and operates as follows:

1. **Identification:** When a new task is detected in Obsidian, the plugin automatically appends a short, unique block identifier (e.g., `^kl8a9b`) to the end of the line.
2. **Cloud Mapping:** During synchronization, this identifier is injected into the hidden `notes` metadata field of the task in Google Cloud, forging a permanent structural link between both systems.
3. **Data Merging:** On subsequent cycles, the plugin pulls all tasks from Google and compares the local file's modification time (`mtime`) against the cloud task's last updated timestamp (`updated`).
4. **Resolution:** If you modify a checkbox or title on your mobile app, the cloud timestamp wins and updates your markdown line cleanly without breaking your priority or date emojis. If you edit it in Obsidian later, those changes are securely pushed up to Google Tasks.

## Installation

### Manual Installation
1. Go to the [Releases](../../releases) section of this GitHub repository.
2. Download `main.js`, `manifest.json`, and `styles.css`.
3. Create a folder named `google-tasks-syncro` inside your vault's plugin directory: `.obsidian/plugins/google-tasks-syncro/`.
4. Move the downloaded files into that folder.
5. Reload Obsidian and enable the plugin under **Community plugins**.

## Configuration & Google Cloud Setup

Because this plugin connects directly to your personal Google Tasks space without using intermediate third-party servers, you need to create your own credentials on Google Cloud Platform:

1. **Create a Google Cloud Project:** Open the [Google Cloud Console](https://console.cloud.google.com/), click the project dropdown in the top-left, and select **New Project**.
2. **Enable the API:** Go to **APIs & Services** > **Library**, search for `Google Tasks API` and click **Enable**.
3. **OAuth Consent Screen:** Go to **APIs & Services** > **OAuth consent screen**. Select **User Type: External** and click **Create**. Fill out the required app and developer details. Publish the app to Production/Testing and under **Test users**, add your specific Google email account.
4. **Create Credentials:** Go to **APIs & Services** > **Credentials**. Click **+ Create Credentials** > **OAuth client ID**. Set the **Application type** strictly to **Web application**. Under **Authorized redirect URIs**, add exactly: `https://developers.google.com/oauthplayground`.
5. **Obsidian Setup:** Copy your resulting **Client ID** and **Client Secret**, paste them into the plugin's settings panel inside Obsidian, and use the Google Playground link to complete your initial token generation.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.