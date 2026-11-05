# What the project needs from you

Everything only you can do, across all phases, in the order that helps most. Tick items as you finish them, and tell me which ones are done.

**Never paste keys or secrets into a chat.** Put them in the `.env` file in the project folder, which git ignores, and just tell me they're there. If you don't have that file yet, run `cp .env.example .env`. Restart the server after changing it.

## Do these now

These are what's holding Phases 1, 3, and 4 open.

### First: keep some space free on C:

- [ ] C: has about 3.4 GB free. Aim for at least 10 GB, since Windows and other programs can fail when it runs out. D: is fine now, at about 84 GB.

### 1. Test on real phones

Autoplay, swiping, and sound can't be tested by me, because emulators don't behave like real phones. This decides the final feed layout (D2) and the player approach.

- [ ] Follow "How to run the device test" in [PROJECT_STATUS.md](PROJECT_STATUS.md), on **an iPhone with Safari** and **an Android phone with Chrome**.
- [ ] Send me the answers to its 7 questions for each phone. A short message is fine.

If you only have one kind of phone, send that one's results, and find the other when you can.

### 2. Send me some real video links

- [x] YouTube API key added to `.env`. It works: importing, refreshing, comments, and playlists all ran against the real API.
- [ ] Send me **a few real Short URLs** from channels you intend to use. Only real vertical Shorts can finish the vertical-video test.
- [ ] Once signed in as super admin, try the importer at `/admin/youtube-importer` on a real channel. It's the one thing in Phase 7 that hasn't run for real, so tell me how it goes, including any wrong numbers or confusing steps. This is also how to fill your feed: import, then publish from `/admin/shorts`.

### 3. Finish Google sign-in

Your credentials are in `.env`, but only you can complete a real sign-in, because it needs your Google account in a browser.

1. Check the "OAuth consent screen" in Google Cloud lists your account as a test user, and that the OAuth client has this redirect URI: `http://localhost:3000/api/auth/callback/google`
2. Run `npm run db:dev` in one terminal, and `npm run db:sync` once if you haven't yet.
3. Run `npm run dev` in another, open the site, and sign in with the Google account that will be the super admin.
4. Run `npm run db:bootstrap-admin -- your@email.com`. It works only once.

- [ ] Sign-in worked, or send me what went wrong
- [ ] `/admin` opens for you, which confirms the super admin

### 4. Make these decisions

- [ ] **Commits.** Nothing is committed yet, so a disk failure would lose all of it. May I commit Phases 1 to 8? I recommend yes. The temporary spike code would be included, then removed later.
- [ ] **My proposed decisions.** Review the "Proposed, awaiting approval" table in [PROJECT_STATUS.md](PROJECT_STATUS.md). Tell me only what you disagree with. The ones most worth reading are listed below.
- [x] **Product name:** مسلم (Muslim), decided 2026-11-05.
- [ ] **Logo and favicon.** The current ones are temporary. Send files when you have them, ideally SVG.
- [ ] **Starting categories.** Check that the 12 categories suit you, on `/interests`.

| Decision to check | What I did | Why it matters |
|---|---|---|
| Role management | Only the super admin manages roles. Admins can only view users. | Admins may need more, depending on how you run the team |
| Publishing | Editors need an individual grant to publish | Your editors can't publish until you grant it |
| Who can add external resources | Anyone with the "relationships" permission: editors and above | Contributors can't add them |
| One super admin | Only one, and nobody can be promoted to it in the application | Losing that Google account needs a manual database fix |

### 5. Try the editor and dashboard yourself

Automated tests can show that the editor works, but not whether it's comfortable. Only you and your volunteers can judge that, and the plan asks that a non-technical volunteer can use it.

- [ ] Once sign-in works, write a short article at `/admin/articles`, in Arabic, on your phone and computer. Tell me anything confusing or badly worded.

## Now that Phase 8 is built

Nothing here blocks me from building. Without them, I build and test against mocked YouTube data and tell you what stayed unverified.

- [ ] **Phase 6, already built:** the URLs of 2 or 3 real YouTube playlists you'd like to feature, ideally including a long one. So far a real playlist has only been tried with one video.
- [ ] **Phase 7, already built:** your first volunteers sign in once, then you set their roles at `/admin/users`
- [ ] **Phase 7, already built:** should the dashboard guide be in Arabic? It's in English now, and I can translate it, but a native editor should check the result.
- [ ] **Phase 8, already built:** a short list of real Arabic searches your audience would type. Search has only been tested on Arabic I wrote myself, so this is what would show how well it really works.
- [ ] **Phase 8, already built:** once you have content, choose what Explore features. The dashboard guide says where each section comes from.

You can already start adding real articles, topics, and libraries in `/admin`, which would make these phases better tested. Everything entered in a local database stays on your computer until we deploy, so don't do a large amount of writing before the hosting decision below.

## Before public launch (Phase 9)

I can prepare the material, but these need you, and some need a person qualified to judge them.

### Legal and compliance

- [ ] **The feed currently breaks YouTube's rules, by your decision of 2026-11-05.** Set `FEED_IMMERSIVE_OVERLAY` to false in `src/config/feed.ts` before applying for the audit, or if YouTube contacts you. See [YOUTUBE_COMPLIANCE_AUDIT.md](YOUTUBE_COMPLIANCE_AUDIT.md).
- [ ] **Apply for the YouTube API Compliance Audit.** This is the project's largest risk, since whether a multi-channel feed is allowed is unresolved (R1). Launching before clearance risks losing API access. I'll prepare the submission material in Phase 9. Permission from channel owners would also help.
- [ ] **Who is responsible for the site:** a name or legal entity, and a country
- [ ] **A contact address** for privacy questions, which YouTube requires
- [ ] **Have the privacy policy and terms reviewed.** I'll draft them, but they need a qualified person, and I can't give you legal advice.
- [ ] **Copyright:** a rule for your volunteers, since articles may only hold full text you have the rights to

### Scholarly and language review

- [ ] **Quranic text:** have someone qualified check how it displays. It looked right to me, but that's only a visual check.
- [ ] **Arabic interface text:** have a native editor read it. I wrote all of it.
- [ ] **Article and category wording:** the content's accuracy is your team's responsibility, and the platform doesn't check it.

### Hosting and accounts

Tell me your choices, and I'll write the exact setup steps for them.

- [ ] **Hosting:** where the site runs. A normal server suits this project. On serverless hosting, the local file storage won't keep files, so you'd need the storage item below.
- [ ] **Domain name**
- [ ] **MongoDB Atlas**, or another MongoDB replica set: its connection string goes in `DATABASE_URL`
- [ ] **Image storage**, if your host doesn't keep files: any S3-compatible provider, such as Cloudflare R2 or AWS S3. Add a bucket with public read access, then set `STORAGE_PROVIDER=s3` and its details from `.env.example`.
- [ ] **A daily scheduled call** to `/api/cron/youtube-refresh`, with `CRON_SECRET` set. **Without this, videos leave the site after 30 days**, because YouTube requires it.
- [ ] **Production Google sign-in:** add the real domain's redirect URI, and publish the consent screen so anyone can sign in
- [ ] **Backups** of the database, which your database host can usually schedule

### Decisions that wait for the audit

- [ ] Whether to turn on YouTube statistics (R2). They stay off until the audit confirms they're allowed.
- [ ] Whether a non-blocking privacy notice satisfies YouTube's consent rule (R3)

## Connected services you don't need

No third-party service beyond those above is required. There are no payments, analytics, or AI services in this project.
