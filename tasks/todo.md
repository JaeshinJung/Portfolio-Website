# Portfolio redesign checklist

- [x] Jae name and workspace design approved.
- [x] Claude Code authentication and feature branch codex/jae-workspace established.
- [x] Step 1: Introduction shell implemented, browser-verified, approved and committed b2d4df6.
- [x] Step 2 implementation: direct project and experience sessions, no intermediary All projects / All experience page. Authored by Claude Code.
- [x] Step 2 verification and 1440/390 screenshots; see stage2-review.md.
- [x] Step 2 user visual approval received, including all sidebar icons; saved in this commit.
- [ ] Remaining stage 3: Skills migration and legacy-link compatibility, screenshots -> approval -> commit.
  - [x] Implementation (Claude Code): #skills view from the skills collection; all Classic console links and the classic tag removed; legacy.html is now a location.replace redirect to the matching workspace hash (default #about).
  - [ ] Browser verification and 1440/390 screenshots; user approval.
- [ ] Stage 4: release polish, full external demo/admin smoke coverage as appropriate, screenshots -> approval -> commit.
- [ ] Release approval; integrate into main and push; verify Actions and live 1440/390 screenshots.

Do not begin another implementation stage before current stage approval and commit. No production deployment has been performed.
