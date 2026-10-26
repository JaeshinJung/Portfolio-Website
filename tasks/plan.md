# Conversation-style portfolio implementation plan

Status: Stage 1 (Introduction vertical slice) implemented, awaiting browser verification, desktop/mobile screenshots and user approval. Stages 2-4 not started. Not committed.

Brand name: Jae (confirmed by user).

### Stage 1 notes
- public/index.html is now the workspace shell; public/workspace.css and public/workspace.js are new and standalone (style.css is not loaded by the workspace, so admin and the console page are unaffected).
- The previous DS console page is preserved unchanged (apart from title and noindex) as public/legacy.html. Projects, Experience and Skills link there until stages 2-3 replace them.
- Routes: #about (default) and #contact are rendered by the workspace. The legacy routes #projects, #experience and #skills forward to legacy.html#<route> with location.replace. Any other hash shows a not-found state.
- Intro data comes from siteContent/home (heroTitle, heroSubtitle, profileImageUrl, aboutMeText) and is read-only. Contacts are the existing Email, LinkedIn and GitHub links.
- Drawer below 900px: aria-expanded menu button, role=dialog/aria-modal only while open, focus trap, Escape/backdrop/close restore focus to the menu button, inert page behind it. Resources card sits on the right at 1280px and up and inline below the content otherwise.

## Direction
Replace the DS console presentation with a personal workspace inspired by the supplied Codex screenshot: grouped sidebar, readable conversation-style content, contextual resources. Personal branding rather than Codex branding. Name: Jae (confirmed), with "Jaeshin Jung's workspace" as the subtitle.

## Existing architecture
Static public/ HTML/CSS/JavaScript; package.json has no build tooling. index.html reads Firestore siteContent/home, projects, experiences and skills. admin.html/admin.js manage those records. Main pushes deploy public/ to Firebase Hosting live through GitHub Actions.

## Decisions
- Preserve Firebase Hosting, Firestore document IDs and existing admin compatibility. Inspect actual field usage before mapping content; do not invent achievements, metrics or links.
- Use vanilla ES modules and CSS; no framework or build migration required for this scope.
- Sidebar sections: Introduction (About, Skills, Contact), Projects (individual records), Experience (individual records). Resume only if a verified file/link exists.
- Desktop: approximately 260px sidebar, central reading column capped around 760px, optional 260px resources panel when space permits. Charcoal surfaces, restrained blue accent, readable sans-serif text.
- Mobile: menu drawer with focus restoration and Escape support; resources inline with the selected content. All navigation keyboard accessible.
- First version shows authored content immediately. Suggested question buttons navigate to or reveal existing content. No live AI, pretend input box, artificial typing delay or invented conversations.
- Project narrative: summary, role and timeframe when available, problem, implementation, outcome, screenshots and links. Missing fields are omitted gracefully.
- Stable hash routes using Firestore IDs, with reload/back/forward support and useful invalid-route state. Preserve or redirect existing routes after inspecting them.
- Explicit loading, empty and failure states; safe text rendering and validated external link protocols.

## Delivery sequence
1. Introduction vertical slice: workspace shell, sidebar, home data and contact links; responsive at 1440 and 390px.
2. Project vertical slice: existing project records in sidebar, individual routes, narrative and resource panel, existing media/demo links.
3. Experience and skills: map existing data to readable entries and finish legacy-link compatibility.
4. Release polish: keyboard/mobile checks, loading/error/empty states, link validation, admin smoke check, remove obsolete DS-only presentation after verifying shared styles are safe.

Each step: Claude implements only that slice -> review and browser verification -> show desktop/mobile screenshots -> user approves -> immediate scoped commit. Do not begin another implementation slice while the preceding slice is awaiting approval/commit. Development on a feature branch; approved commits can be pushed there for backup without changing live. Final main integration/push follows explicit release approval; verify Actions and then capture the actual live site.

## Roles
Claude Code performs implementation. Codex coordinates, reviews, tests and presents screenshots. Local claude.exe exists, but authentication/execution is not yet verified. If Claude cannot run, report the blocker rather than silently substituting a Codex coding agent.

## Risks and acceptance
- Shared style.css may affect admin/legacy pages: scope new styles and smoke-check admin.
- Firestore content may lack narrative fields: reuse existing fields and propose optional backward-compatible additions only when needed.
- Verify 1440px and 390px with no horizontal overflow, accessible menu operation, correct selected entry, readable media, and working links.
- No changes to Firebase security rules or production data are part of this redesign.

## Open choices
Exact accent color; optional future real-AI feature. Brand name settled: Jae. Defaults: muted blue, authored content only. Existing content language retained.
