# Stolen Moments — prelaunch audit, 27 October 2026

This review covers the current local `static/` build and the checked-in WJazzD v2.1 catalog. The working tree also contains uncommitted interface changes, including `method.html`; this is a review of what is on disk, not a claim that the public GitHub Pages site has these changes. I checked the catalog validator and JavaScript syntax, inspected the deployment workflow and core matching and presentation code, and opened the local site at desktop and 390 px mobile widths. I did not run a full screen-reader study or a throttled mobile performance benchmark.

## Decision

**Invite a small, clearly labelled preview audience now. Hold paid promotion until the P1 items below are resolved.** The listening concept and visual identity are strong. The chief risk is interpreting a common symbolic match as musical influence, followed by the inability to share a particular pair and a visible mobile entry bug.

## Technical health score

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

1. **The closed mobile landing displays open-state actions.** At 390 px, “Close the lid” and “Explore passages” appear over the top edge before the lid is opened. The base `.desk-actions` rule is absent; positioning and `visibility: hidden` are scoped to `[data-phase="open"]` in `static/desk.css`. Define the hidden base state and reveal it only after opening. This is a visible first-impression defect.
2. **A specific discovery cannot be linked.** `static/app.js` only restores `#explore`; cards and dialogs have no stable public URL. A reporter who receives a featured pair lands at the turntable rather than the evidence. Add stable pair links built from source solo IDs and note offsets, restore the pair on load, and provide a copy-link action. Avoid row position as a permanent ID: export sorts rows by evidence, so a rebuild can renumber them.
3. **The Echoes vocabulary overstates what a directed edge means.** `static/catalog.js` uses the earlier recording year to orient a link; `static/app.js` labels the resulting lists “Echoes” and “Echoed by.” The algorithm observes transcribed similarity, not listening, quotation, or influence. Across the catalog, 484 of 2,731 musician pairings with dated links contain examples in both date directions. Use “Earlier recordings with matches” / “Later recordings with matches” and show a short interpretation note beside the graph. Do not advertise a “most influenced” musician.
4. **No human relevance sample supports a headline ranking yet.** The 0.80 similarity floor and cost weights are heuristic. At least one qualifying match exists for 53,064 of 103,475 eligible different-composition solo pairs (51.3%). This makes raw counts a poor proxy for an exceptional musical relationship. Before publishing “who echoes whom most,” have listeners independently rate a stratified sample of top, middle, and random matches, include common-pattern and same-performer controls, then set an editorial threshold for featured examples. Document disagreements and known false positives.
5. **Small informational text fails WCAG AA contrast.** Examples calculated from current CSS: stat labels `#7d8477` on `#f4f1e8` are about 3.42:1; footer `#8c9287` on the same paper is about 2.83:1; artist metadata `#777d70` on `#f7f5ed` is about 3.89:1. Normal text needs 4.5:1 under [WCAG 2.2 SC 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html). Darken the muted text tokens and recheck computed colors on both panels. This is an accessibility issue, not just polish.
6. **Release changes are not yet a publishable revision.** The local tree has modified app/CSS/HTML files plus untracked `static/method.html` and `static/method.css`. `index.html` links to `method.html`; publishing only part of this work would leave that route broken. Commit the coherent set, review the diff, then run the deployment gate on that exact revision.
7. **Clear third-party visuals before using them in advertisements.** The data license covers the derived WJazzD catalog, while the project's own `static/DATA_LICENSE.txt` excludes album covers and artist portraits. Confirm each planned screenshot, cover, portrait, and recording clip can be used in paid creative. The generated desk artwork and plain note graphics offer a safer initial visual route. Record the decision for each asset; this is a rights review, not a conclusion that current site use is unlawful.

### P2 — Improve for launch, or schedule immediately after

8. **The landing does not explain the listening payoff before the click.** The first screen says “Stolen Moment” and “Lift the lid”; the open desk then offers another “Explore passages” step. Add one concise value sentence and a direct path into a curated pair, especially for ad traffic. Preserve the turntable moment as an optional entry experience.
9. **The deploy gate does not exercise the browser.** `.github/workflows/pages.yml` validates Python tests and catalog integrity, but does not open the page, check JavaScript syntax, follow the method link, or open a pair on a small viewport. Add one lightweight browser smoke journey and an HTML/link check to the release gate.
10. **Mobile performance has no release budget.** `static/catalog/index.json.gz` is 5,362,742 bytes; it expands to 15,149,848 bytes of JSON and is parsed before the search worker receives a copy. Measure first useful passage and input responsiveness on a mid-range phone over throttled mobile data. If slow, partition the index or ship a small curated first page before loading the full archive. The 72 ms localhost index fetch observed in this review is not a mobile-network result.
11. **Recording availability limits the promise.** The export reports 114,813 of 430,168 passage sides with no matched video (26.7%) and 45,722 estimated sides (10.6%). Of 213,870 visible different-composition passages, 114,903 have timed links on both sides (53.7%). Public copy should promise synthesized comparison for every pair and available source recordings where matched. Manually verify any pair featured in promotion.
12. **The social preview and feedback loop are thin.** The page has Open Graph fields, but `og:image` points to the uncaptioned desk photograph, there is no image alt/size metadata, and `twitter:card` is `summary`. Create a dedicated social card with the product line and a brief musical example. Add a contact or feedback route and privacy-conscious funnel measures before buying traffic, so the team can see whether visitors reach and play a pair.

## Data findings for editorial use

- The source catalog contains **456 solos, 78 musicians, and 215,084 indexed passage pairs**; **213,870** are different-composition pairs visible in the default Crate view. These counts are for WJazzD v2.1, not for jazz as a whole.
- The largest **raw count of distinct solo pairings between two musicians** is John Coltrane ↔ Miles Davis: **236** different-composition solo pairs among their 20 and 19 included solos. This is not 236 quotations, and the count depends on who and how many solos the database includes.
- A strong feature example is Clifford Brown, “A Night in Tunisia” (1954), against Joe Henderson, “Johnny Come Lately” (1991): **38 paired notes, one skipped note, 85.4% heuristic similarity**; both catalog sides have JazzTube-aligned recording links. Listening and upload identity still need editorial verification before public promotion.
- The most reused exact eight-note window in a simple count appears in Hank Mobley’s “Soul Station” and matches windows in **35 other solos by 27 musicians**. Eight-note runs can be stock jazz vocabulary, and this was not clustered or listened to as a single musical motif. Keep this as an investigation lead, not a press claim.

## Release sequence

1. Fix the mobile closed state and contrast; add a browser smoke gate.
2. Add stable pair links and choose three pairs with manually checked audio and metadata.
3. Rewrite Echoes labels and put the interpretation limit next to the visualization.
4. Run a blinded listener review before promoting any “most matched” ranking.
5. Clear the exact visuals and clips used in the campaign; prepare a dedicated preview card and feedback route.
6. Commit the current local method page and app changes, run CI on that revision, then do a small preview launch and review feedback before paid advertising.

The code already has useful foundations: a static deployment, on-demand detail shards, a worker for large queries, an integrity validator, keyboard-operable result cards, visible source attribution, and a careful method explanation. Keep those as the project grows.

Suggested follow-up skills: `/harden` for the closed state, contrast, and release path; `/clarify` for the graph and landing copy; `/distill` for a direct first-listen path; `/polish` for the final visual pass. Re-run `/audit` on the release candidate.
