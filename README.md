# Warband · Albion Online Party Organizer

Warband is a Node.js web app with SQLite locally and Postgres on Vercel. It supports one Discord server or separate server workspaces in the same deployment. Discord members sign in, link an Albion character, and claim a party role. Organizers configure roles, templates, and announcements for their own server.

## Multiple Discord servers

Set `MULTI_SERVER_MODE=true` to enable the server picker. Set `DISCORD_ALLOWED_GUILD_IDS` to a comma-separated list of approved Discord server IDs to restrict access; leaving it blank allows any server where the bot is installed. Keep `DISCORD_GUILD_ID` as the original server ID and leave production `DATA_NAMESPACE` unset to preserve existing data.

Install the same deployment's bot in each server using **Add to Discord**. A server administrator signs in, opens that server, and chooses its Albion region and guild, organizer role, and announcement channel in Settings. Parties, templates, linked characters, member roles, settings, and Discord commands are scoped to that server.

When upgrading from single-server mode, existing users must sign out and sign in again to grant Discord's server-list permission. Existing guild data is retained. A separate preview application uses its own credentials and a unique `DATA_NAMESPACE`; its bot installation and settings do not automatically transfer to production.

## Shared Discord metadata cache and testing

The existing database shares the bot's installed-server list for 15 seconds and its identity for five minutes across app instances. Cache keys include the Discord application ID and use the deployment's database namespace. Concurrent refreshes share a leased database record; failed reads are not cached. New bot installations can take up to 15 seconds to appear in the server picker.

Member lookups, role permissions, channel permissions and sign-in requirements remain live. Metadata cache entries never grant access to a workspace. This cache reduces repeated metadata requests; it does not eliminate the browser's refresh requests or establish a maximum supported user count.

Run `npm run check` and `npm test` from this directory with Node.js 24. Tests use local SQLite and mocked Discord/Albion responses, discard database connection environment variables, and do not send Discord messages. They cover cache expiry and failed refreshes, 40 simultaneous readers across four simulated cache instances, 40 concurrent board requests, live membership revocation, server isolation, and onboarding a third server with the allowlist empty. Local mock timings are not production capacity measurements.

For a manual check, invite the production bot to a test Discord server and sign in as its administrator. Configure a test announcement channel, organizer role and Albion guild, then save a template and publish a test party. Use a regular member and guest account to check visibility and signups; remove the required sign-in role to confirm access is revoked. Switch to another server and verify that its templates and parties are separate. Monitor Vercel function usage, latency, errors, database connections and Discord 429 responses during a small pilot before increasing traffic. Avoid load-testing against real Discord or Albion APIs.

## Run the demo

Install Node.js 24, open a terminal in this folder, and run:

```powershell
npm ci
npm start
```

