# Stage 2 verification — direct project and experience sessions

Implementation: Claude Code. Stage 1 saved at b2d4df6. Stage 2 and all sidebar icons approved by user for this commit; no push/deployment.

## Passed
- Actual Firestore data: all 7 projects and 2 experiences directly listed in sidebar.
- All 9 links: expected headings, selected aria-current link and desktop no horizontal overflow.
- Deep-link reload, back/forward, bare #projects selects first record, unknown project ID recovery page.
- 390px project/experience and drawer: no horizontal overflow, selection closes menu, Escape restores opener focus.
- Browser pageerror events: none during real-data screenshot pass.
- Simulated read-only fixtures: empty collections, failed request then successful retry, literal HTML-like titles, blocked javascript/data links and private repository note.
- node --check public/workspace.js; git diff --check.

## Artifacts
- _review-screenshots/jae-sessions-project-1440.png
- _review-screenshots/jae-sessions-experience-1440.png
- _review-screenshots/jae-sessions-menu-390.png
- _review-screenshots/jae-sessions-project-390.png
- _review-screenshots/jae-sessions-experience-390.png

## Scope limits
Local preview only. External game runtime and every outbound destination not exercised. No production data writes. Skills remains on the preserved legacy page.

## Sidebar icons follow-up
Claude added folder, briefcase, person, code and envelope icons. All icons verified in Chrome at 1440/390; mobile overflow absent and Escape focus restoration passed. Final screenshots: jae-all-icons-1440.png and jae-all-icons-390.png in _review-screenshots/.
