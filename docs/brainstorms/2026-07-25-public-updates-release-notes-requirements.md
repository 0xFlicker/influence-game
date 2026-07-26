---
date: 2026-07-25
topic: public-updates-release-notes
---

# Public Updates / Release Notes Requirements

## Summary

Add a public **Updates** surface on the Influence web app: structured markdown posts living in the repo, rendered as an index and individual post pages, linked from the footer Learn section. Posts use a blog-like shape (title, date, summary, tags, free markdown body). A post is required when a ship changes player- or builder-visible product surfaces. Launch includes one real seed post.

---

## Problem Frame

Release knowledge today is written for internal handoffs (`DEVELOPMENT.md` release checklist posts notes in the PR, issue, or handoff) and never becomes a public page. Marketing routes (`/`, `/about`, `/rules`, `/privacy`, `/get-mcp`) are hardcoded TSX with no `/updates` (or blog/changelog) route; footer Learn only links Rules and About.

Friends and spectators cannot tell what changed in the game they watch. Agent builders cannot skim MCP, rules, or surface deltas without digging GitHub or Discord. Dual audience needs one public archive, not two rotting channels.

---

## Key Decisions

- **1 + 2 + 5 stack, not full ideation set.** Content shape + repo-native publishing + ship-tied cadence. Discovery beyond footer/hub, syndication, rules badges, and CMS are deferred.
- **Bloggy posts, not rigid multi-layer schema.** Frontmatter carries `title`, `date`, `summary`, and `tags`. Body is free markdown. Optional dual-audience writing guidance lives in the release checklist, not forced body sections.
- **One markdown file per post in the repo.** No CMS. No single rolling `CHANGELOG.md` as the public SSOT. Site builds the index from the post collection.
- **Equal dual audience.** Spectators/friends and agent builders are both first-class readers. Tags support both; no separate builder site or second blog.
- **Cadence = player- or builder-visible ships.** Pure refactors may skip a public post. “Visible” is human judgment on the release checklist, not an automated CI gate in v1.
- **Discovery = footer Learn + hub + post URLs.** No homepage chip, no contextual `/rules` or `/get-mcp` strips in v1.
- **Launch with one seed post.** Empty archive is not a successful launch; migrate a real recent note into the first public entry.

---

## Actors

- A1. **Returning friends / spectators** — want to know what is new in play, rules feel, and watch experience.
- A2. **Agent builders** — want scannable notes on MCP, OAuth/setup, agent surfaces, and rules contracts.
- A3. **Release authors** (typically the engineer shipping) — write the post in the same change set as the ship, using the existing release ritual.
- A4. **Site visitors** (cold) — may land on Updates via footer or a shared post URL.

---

## Key Flows

### F1. Publish an update with a player- or builder-visible ship

- **Trigger:** Author prepares a production-bound change that affects rules, watch UX, seasons, MCP/agent contracts, or other public product surfaces.
- **Actors:** A3
- **Steps:**
  1. Author writes or updates a markdown post (title, date, summary, tags, body) in the repo post collection.
  2. Author links or references the post from the release handoff / PR as the public notes artifact.
  3. Merge and deploy the web app as today; post appears on the Updates index and post page.
- **Outcome:** Public notes ship with the product change; no second CMS step.

### F2. Browse what is new

- **Trigger:** Visitor opens Updates from the footer Learn section (or a known URL).
- **Actors:** A1, A2, A4
- **Steps:**
  1. Index shows posts newest first with title, date, summary, and tags.
  2. Visitor opens a post for full body.
  3. Tags make dual-audience posts skimmable without a filter UI in v1.
- **Outcome:** Both audiences can answer “what shipped that matters to me?” from the public site.

### F3. Launch with a non-empty archive

- **Trigger:** First ship of the Updates surface.
- **Actors:** A3
- **Steps:**
  1. Migrate one real recent release note into a seed post.
  2. Ship the surface with that post present on the index.
- **Outcome:** Launch proves pipeline + content, not an empty shell.

---

## Requirements

**Surface and content model**

- R1. The web app exposes a public Updates index and individual post pages at stable, shareable URLs under an Updates route (e.g. `/updates`).
- R2. Each post is one structured markdown file in the repository with frontmatter for at least `title`, `date`, `summary`, and `tags`, plus a free markdown body.
- R3. The index lists posts newest first and shows title, date, summary, and tags for each entry.
- R4. Post pages render the full body as readable public content (not admin/docs chrome).
- R5. Tags are first-class for dual audience (spectators and builders). v1 may use a recommended tag set without requiring a hard-coded enum or filter UI.

**Discovery**

- R6. Footer Learn includes an Updates link peer to existing Learn destinations (Rules, About).
- R7. v1 does not require homepage “latest ship” chrome or contextual strips on `/rules` or `/get-mcp`.

