# MASTER EXECUTION PROMPT — Islamic Short-Form Content & Knowledge Discovery Platform

## 0. YOUR ROLE AND MISSION

You are acting as a principal software architect, senior full-stack engineer, product engineer, database architect, UI/UX designer, and quality assurance engineer.

Your task is to design, build, test, and deliver a complete production-quality Arabic-first Islamic content discovery platform.

This is not a generic blog, not a generic video-sharing application, and not a simple YouTube Shorts aggregator.

It is a modern Islamic knowledge discovery platform combining:

1. A TikTok-inspired vertical short-video discovery experience.
2. A large interconnected Islamic knowledge network.
3. A modern article publishing and reading experience.
4. Curated playlists and long-form educational video collections.
5. Topic-centered discovery and exploration.
6. A comprehensive administration dashboard for managing content and volunteers.
7. A lightweight recommendation system based on user interests and content categories.
8. YouTube integration for video playback, metadata retrieval, channel imports, and optional engagement data.

The product must feel like a polished, premium, modern consumer application rather than a traditional religious website.

**Your responsibility is to implement the product described in this specification, not reinterpret it.**

Do not remove, simplify, replace, or invent major product requirements without a compelling technical necessity.

Do not silently substitute unavailable YouTube functionality with a fake implementation.

Do not create buttons or features that look functional but are not connected to real functionality.

Do not leave important features as TODOs or placeholders.

If a feature depends on an external API, implement its integration properly, handle unavailable data gracefully, and document the required configuration.

---

# 1. EXECUTION RULES — READ BEFORE CODING

These rules are mandatory.

## 1.1 Inspect Before Modifying

Before writing code:

- Inspect the entire existing repository.
- Identify the current framework and versions.
- Inspect package.json and existing dependencies.
- Inspect the existing folder structure.
- Inspect the current Prisma schema and MongoDB configuration, if present.
- Identify existing authentication, UI components, styling conventions, and utilities.
- Identify existing working functionality that must not be broken.
- Identify deployment assumptions and environment variables.

If this is an empty repository, initialize the project using the architecture specified below.

If this is an existing project, preserve compatible existing functionality and conventions. Do not unnecessarily rewrite working parts.

## 1.2 Specification Has Priority

The requirements in this document are the product source of truth.

When making implementation decisions:

1. Follow this specification.
2. Preserve existing compatible project decisions.
3. Choose the simplest maintainable implementation that satisfies the specification.
4. Do not introduce additional product features without authorization.

Do not change MongoDB to PostgreSQL.

Do not replace Prisma with another ORM.

Do not replace Next.js with another framework.

Do not introduce microservices.

Do not introduce unnecessary infrastructure, message brokers, or distributed systems.

## 1.3 Implementation Must Be Complete

Do not stop after creating:

- A project structure.
- A design system.
- A static prototype.
- A homepage.
- A database schema.
- An architecture document.

The objective is a complete functioning application.

Build the frontend, backend, database models, integrations, admin dashboard, authentication, and supporting workflows.

## 1.4 Work in Controlled Phases

Execute the project in the following order:

**Phase 1:** Repository audit, architecture, dependencies, database schema, foundational configuration.

**Phase 2:** Design system, application layout, navigation, responsive experience, and core UI components.

**Phase 3:** Authentication, user preferences, categories, topics, and recommendation foundations.

**Phase 4:** YouTube integration, vertical Shorts feed, playback behavior, and video metadata.

**Phase 5:** Articles, rich-text editor, knowledge relationships, libraries, and topic pages.

**Phase 6:** Playlists, long-form video experiences, and content collections.

**Phase 7:** Admin dashboard, RBAC, bulk channel importing, content management, and publishing workflows.

**Phase 8:** Search, exploration, user libraries, recommendations, and personalization.

**Phase 9:** Testing, accessibility, security, performance, SEO, responsive verification, and production readiness.

Do not begin a subsequent phase until the current phase has been implemented and its relevant validation has passed.

If a phase has an external dependency that cannot be configured because credentials are unavailable, implement the integration, its configuration interface, and its testable fallback behavior. Clearly document what requires credentials.

Do not ask for permission after every phase. Continue automatically unless a genuinely essential decision or missing credential prevents safe implementation.

Maintain a `PROJECT_STATUS.md` file containing:

- Completed phases.
- In-progress work.
- Remaining work.
- Known limitations.
- Required external credentials.
- Test results.
- Important architectural decisions.

Update it throughout implementation.

## 1.5 No Fake Functionality

Every visible control must have a real action.

Examples:

- Save must save content.
- Search must return actual results.
- Category filters must filter content.
- Playlist items must open and play their videos.
- Import buttons must perform real imports.
- Publish must change publication status.
- Authentication must work.
- Pagination must load additional results.

If an external capability is unavailable, disable or omit the relevant control and explain why rather than simulating success.

---

# 2. PRODUCT VISION

## 2.1 Target Audience

The primary audience is Arabic-speaking young people aged approximately 16–30.

They:

- Spend significant time consuming short-form content.
- Have a religious motivation and want to become closer to Allah.
- Want to learn about Islam in an accessible and engaging way.
- May be interested in Aqeedah, Fiqh, Seerah, Quran, Islamic history, apologetics, and responses to doubts.
- Often prefer accessible explanations rather than highly technical academic writing.

The product should meet users where they already are.

The central product idea is:

**Replace low-value short-form consumption with engaging, useful Islamic content, while creating natural opportunities to move from short videos into deeper knowledge.**

The experience should be highly engaging and familiar to people accustomed to TikTok-style interfaces.

Do not intentionally introduce deceptive engagement mechanics, fake notifications, artificial social proof, or manipulative interaction patterns.

The objective is to make beneficial knowledge easy and enjoyable to explore.

## 2.2 Language

Arabic only in the initial release.

Requirements:

- Arabic UI throughout.
- RTL layout throughout.
- Proper Arabic typography.
- Correct Arabic punctuation and text direction.
- Correct mixed Arabic/English text handling.
- Arabic-friendly search.
- Arabic metadata and SEO.
- Responsive layouts that preserve RTL behavior.

