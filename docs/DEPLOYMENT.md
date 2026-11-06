# Deployment

The site is one Next.js application plus a MongoDB replica set, with no queues, Redis, or search engine to run. **It hasn't been deployed to a real host yet,** so treat this as the procedure to follow and check, rather than one that's been proven.

## Before launch

Some of these aren't technical, and the [owner's list](OWNER_ACTIONS.md) has the details.

- [ ] **API Compliance Audit addressed.** Launching publicly before this risks losing API access. See [YOUTUBE_COMPLIANCE_AUDIT.md](YOUTUBE_COMPLIANCE_AUDIT.md).
- [ ] Privacy policy and terms reviewed by a qualified person, with `LEGAL_RESPONSIBLE_NAME` and `LEGAL_CONTACT_EMAIL` set
- [ ] Real phones tested, and the temporary `/spike` code removed
- [ ] Google consent screen published, with the production redirect URI added
- [ ] Daily refresh scheduled and seen to run
- [ ] Database backups scheduled, and a restore tried

## Choosing a host

| Option | Works | Notes |
|---|---|---|
| A server or container running Node | Yes, and the simplest | `local` image storage works if the folder is on a persistent disk and is backed up. It doesn't work across several servers. |
| Serverless | Should work | Needs `STORAGE_PROVIDER=s3`, because local files don't persist. Importer steps are short by design, to fit request time limits. **Not tested.** |

Node 22.12 or newer. The first page load after a deployment may be slower, since server code loads on demand.

## Steps

```bash
npm ci
npm run db:sync            # with DATABASE_URL pointing at production
npm run db:seed-taxonomy   # only the first time
npm run build              # with APP_URL set to the real address
npm start
```

`npm ci` matters, because Prisma and TypeScript are pinned, and a newer Prisma doesn't support MongoDB.

Then:

1. Set the variables in [ENVIRONMENT_SETUP.md](ENVIRONMENT_SETUP.md). The server won't start in production without the sign-in settings.
2. Serve it over HTTPS. Session cookies are marked secure when `NEXTAUTH_URL` is `https`, and the site asks browsers to stay on HTTPS (HSTS).
3. Have your proxy set `X-Real-IP` or append to `X-Forwarded-For`. Rate limits are per address, so without this, all visitors share one limit.
4. Sign in, and run the [first super admin](ENVIRONMENT_SETUP.md#first-super-admin) command.

## The daily refresh is mandatory

YouTube requires stored data to be refreshed or removed within 30 days. **Without this job, videos leave the site after 30 days.**

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://your-site/api/cron/youtube-refresh
```

Check `/admin/youtube-status` afterwards, which shows quota use and how fresh the data is. Details are in [YOUTUBE_INTEGRATION.md](YOUTUBE_INTEGRATION.md).

## Updating

```bash
npm ci
npm run db:sync   # only needed if the schema or indexes changed, but always safe
npm run build
```

**The search and expiry indexes are removed and recreated during `db:sync`,** and search returns errors in between. On a large database, run it at a quiet time.

## Checking it worked

| Check | Expect |
|---|---|
| Open `/` as a guest | The feed, with no sign-in prompt |
| `/robots.txt` | Your real address in each sitemap line |
| `/sitemap/articles.xml` | Your published articles |
| Search for a published title | It's found |
| View `/admin` while signed out | Sent to sign in |
| Response headers on `/` | `Content-Security-Policy`, `Referrer-Policy: strict-origin-when-cross-origin` |
| Play a video | It plays. Error 153 means something between the site and the browser is stripping the referrer. |
| Sign in with Google | Returns to the site signed in |

## Backups

- **Database:** use your host's scheduled backups. It holds accounts, articles, and all editorial work.
- **Images:** with `local` storage, back up the upload folder too.
- **Secrets:** keep them in your host's secret manager. Changing `AUTH_SECRET` doesn't lose data, but may sign people out.

## Known dependency warnings

`npm audit` reports 3 high-severity issues, all one path: `prisma` → `@prisma/config` → `deepmerge-ts`. The only offered fix is Prisma 7, which doesn't support MongoDB. The problem is stack exhaustion when merging recursive objects, in Prisma's own configuration tooling, which handles no visitor input. It's accepted for now, and should be rechecked at each Prisma release. The remaining reports are moderate.

## Never run `prisma db push` alone

Search needs text indexes that only `npm run db:indexes` creates, and `prisma db push` deletes them. Without them, every search fails with an unexpected error. Use `npm run db:sync`, which does both.
