# Start here landing — review

Status: implementation and browser verification completed. User approved commit and production deployment.

## Files changed

- `public/index.html` — new `#view-start` section (default visible), About
  now `hidden` by default, sidebar "Start here" link at the top of the nav,
  logo → `#start`, header default `Jae / Start here`, Resources `aside`
  hidden by default (`id="ws-resources"`), `ws-content-start` default class,
  asset tokens → `release=start-here-20261025`.
- `public/workspace.js` — `start` route (also the default for no hash),
  Resources hidden + centred column toggled per route, `FEATURED` list
  rendered from the already-loaded `COLLECTIONS` (no extra Firestore reads),
  same-route sidebar clicks (logo / Start here while on `#start`) close the
  drawer and refocus the heading.
- `public/workspace.css` — Start here styles, single centred 680px column on
  `ws-content-start` (including ≥1280px), stacked cards on mobile.

Not touched: data/admin files, `firebase.json` (Skills cache fix), old task
plans, untracked drafts.

## Featured sessions

| Firestore ID | Collection | Shows |
| --- | --- | --- |
| `N5XsxkmBcUgzKAruBTs0` | experiences | role · company (ENDEAVR Institute) |
| `XC4y3cgOpijSISQnMKtx` | experiences | role · company (Hanwha Life Insurance) |
| `9RhW01tkfsbhOF5ZVuF8` | projects | title · "Project" (IEEE Tech Website) |

- Loading: one "Loading…" line (no links).
- Error: "Couldn't load experience/projects." + Try again (per collection).
- Record missing: omitted (no dead link). Section hidden if nothing remains.
- All text via `textContent`; hrefs built with `hrefFor()`.

## Browser verification completed

- [x] 1440px, no hash: Start here, no Resources card, centred column.
- [x] 1440px, `#about`, `#skills`, `#contact`, a record: Resources card back.
- [x] 390px: cards stacked one per row; featured list below.
- [x] 390px drawer: opens on "Start here" link; logo / Start here while on
      `#start` closes drawer and focuses "What would you like to explore?".
- [x] Featured links open the right records; offline → error line + retry.
- [x] `#projects` / `#experience` prompt cards still redirect to first record.

## Verification result

Codex verified local Chrome at 1440x1000 and 390x844 with real Firestore data: no-hash landing, four prompt routes, three featured links, resource panel visibility, back/reload and mobile drawer passed. Mock empty/error/retry states, same-route focus, no duplicate collection reads and direct Skills reload regression also passed. No page errors or horizontal overflow. node --check public/workspace.js and git diff --check passed.

Screenshots: _review-screenshots/jae-start-1440.png and jae-start-390.png. User visual approval received; release authorized.