Do not build an unnecessary multilingual infrastructure in the MVP.

However, avoid architectural decisions that make future English or Turkish localization impossible.

## 2.3 Business Model

The platform is completely free.

There must be:

- No paid subscription system.
- No paywall.
- No payment processing.
- No advertising monetization.
- No mandatory paid account.

Do not introduce payment-related functionality.

---

# 3. TECHNOLOGY STACK — MANDATORY

Use:

- Next.js App Router.
- TypeScript.
- React.
- MongoDB.
- Prisma ORM.
- Tailwind CSS.
- shadcn/ui where appropriate.
- Auth.js / NextAuth-compatible Google authentication.
- Official YouTube IFrame Player API.
- YouTube Data API v3.
- Zod for input validation.
- React Hook Form where appropriate.

Use the latest stable compatible versions available in the existing environment, not arbitrary prerelease versions.

Before selecting or upgrading dependencies, verify compatibility with the current Next.js, React, Prisma, and MongoDB versions.

Do not install unnecessary packages.

## 3.1 Architecture

Use a modular monolithic architecture.

The application should be easy to maintain and extend without introducing microservices.

Organize code by functional domain rather than creating one enormous collection of unrelated files.

A reasonable structure:

```text
src/
  app/
    (public)/
    (auth)/
    (admin)/
    api/

  components/
    ui/
    layout/
    feed/
    video/
    articles/
    topics/
    playlists/
    libraries/
    search/
    shared/

  features/
    auth/
    users/
    preferences/
    categories/
    topics/
    shorts/
    youtube/
    articles/
    libraries/
    playlists/
    search/
    recommendations/
    admin/

  lib/
    auth/
    prisma/
    youtube/
    validations/
    permissions/
    utils/
    storage/
    seo/

  hooks/
  types/
  config/

prisma/
  schema.prisma

scripts/
  database/
  youtube/
  maintenance/

public/
  fonts/
  images/
```

Adapt the exact structure if the existing repository has a better established convention, but preserve the domain separation.

Use:

- Server Components by default.
- Client Components only when browser interactivity is required.
- Server Actions or API route handlers appropriately.
- Centralized validation.
- Centralized authorization.
- Reusable service functions.
- Consistent error handling.

Do not place database queries directly inside unrelated UI components.

Do not expose server-only credentials to the browser.

---

# 4. VISUAL IDENTITY AND DESIGN SYSTEM

The design is one of the most important aspects of this product.

The platform must feel premium, modern, elegant, and highly polished.

Its main visual inspiration is the usability and immersion of TikTok, combined with the reading experience of a premium editorial publication.

Do not make it look like:

- A traditional Islamic website.
- An old-fashioned religious portal.
- A generic Bootstrap dashboard.
- A cheap social media clone.
- A generic SaaS template.
- A decorative Arabic landing page filled with excessive ornaments.

## 4.1 Design Direction

Use:

- Dark-first visual design.
- Premium dark surfaces.
- Elegant Arabic typography.
- Clean spacing.
- Subtle borders.
- Carefully controlled shadows.
- Smooth transitions.
- High-quality iconography.
- Minimal unnecessary decoration.
- Strong visual hierarchy.
- Mobile-first design.

The video experience should be immersive and visually dominant.

Reading experiences should be comfortable and have sufficient contrast and line spacing.

## 4.2 Typography

Use an elegant Arabic typeface inspired by the typography used in the Qaf Islamic AI application.

Do not assume access to Qaf's proprietary font.

Choose a legally usable Arabic typeface with a comparable visual character.

Evaluate available fonts such as IBM Plex Sans Arabic, Alexandria, or another appropriate Arabic family.

Choose one primary font and use it consistently.

Ensure:

- Excellent Arabic readability.
- Proper weights.
- Comfortable line height.
- Attractive headings.
- Clear article body typography.

## 4.3 Color System

Use a sophisticated neutral dark palette.

Suggested starting tokens:

```css
--background: #090B10;
--surface: #11151D;
--surface-elevated: #191F2A;
--border: #252C38;
--text-primary: #F4F5F7;
--text-secondary: #A5ADBA;
--muted: #707A89;
--accent: #2BB3A3;
```

These are starting design tokens, not permission to use colors inconsistently.

Use one coherent accent color for meaningful interactive elements.

Avoid excessive gradients, neon effects, and colorful decoration.

The platform should feel sophisticated and calm.

## 4.4 Responsive Design

Design mobile-first.

The main audience will consume content on phones.

However, desktop and tablet experiences must also be excellent.

The vertical feed should preserve its immersive experience on desktop without unnecessarily stretching video content.

## 4.5 Design Quality Requirements

Every page must have:

- Loading states.
- Empty states.
- Error states.
- Responsive behavior.
- Hover and focus states.
- Accessible controls.
- Consistent spacing.
- Consistent typography.
- Appropriate animations.

Use skeleton loaders when useful.

Do not use emoji as substitutes for professional interface icons.

Use Lucide icons or the project's established icon library.

Avoid excessive component nesting and unnecessarily complex animations.

---

# 5. MAIN APPLICATION STRUCTURE

The application should be organized around five main user destinations:

1. Home / For You.
2. Explore.
3. Topics.
4. Library / Saved Content.
5. Search.

Navigation should be simple and mobile-friendly.

On mobile, use a clean bottom navigation where appropriate.

On desktop, use an appropriate sidebar or compact navigation layout.

Do not overcrowd the interface.

## 5.1 Home Feed

The Home Feed is the primary experience.

It should behave like a modern vertical short-video feed.

Core requirements:

- Full-screen or near-full-screen vertical video cards.
- Vertical scrolling between videos.
- Infinite loading through pagination.
- Automatic playback when a video becomes active.
- Pause inactive videos.
- Only one active video should play at a time.
- Preload the next video where practical.
- Avoid loading every video at once.
- Smooth transitions.
- Fast initial loading.
- Mobile touch gestures.
- Desktop keyboard support where appropriate.

Provide an intuitive way to switch between:

- For You.
- Following or selected topics, if implemented in the future.
- Category-specific feeds.