Open [the demo](http://localhost:4317). The demo starts with example parties, a roster, and announcement channels. It simulates Discord messages and Albion lookups. Demo data is browser-specific and expires after seven days.

## Deploy on Vercel Hobby

1. Create a Vercel Hobby project for personal, non-commercial use. From the extracted project folder, run `npx vercel login` and `npx vercel link`, then select or create the project. The project uses Node.js 24 and the default framework settings. [Vercel Hobby plan](https://vercel.com/docs/plans/hobby)
2. Create a Neon Postgres database on the Free plan. In Vercel's project settings, add the Neon pooled connection string as `DATABASE_URL` for Production. If the Neon integration already provided `DATABASE_URL` or `POSTGRES_URL`, Warband can use it. Warband creates its tables on first use. [Neon integration](https://vercel.com/marketplace/neon)
3. Set these variables in Vercel's **Settings → Environment Variables** for Production.

   | Variable | Value |
   | --- | --- |
   | `APP_URL` | Your stable HTTPS production origin, such as `https://your-project.vercel.app` |
   | `DEMO_MODE` | `false` |
   | `DISCORD_CLIENT_ID` | Discord application ID |
   | `DISCORD_CLIENT_SECRET` | Discord OAuth2 client secret |
   | `DISCORD_BOT_TOKEN` | Discord bot token |
   | `DISCORD_GUILD_ID` | Target Discord server ID |

4. Follow the Discord setup below. Register the exact `APP_URL` followed by `/auth/discord/callback` in the Discord Developer Portal. Keep credentials in Vercel's environment settings. Deploy from the project folder with `npx vercel --prod`.
5. Open the production URL and sign in as a Discord server admin. In Warband Settings choose a test channel, an organizer role, and your Albion region and guild. Publish a party with one slot and verify that the Discord message opens the party. Ask two guild members to try claiming the slot. Only one should get it. Redeploy and confirm the party and signup are still present.

The Vercel deployment starts with its own Postgres database. The local demo uses SQLite when no connection string is set.

## Connect your Discord server

To enable role signup buttons, set `DISCORD_PUBLIC_KEY` to the app's public key from Discord Developer Portal → General Information. Deploy, then set the Interactions Endpoint URL to your public origin plus `/api/discord/interactions`. Members need saved roles in Warband before using the buttons. Announcements gain buttons on publishing or after an organizer saves an edit.

Once Discord interactions are configured, Warband registers **/help** automatically when the board loads and **/warband** when the server has saved templates. Organizers can run `/warband template:Gold Run T7 start:11/16/2026 09:00 PM note:Bring a swap set`. The template field suggests saved templates. Start times use Philippine time (UTC+8), and omitting the note keeps the saved note. Warband adds the party to the board and sends the announcement using the configured channel and the template's announcement options.

Use **/help** for the full guide or **/help topic:** to open a specific section. Update `discord-help.mjs` when a workflow or command changes.

The recommended build picker uses equipment metadata from [ao-bin-dumps](https://github.com/ao-data/ao-bin-dumps) and icons from Albion's render service. Run `node scripts/update-albion-items.mjs` to refresh the bundled catalog.

1. Create an application and bot in the [Discord Developer Portal](https://discord.com/developers/applications).
2. Under **OAuth2**, add `http://localhost:4317/auth/discord/callback` to test locally. For your guild deployment, add `https://your-domain/auth/discord/callback` using your actual HTTPS origin. Discord requires the registered redirect URI to match exactly.
3. Install the bot in your Discord server using the `bot` scope. Give it **View Channel** and **Send Messages** in the channels that may receive announcements. The app uses individual member lookups via Discord's REST API. [Discord guild member API](https://docs.discord.com/developers/resources/guild#get-guild-member)
4. Copy `.env.example` to `.env`. Set `DEMO_MODE=false` and add the Discord application ID, OAuth2 client secret, bot token, and target server ID. Copy the server ID from Discord with Developer Mode enabled. Keep the two secrets in your server's environment or local `.env`.
5. Run `npm start` and sign in as the Discord server owner or a member with **Administrator** or **Manage Server**. In **Settings**, choose the organizer role, announcement channel, Albion region, and optionally the Albion guild ID. Server administrators retain management access. Other Discord members can browse parties and sign up.
6. For shared use, deploy this folder to a Node.js host with persistent storage for `data/` and set `APP_URL` to the public HTTPS origin. The server uses HTTP internally. Terminate HTTPS at the host or reverse proxy. Set `PORT` for the host and `BIND_HOST` if the proxy expects a specific bind address. Party links in Discord use `APP_URL`, so localhost links are only usable on the host machine.

## Post the Discord guide

Enable **Warband guide** under **Settings** and select a text channel. Give the bot **View Channel**, **Send Messages**, and **Embed Links** there. **Save guide** edits the existing post when the channel stays the same.

## Albion compatibility

The app queries Albion's public Gameinfo endpoints for Asia, Europe, and the Americas. Members link an exact character name and region in **Profile**. The configured guild's in-game roster appears under **Guild members**. An organizer can require a guild match when publishing. Warband checks the linked character's current guild again before accepting a guild-only signup. Character ownership is self-reported, so Discord roles are the source of management permissions.

## Party workflow

Organizers can transfer templates between server workspaces: open **Templates**, use **Export** on a saved template to download its JSON file, then choose **Import template** in the destination workspace. Review the draft and click **Save template**. Roles, slot counts, recommended builds, notes and scheduling options are preserved. Discord mentions are cleared so you can choose roles from the destination server. Imports are limited to 24 KB and are validated before opening; importing does not publish a party or overwrite an existing template.

- Set the activity, start time, meeting location, notes, and up to 20 slots split between named roles. The browser shows times in its local time zone.
- Publishing saves the party and posts to the saved Discord channel. The post links directly to the party and suppresses user and role pings.
- Members can claim one slot per party, change roles when space is available, and leave before the start time. The board closes signups at the start time.
- Failed announcements remain visible to organizers. Open the party to retry delivery to its original channel. If delivery was uncertain, check Discord before retrying.
- Cancelling a party closes signups in Warband. Its original Discord announcement continues to link to the cancelled party.
- Organizers can **Finish** a party to close signups and retain the roster, or **Delete** it to remove it, its signups, and its linked Discord thread. The bot needs **Manage Threads** in the announcement channel. Announcements posted directly in a channel remain there.
- Members select at least one role before their first party signup and can edit their choices in **Profile**. Give the Warband bot **Manage Roles**, then click **Settings → Set up Discord roles** as a server admin. Warband creates the eight member roles with permissions off and links them for sync. Any existing matching roles must have permissions off and sit below the bot. Members can click **Save roles** again to retry sync after setup or a Discord error.

Run `npm run check` for syntax checks. The local build uses Node's SQLite module. The Vercel build uses the `pg` driver for Postgres. Back up a local SQLite database using a SQLite-aware backup tool.