**Authoring and cadence**

- R8. A public Updates post is **required** when a ship changes player-visible or builder-visible product surfaces (including rules feel, watch UX, seasons, MCP/agent contracts, and comparable public surfaces). Pure internal refactors may omit a post.
- R9. The release process documents Updates as the public notes artifact for those ships (alongside existing PR/issue/handoff practice), so notes are not only internal.
- R10. Authors write posts in the same change set as the product change; publishing is deploy of the web app, not a separate CMS publish step.
- R11. Launch of the surface includes at least one seed post migrated from a real recent release note.

**Quality and safety**

- R12. Public posts must not document producer-only / private diagnostic surfaces as if they were player- or builder-facing product APIs.
- R13. Posts must not be raw git logs or unedited PR title dumps; human-curated title, summary, and body are required.

---

## Acceptance Examples

- AE1. **Covers R1, R3, R6.** Given the web app is deployed with at least one post, when a visitor uses the footer Learn → Updates link, then they see a newest-first index with title, date, summary, and tags, and can open a post URL.
- AE2. **Covers R2, R10.** Given an author adds a valid post file and ships a web deploy, when the deploy completes, then the post appears on the index without a CMS step.
- AE3. **Covers R8, R9.** Given a production-bound ship that changes public rules or MCP setup, when the release checklist is followed, then a public Updates post exists for that ship; a pure refactor ship may omit one.
- AE4. **Covers R5, dual audience.** Given a post tagged for both watch and build concerns, when a spectator and a builder each scan the index and open the post, then summary/tags/body are useful without a second site.
- AE5. **Covers R11.** Given first launch of Updates, when the surface ships, then the index is not empty — at least one real seed post is present.
- AE6. **Covers R12, R13.** Given a release handoff that mixes public changes and producer-only diagnostics, when the public post is written, then only public-safe content is published and the body is curated prose, not a commit list.

---

## Success Criteria

- Returning friends can find “what’s new” from the site footer without GitHub or Discord.
- Agent builders can scan tags and posts for surface/MCP/rules changes on the same archive.
- Authors can publish by adding a markdown post in the repo as part of a normal ship PR.
- At least one real seed post exists at launch.
- Release checklist treats public Updates as the notes destination for player/builder-visible ships.

---

## Scope Boundaries

**In scope (v1)**

- Updates index + post pages
- Repo-native structured markdown posts
- Footer Learn link
- Ship-tied authoring expectation + release checklist update
- One seed post at launch
- Dual-audience tags and bloggy frontmatter shape

**Deferred for later**

- Homepage latest-ship chip
- Contextual “updated” strips on `/rules`, `/get-mcp`, dashboard, or watch shell
- Tag filter UI on the index
- Discord / social auto-syndication
- Machine-readable feed (`updates.json` / RSS)
- Forced dual body sections or three-layer schema
- CMS or external changelog product
- Automated CI gate that fails builds without a post
- Season-boundary special content type beyond ordinary posts

**Outside this feature’s identity**

- Replacing Discord community discussion
- Full marketing CMS for arbitrary pages
- Producer private release archaeology on the public site

---

## Dependencies / Assumptions

- Marketing shell and footer Learn pattern remain the public nav surface for static content peers (About, Rules).
- Authors can edit markdown in PRs as part of normal engineering workflow.
- “Player- or builder-visible” remains a human release judgment in v1.
- Exact content directory layout, MD rendering library, and route file structure are planning decisions.

---

## Outstanding Questions

**Deferred to Planning**

- Exact route slug (`/updates` vs alternatives) and post URL shape (date+slug vs slug only).
- Content directory path under the monorepo and how the web package collects posts at build time.
- Recommended tag vocabulary and whether tags are free-form strings with docs guidance or a soft enum.
- How the seed post is chosen (which recent ship) and who drafts it in the implementing PR.
- Whether post dates are timezone-normalized and how draft/unpublished posts are avoided (e.g. only committed posts on the deploy branch).
- Visual alignment with existing marketing pages (About/Rules) without inventing a new brand system.

**Resolve Before Planning**

- None.

---

## Sources / Research

- Ideation survivors (1 structured updates unit, 2 repo-native pipeline, 5 ship-tied cadence) refined toward bloggy frontmatter + markdown-in-repo.
- `DEVELOPMENT.md` — release notes currently PR/issue/handoff only.
- `packages/web` marketing routes — About, Rules, privacy, get-mcp; no blog/changelog.
- `packages/web/src/components/site-footer.tsx` — Learn section links.
- External patterns considered: Linear/Notion changelogs, Keep a Changelog, game season patches — used for framing only; v1 is bloggy repo posts, not full multi-layer product.
