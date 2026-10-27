# Stolen Moments — prelaunch audit, 27 October 2026

This review covers the current local `static/` build and the checked-in WJazzD v2.1 catalog. The working tree also contains uncommitted interface changes, including `method.html`; this is a review of what is on disk, not a claim that the public GitHub Pages site has these changes. I checked the catalog validator and JavaScript syntax, inspected the deployment workflow and core matching and presentation code, and opened the local site at desktop and 390 px mobile widths. I did not run a full screen-reader study or a throttled mobile performance benchmark.

**Implementation update (27 October 2026):** Findings 1–2, 5–6, 8–9, and 12 now have local fixes in the release candidate: closed-state controls stay hidden, pair URLs reopen their match, muted text uses darker contrast-safe values, method/app changes are present together, the landing explains synthesized playback and offers a direct featured pair, and the deployment workflow exercises the browser. The browser smoke checks 320/390/768/1280 px reflow and axe on the landing, pair dialog, and method page. Axe exposed non-focusable score scrollers; they now have keyboard focus and accessible region labels. Catalog decompression, JSON parsing, and full-index ownership now stay in the worker; the UI receives 50 visible items and a total count. A localhost timing pass measured roughly 82 ms decompression, 85 ms parsing, 42 ms first filter, and 44 ms first render. Desktop loopback measurements are not a mobile-device/network benchmark. A project-authored social card and campaign asset register are prepared, but third-party covers, portraits, and recordings have not been cleared for advertising. Item 3 (Echoes interpretation) and item 4 (listener review) remain open by design in this implementation pass. Automated checks pass locally; no changes have been deployed.

## Decision

**Invite a small, clearly labelled preview audience now. Hold paid promotion until the remaining P1 items below are resolved.** The listening concept and visual identity are strong. The chief remaining risk is interpreting a common symbolic match as musical influence without a listener-reviewed sample.

## Baseline technical health score

| Dimension | Score / 4 | Evidence |
| --- | ---: | --- |
| Accessibility | 2 | Native buttons and focus states are present; several 10–11 px labels have insufficient text contrast. |
| Performance | 2 | Static, lazy-loaded details and a search worker help; the initial index is 5.1 MiB compressed and 14.4 MiB JSON before parsing and worker transfer. Slow-device behavior is unmeasured. |
| Responsive design | 2 | The modal and method page fit a 390 px viewport, but closed-state mobile controls render in the wrong place. |
| Theming and consistency | 3 | The paper, ink, olive, and rust palette is coherent, though many text colors are hard-coded and drift below the contrast target. |
| Design anti-patterns | 4 | The turntable and editorial typography are distinctive; the interface does not resemble a generic card-and-gradient template. |
| **Total** | **13 / 20** | **Acceptable: significant launch work remains.** |

The design feels specific to a jazz listening archive, not AI-generated. Its first screen is memorable. The cost of that choice is that a new visitor must understand and complete two steps before reaching a passage.

## Findings, in priority order

### P1 — Fix before paid promotion

1. **Fixed locally — the closed mobile landing displayed open-state actions.** At 390 px, “Close the lid” and “Explore passages” appeared over the top edge before the lid was opened. The base `.desk-actions` rule was absent in `static/desk.css`. The local fix defines the hidden base state and reveals the actions only after opening; a 390 px browser check confirmed it.
2. **Fixed locally — a specific discovery could not be linked.** `static/app.js` previously restored only `#explore`. The local fix adds `?pair=` links in the address bar built from source solo IDs and starting note positions, and restores the pair on load. The current catalog has no duplicate keys. Browser checks confirmed direct opening, closing, and a graceful response to a removed match. A ranking reorder will not renumber these URLs.
3. **The Echoes vocabulary overstates what a directed edge means.** `static/catalog.js` uses the earlier recording year to orient a link; `static/app.js` labels the resulting lists “Echoes” and “Echoed by.” The algorithm observes transcribed similarity, not listening, quotation, or influence. Across the catalog, 484 of 2,731 musician pairings with dated links contain examples in both date directions. Use “Earlier recordings with matches” / “Later recordings with matches” and show a short interpretation note beside the graph. Do not advertise a “most influenced” musician.
4. **No human relevance sample supports a headline ranking yet.** The 0.80 similarity floor and cost weights are heuristic. At least one qualifying match exists for 53,064 of 103,475 eligible different-composition solo pairs (51.3%). This makes raw counts a poor proxy for an exceptional musical relationship. Before publishing “who echoes whom most,” have listeners independently rate a stratified sample of top, middle, and random matches, include common-pattern and same-performer controls, then set an editorial threshold for featured examples. Document disagreements and known false positives.
5. **Fixed locally — small informational text failed WCAG AA contrast.** Muted metadata, stats, and footer copy now use a darker shared text color in the app and method page. Automated axe checks cover the landing, pair detail, and method page; manual keyboard/screen-reader verification remains part of release review.
6. **Release candidate assembled locally; commit and review before publish.** The app, CSS, and linked `static/method.html` / `static/method.css` are present together. The new browser gate must pass on the final commit before Pages deploys it.
7. **Campaign asset register prepared; third-party visuals still need clearance.** The new `static/ASSET_RIGHTS.md` inventories the project social card, generated desk artwork, 140 cover-map entries, and portrait sources. The data license excludes covers and portraits. Use project-authored artwork and synthesized playback for initial promotion unless each selected third-party asset has an affirmative commercial-use decision recorded.