Do not make following creators a core requirement in the MVP.

The main feed should use user interests and category-based scoring.

## 5.2 Feed Video Information

Each video card should display available information:

- Video title.
- Channel name.
- Topic/category.
- Video description when appropriate.
- Related article CTA, if assigned.
- Related full video or playlist CTA, if assigned.
- Save action.
- Share action.
- YouTube attribution and required player elements.

Do not display fake engagement numbers.

Do not display internal platform likes or comments.

Only display YouTube engagement statistics when actually retrieved from the API and when their display is permitted.

If statistics are unavailable, omit them.

## 5.3 Feed CTA

Each Short can have an optional CTA.

Supported CTA types:

- Open an internal article.
- Open an external article/resource.
- Watch a full YouTube video.
- Open a curated platform playlist.
- Open a YouTube playlist.
- Open a related topic.
- No CTA.

The CTA must be configured by an administrator.

It should be contextual and visually integrated into the video experience without covering or modifying the protected YouTube player interface.

Do not force every video to have a CTA.

## 5.4 Feed Pagination

Implement scalable server-side pagination.

Use cursor-based pagination where practical.

Never fetch the entire Shorts database in one request.

Support:

- Duplicate prevention.
- Stable ordering.
- Efficient queries.
- Loading more videos near the end of the current list.
- Graceful error recovery.

---

# 6. YOUTUBE INTEGRATION — CRITICAL

YouTube is the only external video source in the initial release.

Do not implement other video providers in the MVP.

All YouTube videos must be played using official YouTube embedding mechanisms.

## 6.1 Official Player

Use the official YouTube IFrame Player API.

The platform should provide a custom surrounding application experience while preserving YouTube's required player interface and branding.

Important restrictions:

- Do not download YouTube videos.
- Do not rehost YouTube videos without appropriate authorization.
- Do not hide YouTube branding.
- Do not cover required player controls or overlays.
- Do not manipulate the player in ways prohibited by YouTube policies.
- Do not claim the platform hosts or streams the underlying video files.
- Do not use unofficial extraction tools.
- Do not circumvent advertisements or platform restrictions.

The experience should still feel like one cohesive application, even though playback is provided by YouTube.

## 6.2 Player Behavior

Implement:

- Play.
- Pause.
- Mute/unmute.
- Playback state detection.
- Video ended handling.
- Active video management.
- Player cleanup when changing videos.
- Error handling.
- Autoplay handling.
- Proper handling of browser autoplay restrictions.

Do not create multiple simultaneously playing players.

Do not recreate YouTube controls using fake controls.

The surrounding UI may provide additional navigation and contextual actions.

## 6.3 YouTube Metadata

Integrate YouTube Data API v3.

Retrieve available data such as:

- Video ID.
- Title.
- Description.
- Channel ID.
- Channel title.
- Thumbnail URLs.
- Published date.
- Duration.
- View count.
- Like count when available.
- Comment count when available.
- Tags when available.
- Playlist information where applicable.

Persist retrieved metadata in MongoDB.

Do not request API data on every feed render.

Use cached database data.

Provide a controlled metadata refresh mechanism.

## 6.4 Engagement Statistics

If the API exposes statistics and policies permit their display, show them.

If statistics are hidden or unavailable, do not fabricate them.

The application should gracefully work without engagement statistics.

## 6.5 YouTube Comments

Investigate and implement read-only comment retrieval through the official YouTube Data API when available and permitted.

Requirements:

- Comments must clearly be identified as YouTube comments.
- Support pagination where feasible.
- Handle disabled comments.
- Handle unavailable comments.
- Handle API errors.
- Respect quota limits.
- Do not implement fake internal comments.
- Do not pretend users can publish comments to YouTube without the required authorization and supported API workflow.

If comment retrieval cannot be supported for a particular video, hide the comment section or show an appropriate unavailable state.

Comments are optional, not a dependency of the core platform.

## 6.6 API Configuration

Use environment variables:

```env
YOUTUBE_API_KEY=
YOUTUBE_API_ENABLED=true
```

Do not hardcode API keys.

Implement an integration service that centralizes:

- API requests.
- Response validation.
- Quota-aware operations.
- Error handling.
- Data normalization.
- Caching.
- Retry policies where appropriate.

Do not blindly retry quota-exceeded errors.

---

# 7. BULK YOUTUBE CHANNEL IMPORTER

This is a high-priority administrative feature.

Administrators need to import large numbers of videos from existing YouTube channels.

Examples include channels belonging to Islamic speakers and educators.

The administrator must not need to manually add every Short.

## 7.1 Import Workflow

Create a dashboard tool called:

**YouTube Channel Importer**

Workflow:

1. Administrator enters a YouTube channel URL or handle.
2. Resolve the channel ID.
3. Retrieve the channel's uploads playlist.
4. Retrieve video IDs using paginated playlist requests.
5. Fetch metadata in batches.
6. Store or temporarily prepare the results.
7. Display an import preview.
8. Allow administrators to select videos.
9. Allow category and topic assignment.
10. Allow playlist assignment where applicable.
11. Import selected videos.
12. Report successes, duplicates, skipped videos, and failures.

## 7.2 Shorts Detection

YouTube Data API does not provide a universally reliable field identifying every Short.

Therefore:

- Do not claim that duration alone proves a video is a Short.
- Use video duration as an initial filter.
- Mark candidate Shorts for review.
- Allow administrators to include or exclude videos manually.
- Allow administrators to import long-form videos separately.
- Do not automatically publish uncertain candidates.

Provide filters for:

- Short candidates.
- Long-form candidates.
- Already imported.
- Not imported.
- Selected.
- Unselected.

## 7.3 Bulk Import Performance

Implement:

- Pagination.
- Batched API calls.
- Duplicate detection using YouTube video IDs.
- Progress indicators.
- Import cancellation where practical.
- Error reporting.
- Resume support where practical.
- API quota awareness.
- Database-safe bulk operations.

Do not make one API request per video when batch retrieval is available.

Do not use the YouTube search endpoint to enumerate all channel uploads when the uploads playlist approach is more appropriate.

