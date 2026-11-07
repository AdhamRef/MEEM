# Environment setup

Copy `.env.example` to `.env`, which git ignores, and fill it in. Settings are checked when the server starts. A bad setting stops it with a message naming the variable, and values are never printed.

## Variables

| Variable | Needed | What it's for |
|---|---|---|
| `DATABASE_URL` | Always | MongoDB connection string. Must be a replica set. |
| `APP_URL` | Always | The site's public address, for canonical links, the sitemap, and sharing. **Also read during `npm run build`,** since the home page is prerendered, so set it for the build too. |
| `AUTH_SECRET` | Production | At least 32 characters. Generate with `openssl rand -base64 32`. |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | Production | Google OAuth client. Set both or neither. |
| `NEXTAUTH_URL` | Production | The same address as `APP_URL`. |
| `YOUTUBE_API_ENABLED` | Optional | `true` turns on calls to YouTube. Off by default. |
| `YOUTUBE_API_KEY` | When enabled | YouTube Data API v3 key. |
| `CRON_SECRET` | For the daily refresh | At least 32 characters. Protects `/api/cron/youtube-refresh`. |
| `STORAGE_PROVIDER` | Optional | `local` (default) or `s3`. |
| `STORAGE_LOCAL_DIR` | Optional | Where `local` keeps uploads. Default `.data/uploads`. |
| `STORAGE_BUCKET`, `STORAGE_REGION`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY` | When `s3` | The bucket and its credentials. The bucket must allow public reads. |
| `STORAGE_ENDPOINT` | Optional | For S3-compatible providers other than AWS. |
| `STORAGE_PUBLIC_URL` | Optional | Where readers load images from, such as a CDN. |
| `LEGAL_RESPONSIBLE_NAME`, `LEGAL_CONTACT_EMAIL` | Before launch | Shown on `/privacy` and `/terms`. Until they're set, those pages say "not specified yet". |

## MongoDB

- **Locally:** `npm run db:dev` starts a replica set, with data in `.data/mongodb`.
- **Hosted:** MongoDB Atlas provides a replica set. Use its connection string.

Apply the schema with `npm run db:sync`, and **never `prisma db push` alone,** which removes the text and expiry indexes. Without them, search fails and expired data stays. Run `npm run db:sync` after pulling any change to `prisma/schema.prisma` or `prisma/mongo-indexes.ts`.

`npm run db:seed-taxonomy` adds any missing starting topics, and never overwrites existing ones.

## Google sign-in

1. In the [Google Cloud console](https://console.cloud.google.com/apis/credentials), create an OAuth client of type "Web application".
2. Add the redirect URI `<your address>/api/auth/callback/google`.
3. Put the client's ID and secret in `.env`.
4. Under the OAuth consent screen, add yourself as a test user while testing. Publish it before launch, so anyone can sign in.

Only `openid`, `email`, and `profile` are requested, and no YouTube scope.

## YouTube Data API

1. In the same console, enable **YouTube Data API v3**, and create an API key.
2. Restrict the key to that API. Because it's used from the server only, it can also be restricted by your server's IP address.
3. Set `YOUTUBE_API_ENABLED=true` and `YOUTUBE_API_KEY`.

## First super admin

Created from the command line, so it can't be reached from the web. It works once, and no privileged account is hardcoded.

1. Sign in once with the intended Google account, which creates the account.
2. Run `npm run db:bootstrap-admin -- you@example.com`.

Other roles are set at `/admin/users`. Nobody can be promoted to super admin in the site, and that account can't be changed or deleted there.

## A machine short on disk space or memory

If the system drive is short on space, point caches elsewhere before installing:

```powershell
$env:npm_config_cache = "D:\path\npm-cache"
$env:MONGOMS_DOWNLOAD_DIR = "D:\path\mongodb-binaries"
$env:PLAYWRIGHT_BROWSERS_PATH = "D:\path\playwright"
$env:TEMP = "D:\path\tmp"; $env:TMP = "D:\path\tmp"
```

The development compiler with parallel browsers needs a lot of memory, so run browser tests on a production build, one worker at a time. The README has the command.
