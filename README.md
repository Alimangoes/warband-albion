# Warband · Albion Online Party Organizer

Warband is a Node.js and SQLite web app for one Discord server per deployment. Discord members sign in, link an Albion character, and claim a role in a scheduled party. Organizers set named roles and slot counts, and publishing posts a signup link to the selected Discord channel.

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

1. Create an application and bot in the [Discord Developer Portal](https://discord.com/developers/applications).
2. Under **OAuth2**, add `http://localhost:4317/auth/discord/callback` to test locally. For your guild deployment, add `https://your-domain/auth/discord/callback` using your actual HTTPS origin. Discord requires the registered redirect URI to match exactly.
3. Install the bot in your Discord server using the `bot` scope. Give it **View Channel** and **Send Messages** in the channels that may receive announcements. The app uses individual member lookups via Discord's REST API. Gateway connections and privileged intents are unnecessary. [Discord guild member API](https://docs.discord.com/developers/resources/guild#get-guild-member)
4. Copy `.env.example` to `.env`. Set `DEMO_MODE=false` and add the Discord application ID, OAuth2 client secret, bot token, and target server ID. Copy the server ID from Discord with Developer Mode enabled. Keep the two secrets in your server's environment or local `.env`.
5. Run `npm start` and sign in as the Discord server owner or a member with **Administrator** or **Manage Server**. In **Settings**, choose the organizer role, announcement channel, Albion region, and optionally the exact Albion guild name. Server administrators retain management access. Other Discord members can browse parties and sign up.
6. For shared use, deploy this folder to a Node.js host with persistent storage for `data/` and set `APP_URL` to the public HTTPS origin. The server uses HTTP internally. Terminate HTTPS at the host or reverse proxy. Set `PORT` for the host and `BIND_HOST` if the proxy expects a specific bind address. Party links in Discord use `APP_URL`, so localhost links are only usable on the host machine.

## Albion compatibility

The app queries Albion's public Gameinfo endpoints for Asia, Europe, and the Americas. Members link an exact character name and region in **Profile**. The configured guild's in-game roster appears under **Guild roster**. An organizer can require a guild match when publishing. Warband checks the linked character's current guild again before accepting a guild-only signup. Character ownership is self-reported, so Discord roles are the source of management permissions.

## Party workflow

- Set the activity, start time, meeting location, notes, and up to 20 slots split between named roles. The browser shows times in its local time zone.
- Publishing saves the party and posts to the saved Discord channel. The post links directly to the party and suppresses user and role pings.
- Members can claim one slot per party, change roles when space is available, and leave before the start time. The board closes signups at the start time.
- Failed announcements remain visible to organizers. Open the party to retry delivery to its original channel. If delivery was uncertain, check Discord before retrying.
- Cancelling a party closes signups in Warband. Its original Discord announcement continues to link to the cancelled party.

Run `npm run check` for syntax checks. The local build uses Node's SQLite module. The Vercel build uses the `pg` driver for Postgres. Back up a local SQLite database using a SQLite-aware backup tool.