## 7.4 Channel Synchronization

Prepare a Sync Channel feature.

It should discover newly uploaded content without importing existing videos again.

Use stored channel information and uploads playlist pagination.

Prevent duplicate records.

Allow administrators to review newly discovered content before publication.

Do not implement uncontrolled background polling.

If scheduling is introduced, make its cadence configurable and quota-aware.

## 7.5 Import Preview

The preview should show:

- Thumbnail.
- Title.
- Channel.
- Duration.
- Publication date.
- Existing import status.
- Candidate classification.
- Selection checkbox.

Allow bulk selection and category assignment.

---

# 8. USER ACCOUNTS AND AUTHENTICATION

Content must be publicly accessible without registration.

Authentication is optional.

Use Google authentication.

## 8.1 Guest Experience

A visitor can:

- Browse Shorts.
- Explore topics.
- Read articles.
- View playlists.
- Search public content.
- Watch embedded YouTube videos.

Do not require registration before viewing content.

Do not repeatedly interrupt guests with mandatory login dialogs.

## 8.2 Local Preferences

Allow guest users to select interests and save temporary preferences locally where appropriate.

Persist guest preferences in browser storage.

If a guest later signs in, migrate compatible local preferences to the authenticated account.

Do not lose user preferences during authentication.

## 8.3 Registered Users

Registered users can:

- Save Shorts.
- Save articles.
- Save playlists.
- Save topics.
- Synchronize preferences across devices.
- Maintain their interests.
- Access their saved content.
- Resume supported viewing progress.

Use secure authentication and session handling.

## 8.4 Google Authentication

Implement Google OAuth through Auth.js / NextAuth-compatible architecture.

Environment variables:

```env
AUTH_SECRET=
AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=
```

Do not expose secrets.

Handle account creation and session management securely.

---

# 9. USER INTERESTS AND RECOMMENDATION SYSTEM

The recommendation system must be intentionally simple.

Do not build an AI recommendation engine.

Do not introduce machine learning infrastructure.

The system uses category-based scoring.

## 9.1 Initial Onboarding

On the first visit, optionally show an attractive interest-selection experience.

Possible interests:

- Aqeedah.
- Fiqh.
- Quran and Quran sciences.
- Seerah.
- Islamic history.
- Tazkiyah.
- Islamic apologetics.
- Atheism and intellectual doubts.
- Comparative religion.
- Prophethood.
- Islamic manners.
- Contemporary Islamic questions.

Users can select multiple interests.

Allow them to skip onboarding and start browsing.

Do not block access to the application.

## 9.2 Recommendation Signals

Use lightweight signals:

- Selected interests.
- Video category.
- Video completion where reliably available.
- Early skipping.
- Saves.
- Repeated engagement with a category.
- Explicit interest changes.

Do not assume that a single long watch means strong interest.

Do not infer a user's religious beliefs or personal identity from their browsing.

## 9.3 Category Scoring

Implement a transparent, configurable scoring system.

Example concept:

```text
Category score =
  initial user interest weight
  + positive engagement signals
  - negative engagement signals
  + exploration adjustment
```

Use the score to adjust the distribution of videos in the For You feed.

The algorithm should:

- Prioritize selected categories.
- Gradually learn from behavior.
- Introduce new categories.
- Avoid showing only one topic.
- Avoid excessive repetition.
- Respect manual user preferences.
- Allow users to reset or edit interests.

Do not build a black-box recommendation engine.

## 9.4 Exploration Ratio

Reserve a configurable percentage of feed recommendations for exploration.

For example:

- Most content comes from known interests.
- A smaller portion introduces other categories.

The exact ratio must be configurable rather than hardcoded.

The Explore section must remain broader than the personalized For You feed.

---

# 10. CONTENT TAXONOMY

The platform must support a flexible Islamic content taxonomy.

Initial category examples:

- Aqeedah.
- Fiqh.
- Quran and Quran Sciences.
- Seerah.
- Islamic History.
- Tazkiyah.
- Islamic Apologetics.
- Atheism and Intellectual Doubts.
- Comparative Religion.
- Prophethood.
- Contemporary Issues.
- Islamic Manners.

These are examples and should be manageable through the admin dashboard.

Do not hardcode categories throughout the application.

Categories should be stored in the database.

Support:

- Category title.
- Arabic slug.
- Description.
- Icon.
- Cover image.
- Display order.
- Active/inactive status.
- Optional parent category.

Support hierarchical categories where appropriate.

Do not overcomplicate the hierarchy.

---

# 11. TOPIC-CENTERED KNOWLEDGE NETWORK

This is one of the most important architectural requirements.

The platform is a knowledge network, not a collection of isolated pages.

Topics are central to discovery.

Examples:

- نقد الإلحاد.
- مشكلة الشر.
- أدلة وجود الله.
- أدلة النبوة.
- إعجاز القرآن.
- حفظ القرآن.
- الصلاة.
- الطهارة.
- السيرة النبوية.
- تزكية النفس.

## 11.1 Topic Pages

Each topic must have its own page.

A topic page can contain:

- Title.
- Arabic slug.
- Introduction.
- Description.
- Cover image.
- Related Shorts.
- Related articles.
- Related playlists.
- Related long-form YouTube videos.
- Child topics.
- Related topics.
- Related libraries.

Organize content into meaningful sections.

Do not force every topic to contain every content type.

Hide empty sections.

## 11.2 Topic Relationships

Support relationships between topics.

Examples:

- Parent topic.
- Child topic.
- Related topic.
- Complementary topic.

Do not build an unnecessarily complex ontology.

The admin must be able to create and manage topic relationships.

## 11.3 Topic Discovery

The Explore page should help users discover topics they did not explicitly search for.

Include:

- Featured topics.
- Categories.
- Popular knowledge collections where actual usage data supports them.
- Curated topic collections.
- New or recently updated topics.
- Topic recommendations.

Do not fabricate popularity metrics.

---

# 12. ARTICLES AND EDITORIAL SYSTEM

Articles are the second major content type.

The desired experience is a modern, beautifully formatted Islamic editorial and knowledge publication.

