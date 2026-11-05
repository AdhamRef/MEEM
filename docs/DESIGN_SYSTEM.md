# Design system

Dark-first, Arabic, right-to-left, and mobile-first. In development, `/design-system` shows every token and component. That page returns 404 in production.

## Colours

Tokens are defined in [src/app/globals.css](../src/app/globals.css). Never write a hex value in a component.

| Tailwind class | Token | Use |
|---|---|---|
| `bg-background` | `--background` | Page |
| `bg-surface` | `--surface` | Panels and cards |
| `bg-surface-elevated` | `--surface-elevated` | Raised surfaces and hover |
| `border-border` | `--border` | Borders |
| `text-text-primary` | `--text-primary` | Main text |
| `text-text-secondary` | `--text-secondary` | Supporting text |
| `text-subtle` | `--muted` | Least important text |
| `bg-brand`, `text-brand`, `bg-primary` | `--accent` | The one accent, only for meaningful interactive elements |

**Change from the specification's starting palette:** `--muted` is `#8791A1` rather than `#707A89`, because the original has a contrast of about 4.2:1 on `--surface`, below the 4.5:1 AA minimum. A test checks every text colour on every surface.

**Name to watch:** in Tailwind, `bg-muted` and `bg-accent` are shadcn's neutral hover surfaces, as shadcn components expect. For the brand colour use `brand` or `primary`.

## Typography

One font: **IBM Plex Sans Arabic**, under the SIL Open Font License, in weights 300 to 700. `next/font` downloads it at build time and serves it from this site, so the build needs internet access and visitors never contact Google.

| Rule | Reason |
|---|---|
| Keep letter spacing at 0 | Spacing breaks the joins between Arabic letters |
| Body line height 1.7, articles 2 | Arabic marks need vertical room |
| Wrap article content in `.prose-article` | Headings, lists, quotes, captions, and links are styled for reading |
| Use `.text-quran` for Quranic text | Larger, with more line height so marks don't collide |

Plex is a general text font, not a Quranic typeface. Its rendering of the Al-Fatiha sample looked correct, but **someone qualified should review Quranic text before launch**. If it isn't accepted, Quranic quotations could use a dedicated font while everything else keeps Plex.

## Right-to-left rules

- **Use logical classes only:** `ms-`, `me-`, `ps-`, `pe-`, `start-`, `end-`, `border-s`, `border-e`, `text-start`, `text-end`. ESLint rejects physical classes such as `ml-2` or `text-left` in `src/**/*.tsx`, and a test rejects physical properties in `globals.css`.
- **Directional icons**, such as arrows and chevrons, need `rtl:rotate-180`. Icons with no direction don't.
- **Mixed text:** wrap Latin names, numbers, and URLs inside Arabic sentences in `<bdi>`. Use `dir="auto"` only for whole strings that may be in either language, such as YouTube titles.
- **Portals:** pass `dir="rtl"` to shadcn popovers and tooltips, as shadcn's RTL docs require.

## Navigation

Destinations are listed in [src/config/navigation.ts](../src/config/navigation.ts). Phones get a bottom bar, and 768px and wider get a compact rail on the start side. The account menu sits in a slim top bar on phones and at the bottom of the rail otherwise.

A destination's page must exist before it is enabled. Until then, `isAvailable: false` renders it dimmed, with no link. **Each phase that ships a destination must set this to `true`.**

## States and components

| Need | Use |
|---|---|
| Empty, not-found | `StateMessage`. Only pass an action that really works. |
| Errors | `ErrorMessage`. It never shows error details. |
| Loading | `PageLoading`, or a skeleton matching the final layout |
| Interface text | `src/config/strings.ar.ts`, never inline |

Interactive elements meet a 44px touch target: the default and `icon` button sizes, and inputs. The `sm` button size is 36px, so use it only where a larger target isn't possible.

## Adding shadcn components

`components.json` uses the `radix-nova` style with `rtl: true`, so the CLI generates logical classes. **After every `shadcn add`, check two things it does:**

1. It adds an npm package named `cn` to `package.json`, unpinned. Run `npm uninstall cn`.
2. Its components import `cn` from that package. Change the import to `@/lib/utils`.

Also raise any default control height to the touch target, since shadcn's defaults are 32px. If a component uses `data-[side=left]:slide-in-from-right-2`-style animations, remove them: the lint rule rejects these physical classes, and the components work without them.

Use dropdown menus with `modal={false}` unless blocking the page is intended, because modal mode hides the page from assistive technology.