### P2 — Improve for launch, or schedule immediately after

8. **Fixed locally — the listening payoff was hidden behind two clicks.** The closed landing now says that notation playback is synthesized, sets expectations for recording availability, and links directly to a featured pair while retaining the turntable entrance.
9. **Fixed locally — the deploy gate did not exercise the browser.** GitHub Actions now runs first-party JavaScript syntax checks, the existing Python suite and catalog validator, and a pinned Playwright smoke journey covering the landing, archive, pair dialog, direct/stale pair URLs, and method assets. The browser test includes WCAG axe checks and viewport/reflow checks.
10. **Startup work is now off the UI thread; device performance remains open.** Before the change, warm desktop Chromium showed about 80 ms JSON parsing and a 52 ms task around catalog setup/transfer. The worker now fetches, decompresses, parses, and owns the full index, returning only visible page data to the UI. After the change, a local run measured about 82 ms unpacking, 85 ms parsing, 185 ms worker startup, then 42 ms first filtering and 44 ms first rendering. `?perf=1` exposes these measurements. This is not a cold mobile-network/device result, so the 4 s mobile budget still needs verification on a physical phone.
11. **Copy now reflects recording availability; featured media still needs manual verification.** The landing and media kit distinguish synthesized playback from recording links, which are available for some passages and can have approximate timestamps. Manually verify any pair featured in promotion.
12. **Fixed locally — social preview and feedback path were thin.** Open Graph now points to a dedicated 1200 × 630 project-authored PNG with alt/size metadata, and the social card is also available as SVG source. A footer feedback link opens a GitHub issue form. No visitor analytics/tracking was added; GitHub Pages does not provide an app-specific funnel report, so paid campaign measurement still needs a privacy-reviewed plan.

## Data findings for editorial use

- The source catalog contains **456 solos, 78 musicians, and 215,084 indexed passage pairs**; **213,870** are different-composition pairs visible in the default Crate view. These counts are for WJazzD v2.1, not for jazz as a whole.
- The largest **raw count of distinct solo pairings between two musicians** is John Coltrane ↔ Miles Davis: **236** different-composition solo pairs among their 20 and 19 included solos. This is not 236 quotations, and the count depends on who and how many solos the database includes.
- A strong feature example is Clifford Brown, “A Night in Tunisia” (1954), against Joe Henderson, “Johnny Come Lately” (1991): **38 paired notes, one skipped note, 85.4% heuristic similarity**; both catalog sides have JazzTube-aligned recording links. Listening and upload identity still need editorial verification before public promotion.
- The most reused exact eight-note window in a simple count appears in Hank Mobley’s “Soul Station” and matches windows in **35 other solos by 27 musicians**. Eight-note runs can be stock jazz vocabulary, and this was not clustered or listened to as a single musical motif. Keep this as an investigation lead, not a press claim.

## Release sequence

1. Commit the mobile, pair-link, contrast, browser-gate, social-card, and feedback changes; require CI on that exact revision.
2. Choose three pairs with manually checked audio and metadata, then confirm their links on the deployed site.
3. Rewrite Echoes labels and put the interpretation limit next to the visualization.
4. Run a blinded listener review before promoting any “most matched” ranking.
5. Clear the exact third-party visuals and clips used in the campaign; use the prepared social card and feedback route.
6. Commit the current local method page and app changes, run CI on that revision, then do a small preview launch and review feedback before paid advertising.

The code already has useful foundations: a static deployment, on-demand detail shards, a worker for large queries, an integrity validator, keyboard-operable result cards, visible source attribution, and a careful method explanation. Keep those as the project grows.

Suggested follow-up skills: `/harden` for the closed state, contrast, and release path; `/clarify` for the graph and landing copy; `/distill` for a direct first-listen path; `/polish` for the final visual pass. Re-run `/audit` on the release candidate.