Articles should be accessible to young readers.

Avoid unnecessary academic complexity in the interface.

## 12.1 Article Content

Support:

- Arabic title.
- Slug.
- Excerpt.
- Cover image.
- Rich body content.
- Headings.
- Paragraphs.
- Bold and italic formatting.
- Ordered and unordered lists.
- Blockquotes.
- Images.
- Image captions.
- External links.
- Internal links.
- Embedded references.
- Optional footnotes.
- Author/contributor information.
- Sources and references.
- Publication date.
- Last updated date.
- Reading time.
- SEO metadata.

Do not force unnecessary charts, diagrams, or complex visualizations.

The editorial design should prioritize excellent text formatting and images.

## 12.2 Rich Text Editor

Implement a proper editor suitable for publishing many articles.

Prefer a mature, maintainable editor such as Tiptap if compatible with the existing stack.

Requirements:

- Rich-text editing.
- Arabic RTL support.
- Heading levels.
- Lists.
- Images.
- Links.
- Quotes.
- Basic formatting.
- Preview mode.
- Draft saving.
- Publishing.

The editor must be comfortable for nontechnical volunteers.

Do not store arbitrary unsanitized HTML.

Use a controlled content format and sanitize rendered output.

## 12.3 Article Publishing Workflow

Keep the workflow simple.

Required statuses:

- DRAFT.
- PUBLISHED.

An authorized contributor can create and edit drafts.

An authorized publisher can publish content.

Do not implement an unnecessarily complex multi-stage approval workflow.

Do not add artificial editorial states that are not required.

## 12.4 External Articles

Support external article records.

An external article can have:

- Title.
- Description.
- Source name.
- External URL.
- Cover image.
- Associated topics.
- Associated libraries.

The platform should clearly indicate when a resource is external.

Do not copy copyrighted external articles automatically.

Only store full article content when the administrator has appropriate rights or authorization.

## 12.5 Article Reading Experience

Build a premium reading interface.

Requirements:

- Excellent Arabic typography.
- Comfortable line length.
- Proper heading hierarchy.
- Reading progress indicator if appropriate.
- Automatic table of contents generated from headings.
- Internal article links.
- Related topics.
- Related Shorts.
- Related playlists.
- References and sources.
- Last updated date.
- Share action.
- Save action for registered users.

The table of contents should work correctly with Arabic RTL.

## 12.6 Article-to-Video Relationships

An article can have multiple related Shorts.

A Short can link to multiple articles.

On an article page, show a section containing related Shorts in a horizontal carousel or another appropriate compact layout.

Users should be able to open a related Short without losing their overall navigation context where practical.

Do not create a separate isolated video system for articles.

Reuse the existing video infrastructure.

---

# 13. KNOWLEDGE RELATIONSHIPS AND CONTENT GRAPH

This is a foundational requirement, but it must remain easy for editors.

Do not require manual relationship creation for every article.

## 13.1 Many-to-Many Relationships

Support:

- Articles ↔ Topics.
- Articles ↔ Libraries.
- Articles ↔ Shorts.
- Articles ↔ Playlists.
- Shorts ↔ Topics.
- Shorts ↔ Libraries.
- Shorts ↔ Articles.
- Playlists ↔ Topics.
- Playlists ↔ Libraries.
- Topics ↔ Topics.
- Libraries ↔ Libraries.

A content item can belong to multiple topics and libraries.

## 13.2 Explicit Relationships

Provide an optional simple relationship system.

Examples:

- Related article.
- Complementary topic.
- Further reading.
- Response to an objection.
- Prerequisite.
- Related resource.

Do not force contributors to fill these relationships.

## 13.3 Easy Editor Workflow

When creating an article, the editor should be able to:

1. Select one or more topics.
2. Select one or more libraries.
3. Search and attach related articles.
4. Search and attach related Shorts.
5. Attach playlists.
6. Add external references.

All these fields should be optional.

Provide searchable selection components.

Do not require manual database editing.

## 13.4 Automatic Relationship Suggestions

Keep the architecture ready for future AI-assisted relationship suggestions.

Do not build an AI content-generation dependency in the MVP.

Do not automatically create or publish unverified relationships.

---

# 14. LIBRARIES

Libraries are independent knowledge collections.

Examples:

- مكتبة نقد الإلحاد.
- مكتبة إعجاز القرآن.
- مكتبة أدلة النبوة.
- مكتبة فقه العبادات.

A library is not merely a category or a list of articles.

It should support:

- Name.
- Slug.
- Description.
- Introduction.
- Cover image.
- Featured status.
- Display order.
- Child libraries.
- Related libraries.
- Associated articles.
- Associated Shorts.
- Associated playlists.
- Associated topics.

One article can belong to several libraries.

The same content should not be duplicated when it belongs to multiple libraries.

Build a clean library landing page with:

- Editorial introduction.
- Featured content.
- Articles.
- Videos.
- Playlists.
- Related topics.
- Sub-libraries.

---

# 15. PLAYLISTS AND LONG-FORM CONTENT

Playlists are a third major content type.

They are particularly important because they provide a bridge from short-form discovery to deeper learning.

Support two types.

## 15.1 YouTube Playlists

These are existing YouTube playlists.

Store:

- YouTube playlist ID.
- Title.
- Description.
- Channel information.
- Thumbnail.
- Associated topics.
- Associated libraries.
- Metadata synchronization status.

Play them using official YouTube mechanisms.

## 15.2 Curated Platform Playlists

These are playlists created by administrators.

They can combine videos from different YouTube channels.

Examples:

- مدخل إلى نقد الإلحاد.
- سلسلة أدلة وجود الله.
- رحلة التعرف على السيرة النبوية.
- فقه الصلاة من البداية.

Support:

- Playlist title.
- Description.
- Cover.
- Topic assignments.
- Library assignments.
- Ordered playlist items.
- Long-form videos.
- Shorts where appropriate.
- Optional article references.

Administrators must be able to reorder items easily.

## 15.3 Playlist Experience

Build a premium playlist detail page with:

