# Islamic knowledge discovery platform

An Arabic-first, free platform that connects short videos, articles, topics, libraries, and playlists.

**Current status:** all nine phases are built. It hasn't been launched, and some things need real phones, real accounts, and the YouTube API Compliance Audit first. See [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md) and [docs/OWNER_ACTIONS.md](docs/OWNER_ACTIONS.md).

In development, `/design-system` shows every design token and component. See [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md).

## Prerequisites

- Node.js 22.12 or newer (developed on 24)
- About 1.5 GB of free disk space: `npm ci` downloads a MongoDB binary of about 800 MB for local development and tests
- No Docker or MongoDB installation is needed

## Setup

```bash
npm ci
cp .env.example .env
npm run db:dev        # in a separate terminal; leave it running
npm run db:sync       # applies the schema and indexes
npm run db:seed-taxonomy   # adds the starting topics
npm run dev
```

Use `npm ci`, because key versions are deliberately pinned. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

If your system drive is short on space, set these before installing:

```powershell
$env:npm_config_cache = "D:\path\npm-cache"
$env:MONGOMS_DOWNLOAD_DIR = "D:\path\mongodb-binaries"
$env:PLAYWRIGHT_BROWSERS_PATH = "D:\path\playwright"
$env:TEMP = "D:\path\tmp"; $env:TMP = "D:\path\tmp"
```

## MongoDB

MongoDB must run as a **replica set**, because Prisma uses transactions.

- **Local:** `npm run db:dev` starts one, with data in `.data/mongodb`. Data persists across restarts.
- **Hosted:** MongoDB Atlas provides one. Put its connection string in `DATABASE_URL`.

**Apply schema changes only with `npm run db:sync`, and never with `prisma db push` alone.** Prisma Migrate isn't available for MongoDB, and a bare push deletes the search and data-expiry indexes. See [docs/DATABASE_DESIGN.md](docs/DATABASE_DESIGN.md).

## Google sign-in

Sign-in is optional for visitors, and the site works without it being configured: the sign-in page then explains that it's unavailable.

1. In the [Google Cloud console](https://console.cloud.google.com/apis/credentials), create an OAuth client of type "Web application".
2. Add this authorized redirect URI, using your own domain in production: `http://localhost:3000/api/auth/callback/google`
3. Put the client ID and secret in `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`, and generate `AUTH_SECRET` with `openssl rand -base64 32`.

Only the `openid`, `email`, and `profile` scopes are requested.

## YouTube

The site runs without an API key, showing whatever is stored. With one, set `YOUTUBE_API_ENABLED=true` and `YOUTUBE_API_KEY`.

Normally, videos come through the channel importer at `/admin/youtube-importer`. See [docs/ADMIN_GUIDE.md](docs/ADMIN_GUIDE.md) and [docs/YOUTUBE_INTEGRATION.md](docs/YOUTUBE_INTEGRATION.md). To fill a local feed quickly with specific videos (development only, since this skips the review that publishing normally requires):

```bash
npm run youtube:import-dev -- VIDEO_ID_OR_URL ANOTHER_ID
```

**In production, schedule a daily call to the refresh endpoint.** YouTube requires stored data to be refreshed or removed within 30 days, and videos past that limit leave the site until refreshed. Set `CRON_SECRET`, then:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://your-site/api/cron/youtube-refresh
```

## Images

Article and cover images go through the storage provider in `STORAGE_PROVIDER`.

- **`local`** (the default) keeps files in `STORAGE_LOCAL_DIR`, which is `.data/uploads`. Files don't persist on serverless hosts, and each server keeps its own copy, so back this folder up or use S3.
- **`s3`** works with any S3-compatible provider. The bucket must allow public reads. See `.env.example`.

## First super admin

The first super admin is created from the command line, so it can't be reached from the web. It works only once, and no privileged account is hardcoded.

1. Sign in once with the intended Google account, which creates the account.
2. Run:

   ```bash
   npm run db:bootstrap-admin -- you@example.com
   ```

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and server |
| `npm run typecheck` | TypeScript checks |
| `npm run lint` | ESLint, with warnings treated as failures |
| `npm run test:unit` | Unit tests |
| `npm run test:integration` | Integration tests on a temporary MongoDB replica set |
| `npm test` | Unit and integration tests |
| `npm run test:e2e` | Browser tests on mobile and desktop profiles, on their own temporary database, with a stub of YouTube's player. Run `npx playwright install chromium` once first. |
| `npm run db:validate` | Validates the Prisma schema |
| `npm run db:sync` | Applies the schema and indexes |
| `npm run db:seed-taxonomy` | Adds any missing starting topics. It never overwrites existing ones. |
| `npm run check:bundle` | After a build, checks that no secret names or values reached browser code |
| `npm run verify` | Validation, typecheck, lint, unit and integration tests, and build |

`db:validate`, and therefore `verify`, needs `DATABASE_URL` to be set, so create `.env` first. It doesn't connect to the database.

## Environment

All variables are documented in [.env.example](.env.example). The server validates them at startup. If anything is wrong, it prints which variables to fix, never their values, and exits with code 1.

`AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, and `NEXTAUTH_URL` are required in production only.

**On a machine short on memory,** test a production build, which needs far less than the dev compiler. Pages that exist only in development return 404 there, so skip their tests:

```powershell
npm run build
$env:E2E_SERVER="production"; npx playwright test --workers=1 --grep-invert "design-system|article quotes|English name|error state shows"
```

## More documentation

| Document | Contents |
|---|---|
| [docs/ENVIRONMENT_SETUP.md](docs/ENVIRONMENT_SETUP.md) | Every setting, MongoDB, Google, YouTube, and the first super admin |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Going live, updating, and checking it worked |
| [docs/PRODUCT_SPECIFICATION.md](docs/PRODUCT_SPECIFICATION.md) | What the product does, and where it differs from the specification |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the code is organised |
| [docs/DATABASE_DESIGN.md](docs/DATABASE_DESIGN.md) | The schema and its rules |
| [docs/YOUTUBE_INTEGRATION.md](docs/YOUTUBE_INTEGRATION.md) | API use, the importer, and the daily refresh |
| [docs/YOUTUBE_COMPLIANCE_AUDIT.md](docs/YOUTUBE_COMPLIANCE_AUDIT.md) | Preparation for YouTube's audit |
| [docs/ADMIN_GUIDE.md](docs/ADMIN_GUIDE.md) | Using the dashboard |