- Playlist introduction.
- Ordered content.
- Progress indicators for signed-in users where reliable.
- Resume functionality where technically supported.
- Clear YouTube attribution.
- Related topics.
- Related articles.
- Related playlists.

Do not force users to follow a rigid learning path.

Users should remain free to explore content in any order.

---

# 16. EXPLORE EXPERIENCE

Explore is a core destination, not an afterthought.

Its purpose is to introduce users to new Islamic topics and help them discover the wider knowledge network.

Do not turn Explore into another personalized For You feed.

It should be broader and more editorially organized.

Include:

- Categories.
- Featured topics.
- Topic collections.
- Knowledge libraries.
- Featured playlists.
- Selected articles.
- New content.
- Curated collections.

Use meaningful visual groupings.

Avoid a cluttered page with endless unrelated cards.

Explore should communicate the breadth of the platform.

---

# 17. SEARCH

Implement useful search across:

- Shorts.
- Articles.
- Topics.
- Libraries.
- Playlists.
- Long-form videos.

Use available metadata:

- Titles.
- Descriptions.
- Tags.
- Topic names.
- Category names.

Implement an efficient search architecture compatible with MongoDB.

Use appropriate MongoDB indexes.

Consider Arabic search normalization, including common character variants and diacritics.

Avoid breaking meaningful Arabic distinctions.

Search results should be grouped or filterable by content type.

Include:

- Search suggestions where practical.
- Empty states.
- Loading states.
- Pagination.
- Search filters.

Do not introduce an external search engine in the MVP unless MongoDB cannot reasonably satisfy the actual requirements.

---

# 18. USER LIBRARY AND SAVED CONTENT

Create a user library for authenticated users.

Support:

- Saved Shorts.
- Saved articles.
- Saved topics.
- Saved playlists.
- Recently viewed content.
- Viewing progress where supported.

Use one coherent user-library experience.

Prevent duplicate saves.

Allow users to remove saved items.

Do not build internal likes or comments.

---

# 19. ADMIN DASHBOARD

The administration dashboard is a major part of this project.

The platform will be managed by multiple volunteers.

It must be practical, organized, and efficient for high-volume content management.

Create a professional admin interface separate from the public consumer interface.

## 19.1 Dashboard Overview

Display real database metrics:

- Total Shorts.
- Published Shorts.
- Draft Shorts.
- Total articles.
- Published articles.
- Draft articles.
- Topics.
- Libraries.
- Playlists.
- YouTube channels.
- Recent activity.

Do not use hardcoded statistics.

## 19.2 Main Sections

Create these administration sections:

1. Overview.
2. Shorts.
3. YouTube Channel Importer.
4. YouTube Channels.
5. Articles.
6. Topics.
7. Categories.
8. Libraries.
9. Playlists.
10. External Resources.
11. Users and Roles.
12. Audit Logs.
13. Settings.
14. YouTube Integration Status.

## 19.3 Content Management

Support:

- Create.
- Edit.
- Preview.
- Draft.
- Publish.
- Unpublish where authorized.
- Archive or deactivate where appropriate.
- Search.
- Filtering.
- Bulk selection.
- Bulk category assignment.
- Bulk topic assignment.
- Duplicate detection.

Do not introduce destructive actions without confirmation.

## 19.4 RBAC

Implement role-based access control.

Required roles:

**SUPER_ADMIN**
- Full access.
- Manage roles and permissions.
- Manage settings.
- Manage all content.

**ADMIN**
- Manage content and most administrative operations.
- Cannot remove or override the super administrator.

**EDITOR**
- Create and edit content.
- Manage topics and relationships as authorized.
- Cannot manage privileged account permissions.

**SCIENTIFIC_REVIEWER**
- Review content.
- Edit or provide feedback on content where permitted.
- Cannot manage system settings or privileged users.

**CONTRIBUTOR**
- Create and edit assigned drafts.
- Cannot publish unless explicitly granted permission.

Keep the publishing workflow simple: Draft → Published.

A scientific reviewer role should not create an unnecessary mandatory approval stage.

Permissions must be enforced server-side.

Hiding UI controls is not sufficient authorization.

## 19.5 User Management

Super administrators can:

- View users.
- Assign roles.
- Change permissions.
- Deactivate unauthorized accounts.
- Review relevant administrative activity.

Do not allow public self-registration as an administrator.

Use a secure initial bootstrap procedure to create the first super administrator.

Do not hardcode a privileged account in production.

## 19.6 Audit Logs

Record important administrative actions:

- Content creation.
- Content updates.
- Publishing.
- Unpublishing.
- Role changes.
- Channel imports.
- Bulk operations.
- Destructive actions.

Include actor, action, entity, timestamp, and relevant metadata.

---

# 20. DATABASE ARCHITECTURE — MONGODB + PRISMA

Use MongoDB with Prisma ORM.

Design the database carefully around the many-to-many relationships in this specification.

Do not use PostgreSQL-specific features.

Do not create an overly normalized SQL-style architecture that is inefficient or incompatible with Prisma MongoDB.

Use explicit join models for important many-to-many relationships.

Use MongoDB ObjectId fields and Prisma-compatible relation definitions.

Validate the complete schema against the installed Prisma version.

## 20.1 Required Domain Models

Design appropriate models for:

- User.
- Account.
- Session, if required by the selected authentication adapter.
- VerificationToken, if required.
- Role or role assignments.
- Category.
- Topic.
- TopicRelation.
- Short.
- YouTubeChannel.
- Article.
- Library.
- Playlist.
- PlaylistItem.
- ExternalResource.
- ContentRelation.
- UserPreference.
- UserInterest.
- Favorite.
- UserActivity.
- ViewingProgress.
- AuditLog.
- ApplicationSetting, where necessary.

You may add small supporting models when genuinely needed.

Do not create unnecessary models merely to imitate an SQL architecture.

## 20.2 Important Data Rules

Use unique constraints where supported.

Examples:

- User email.
- YouTube video ID.
- YouTube channel ID.
- YouTube playlist ID.
- Content slug within the appropriate content type.

Prevent duplicate imports.

Use appropriate indexes for:

- Published content.
- Category filtering.
- Topic filtering.
- Library filtering.
- Publication dates.
- YouTube IDs.
- User favorites.
- User activity.
- Search.

MongoDB-specific index management may require scripts or manual database setup depending on Prisma support.

Document and implement index creation.

## 20.3 Relationship Integrity

Ensure:

- One article can have multiple topics.
- One article can have multiple libraries.
- One Short can have multiple topics.
- One Short can have multiple articles.
- One playlist can contain multiple videos.
- One video can appear in multiple playlists.
- One topic can have multiple related topics.
- One library can contain multiple content types.

Avoid duplicate join records.

Prevent invalid self-relations where appropriate.

Use transactions where supported and appropriate for multi-step operations.

## 20.4 Data Lifecycle

Handle deleted or archived content safely.

Do not leave broken references.

Use soft deletion or archival where appropriate for important editorial content.

Do not automatically delete historical audit records.

---

# 21. SECURITY

Security must be implemented from the beginning.

Requirements:

- Validate all incoming data.
- Enforce authorization on the server.
- Protect administrative routes.
- Secure OAuth handling.
- Avoid exposing API secrets.
- Sanitize rich content.
- Validate external URLs.
- Prevent unsafe file uploads.
- Apply appropriate rate limiting to sensitive endpoints.
- Protect against common injection and XSS risks.
- Avoid leaking private user information.
- Handle errors without exposing stack traces to public users.
- Use secure cookie and session settings.
- Validate ownership before modifying user-specific resources.

Do not trust client-side role information.

Do not trust arbitrary URLs supplied for YouTube imports.

Validate YouTube URLs and resolve valid IDs through supported mechanisms.

---

# 22. MEDIA AND STORAGE

YouTube videos and their thumbnails should use official YouTube-provided resources where permitted.

For article images and uploaded cover images, implement a storage abstraction.

Do not assume a specific paid storage provider.

Requirements:

- Development-friendly local storage or an appropriate development adapter.
- Production-compatible configurable storage adapter.
- Server-side upload validation.
- File type restrictions.
- File size limits.
- Safe file naming.
- Image optimization where appropriate.

Keep the storage provider configurable through environment variables.

Do not use MongoDB as an unnecessary binary file storage system.

---

# 23. PERFORMANCE

The platform will potentially contain large numbers of Shorts and articles.

Performance is essential.

Implement:

- Database indexes.
- Efficient queries.
- Pagination.
- Metadata caching.
- Lazy loading.
- Image optimization.
- Appropriate caching.
- Minimal client-side JavaScript.
- Efficient player lifecycle management.
- Avoidance of unnecessary React re-renders.
- Proper loading states.

Do not instantiate every YouTube player in a long feed.

Only active or immediately necessary videos should initialize a player.

Use Intersection Observer or an appropriate equivalent for visibility management.

Avoid loading the entire feed or all article relationships on the client.

Measure and optimize actual bottlenecks rather than introducing unnecessary complexity.

---

# 24. SEO AND PUBLIC CONTENT

Public content should be indexable.

Implement:

- Metadata.
- Open Graph.
- Twitter metadata where appropriate.
- Canonical URLs.
- Dynamic page titles and descriptions.
- Sitemap.
- Robots configuration.
- Structured data when appropriate.
- Arabic slugs.
- Clean URLs.

Public pages should not require authentication.

Admin pages and private user pages must not be indexed.

Provide proper metadata for:

- Topics.
- Articles.
- Libraries.
- Playlists.
- Public video pages.

---

# 25. REQUIRED PUBLIC ROUTES

Use a clean route architecture.

Suggested routes:

```text
/
  Home / For You

/explore
  Explore

/search
  Search

/topics
/topics/[slug]
  Topic pages

/articles/[slug]
  Internal article pages

/resources/[slug]
  External resources

/libraries
/libraries/[slug]
  Knowledge libraries

/playlists
/playlists/[slug]
  Playlist pages

/shorts/[id]
  Shareable Short page

/saved
  User saved content

/history
  Recently viewed content

/interests
  Manage user interests

/auth/signin
  Google authentication

/admin
  Dashboard

/admin/shorts
/admin/youtube-importer
/admin/channels
/admin/articles
/admin/topics
/admin/categories
/admin/libraries
/admin/playlists
/admin/users
/admin/audit-logs
/admin/settings
```

You may refine routing where necessary, but preserve the functionality and clear separation between public and administrative areas.

---

# 26. ENVIRONMENT CONFIGURATION

Create a complete `.env.example`.

Include only variables actually used by the implementation.

Expected configuration may include:

```env
DATABASE_URL=

AUTH_SECRET=
AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=

YOUTUBE_API_KEY=
YOUTUBE_API_ENABLED=true

APP_URL=

STORAGE_PROVIDER=
STORAGE_BUCKET=
STORAGE_REGION=
STORAGE_ACCESS_KEY=
STORAGE_SECRET_KEY=
STORAGE_ENDPOINT=
```

Adapt authentication variable names to the selected compatible Auth.js version.

Do not commit real credentials.

Validate required configuration at startup.

Provide clear error messages when required configuration is missing.

---

# 27. TESTING REQUIREMENTS

Testing is mandatory.

Do not claim the project is complete merely because it compiles.

Implement appropriate tests for critical application behavior.

## 27.1 Unit Tests

Test:

- Category scoring.
- Preference updates.
- Recommendation ordering.
- YouTube ID extraction.
- Channel URL resolution.
- Duplicate detection.
- Import normalization.
- Permission checks.
- Article validation.
- Relationship validation.
- Search normalization.

## 27.2 Integration Tests

Test:

- Authentication-related behavior where practical.
- Database operations.
- Creating and publishing articles.
- Creating topics and relationships.
- Saving content.
- Playlist creation.
- YouTube import workflow with mocked external API responses.
- Unauthorized administrative operations.

## 27.3 End-to-End Tests

Where practical, test:

- Guest browsing.
- Selecting interests.
- Feed navigation.
- Article reading.
- Topic exploration.
- Playlist navigation.
- Google sign-in flow in an appropriate test setup.
- Admin access.
- Draft creation.
- Publishing.
- Bulk import preview.

Do not require live YouTube credentials for every automated test.

Mock external API calls in tests.

## 27.4 Quality Gates

Before declaring completion, run:

- TypeScript checks.
- ESLint.
- Unit tests.
- Integration tests.
- Production build.
- Prisma schema validation.
- Database-related validation where available.

Fix errors rather than ignoring them.

Report any tests that could not run and explain why.

---

# 28. IMPORTANT PRODUCT DECISIONS — DO NOT CHANGE

These decisions are final.

1. The platform is Arabic-first and Arabic-only in the first release.
2. The platform is completely free.
3. The primary audience is young Arabic-speaking users aged 16–30.
4. Guest browsing is allowed without registration.
5. Google authentication is optional.
6. User interests and saved content can synchronize through accounts.
7. YouTube is the only video provider in the MVP.
8. YouTube playback must use official supported embedding.
9. Do not download or illegally rehost YouTube videos.
10. Do not hide YouTube branding or required player elements.
11. The primary video experience is a TikTok-inspired vertical feed.
12. Infinite scrolling is an intentional product requirement.
13. Recommendations are category-based and lightweight.
14. Explore must encourage discovery beyond existing interests.
15. Topics are central to the content architecture.
16. Articles are important and should be interconnected with other content.
17. Libraries are independent knowledge collections.
18. Articles and videos can belong to multiple topics and libraries.
19. Playlists are a first-class content type.
20. Playlists can be imported from YouTube or curated internally.
21. Bulk channel import is a high-priority admin feature.
22. Short detection must be treated as a candidate classification, not a guaranteed YouTube API field.
23. Comments and engagement statistics are optional and dependent on API availability.
24. Do not create internal likes or comments in the MVP.
25. Do not make following creators a central feature.
26. Focus on topics and knowledge, not personalities.
27. Article publishing workflow is Draft → Published.
28. Multiple volunteers require role-based permissions.
29. The design must be premium, modern, dark-first, Arabic-friendly, and RTL.
30. The stack is Next.js + TypeScript + Prisma + MongoDB.
31. Do not replace the selected stack.
32. Do not introduce paid features or subscriptions.

---

# 29. FEATURES EXPLICITLY DEFERRED

Do not spend MVP development time implementing:

- AI recommendation engines.
- Automatic AI article generation.
- Automatic AI scientific approval.
- Complex learning paths.
- Exams and quizzes.
- Gamification.
- Badges and points.
- Creator follow systems as a core feature.
- Internal social networking.
- Internal direct messages.
- Internal comment systems.
- Paid subscriptions.
- Payment gateways.
- Mobile native applications.
- Additional video providers.
- Complex knowledge graph visualizations.
- Advanced AI semantic search.

Design the architecture so future additions remain possible without implementing them now.

---

# 30. FINAL ACCEPTANCE CRITERIA

The project is only considered complete when all of the following are true:

## Public Experience

- A visitor can access the platform without signing in.
- The homepage presents a functioning vertical video feed.
- Videos use the official YouTube player.
- Only the active video plays.
- Infinite loading works.
- Video CTAs work when configured.
- Topics can be explored.
- Articles can be read.
- Libraries work.
- Playlists work.
- Search returns real content.
- User preferences work.
- Saved content works for authenticated users.
- The design is responsive and RTL.

## Content Architecture

- Articles can belong to multiple topics.
- Articles can belong to multiple libraries.
- Shorts can belong to multiple topics.
- Shorts can link to multiple articles.
- Playlists can contain ordered videos.
- Topics can link to other topics.
- Libraries can contain multiple content types.
- Empty relationships are allowed.

## Administration

- Authorized administrators can manage content.
- Role permissions are enforced server-side.
- Draft and publishing workflows work.
- YouTube channel import works with valid API credentials.
- Duplicate videos are prevented.
- Bulk imports display meaningful progress and errors.
- Channel synchronization does not duplicate existing videos.
- Administrative activity is logged.

## Engineering

- Prisma schema validates.
- TypeScript checks pass.
- Lint passes.
- Tests pass.
- Production build succeeds.
- Secrets are not exposed.
- No critical placeholder functionality remains.
- No obvious security vulnerabilities remain unaddressed.
- Environment setup is documented.

---

# 31. DOCUMENTATION AND DELIVERY

Create and maintain:

```text
README.md
PROJECT_STATUS.md
docs/
  PRODUCT_SPECIFICATION.md
  ARCHITECTURE.md
  DATABASE_DESIGN.md
  YOUTUBE_INTEGRATION.md
  ADMIN_GUIDE.md
  ENVIRONMENT_SETUP.md
  DEPLOYMENT.md
```

Documentation must describe the implementation that actually exists.

Do not document imaginary features.

The README must explain:

- Prerequisites.
- Installation.
- Environment configuration.
- MongoDB setup.
- Prisma setup.
- Google OAuth setup.
- YouTube API setup.
- Development commands.
- Testing.
- Production build.
- Deployment considerations.

Provide a secure procedure for bootstrapping the first Super Admin.

---

# 32. FINAL EXECUTION INSTRUCTION

Begin by inspecting the repository.

Then establish the implementation plan and architecture.

After that, execute all phases sequentially.

Do not stop at a plan.

Do not replace implementation with explanations.

Do not skip critical functionality because it is inconvenient.

Do not silently make major architectural decisions that contradict this specification.

When something is technically impossible or prohibited by an external platform, explain the limitation, implement the closest compliant alternative, and document the difference.

Prioritize correctness, maintainability, security, and a polished user experience.

At the end, provide a final report containing:

1. What was implemented.
2. The actual application architecture.
3. The final database models.
4. The implemented public pages.
5. The implemented admin features.
6. YouTube integration capabilities.
7. Bulk import capabilities.
8. Authentication and authorization.
9. Tests executed and their results.
10. Remaining limitations.
11. Required environment variables.
12. Exact commands to run the application locally.
13. Any external setup still required.

**The objective is not to produce a convincing demo. The objective is to deliver a working, maintainable, production-oriented implementation of the specified Islamic knowledge discovery platform.**