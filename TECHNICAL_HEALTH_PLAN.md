# Technical health plan for launch

**Baseline:** 13/20 in [the 27 October audit](PRELAUNCH_AUDIT.md). That score was recorded before the local mobile landing and pair-link fixes; it has not been formally recalculated. **Release target:** at least **18/20**, no open P1 technical findings, and a repeatable browser check on the exact revision to be deployed.

| Dimension | Baseline | Target | Evidence required for the target |
| --- | ---: | ---: | --- |
| Accessibility | 2 | 4 | WCAG AA contrast and operation across the main journeys; manual keyboard and screen-reader review. |
| Performance | 2 | 3 | Measured cold mobile load and responsive filtering, with a documented budget and no severe long tasks. |
| Responsive design | 2 | 4 | All main journeys work at narrow, tablet, and desktop widths and at 200% text zoom. |
| Theming and consistency | 3 | 3 | Existing light editorial theme stays coherent; muted colors are centralized and corrected. |
| Design anti-patterns | 4 | 4 | Preserve the distinctive turntable and editorial design while removing friction. |
| **Total** | **13** | **18** | The final score is awarded only after re-audit. |

The score is a review rubric, not an automated test result. Changes to the landing and pair URLs may already improve usability, but no points are counted until the release candidate is checked again.

## Work order

### 0. Make a reviewable release candidate (about half a day)

- Review and commit the existing local changes together where they form one feature, especially the linked `method.html` / `method.css` files, CSS, and JavaScript. Keep unrelated changes in separate commits. Record the catalog report checksum and deployed revision.
- Confirm the target is the static site in `static/` and that the published URL serves this revision. Do not evaluate a mix of local and deployed assets.
- **Done when:** the branch is clean, the method link resolves, and reviewers can reproduce the exact build.

### 1. Add a browser release gate (about one day)

Extend `.github/workflows/pages.yml` beyond Python tests and catalog validation. Use a pinned browser runner against a local static server; [Playwright documents the GitHub Actions setup](https://playwright.dev/docs/ci). Keep the journey small and meaningful:

1. Open the landing at 390 px and confirm closed-state controls are hidden.
2. Enter the archive; results and a selected pair render without console errors.
3. Open a pair, check both score panels and the note comparison, then close it.
4. Load a `?pair=` URL directly and confirm the intended pair opens; an obsolete key gives the archive fallback.
5. Follow `method.html` and check that local CSS, JavaScript, and catalog files resolve.

Also run `node --check` for the three first-party JavaScript files, the existing Python suite, and `jazzmine.static_validate`. Require the checks before the Pages deploy job. A browser gate protects the functionality that Python-only validation cannot see.

### 2. Make the app accessible in its main journeys (about two days)

- Replace scattered low-contrast text colors in `static/styles.css`, `static/crate.css`, `static/echoes.css`, `static/desk.css`, and `static/method.css` with a small set of surface/text tokens. Check actual foreground/background pairs in the landing, results, modal, and method page. Aim for at least **4.5:1 for normal text**, per [WCAG 2.2 contrast minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html). The current stat labels and footer are around 3.42:1 and 2.83:1.
- Walk the flow by keyboard: lift lid, filters, crate cards, pair dialog, audio controls, note table, Echoes search/zoom, and return. Make focus visible and sensible after closing a dialog or changing views. Verify the modal's name and controls in a screen reader.
- Check at 200% text zoom, with reduced motion, and without relying on color alone. The automated accessibility check should cover the main page, a pair dialog, and the method page; manual keyboard and screen-reader checks remain required.
- **Done when:** no known WCAG AA failure remains in these journeys and a reviewer can complete them without a pointer. This is the evidence needed for 4/4, not a color change alone.

### 3. Finish mobile and reflow behavior (about one to two days)

- Check 320, 390, 768, and 1280 px widths, plus 200% text zoom. Inspect the landing before and after opening, Crate filters and sort, the pair dialog, score scrolling, Echoes controls and panel, and the method page.
- Fix clipped labels, overlapping controls, unexpected page-wide horizontal scrolling, and tap targets that are awkward on a phone. Keep score notation horizontally scrollable inside its own panel. Ensure the direct pair URL reaches its content without the two-step landing entry.
- Add a clear loading state for the archive after opening the lid. On slow networks, a blank or unchanged count should not look broken.
- **Done when:** every primary action remains visible and usable in the tested viewports; no horizontal overflow escapes the intended score/timeline scrollers. Capture one desktop and one mobile visual review for the release.

### 4. Measure, then improve, startup cost (one to three days, depending on results)

- Instrument the times for index fetch, decompression, JSON parse, worker initialization, first useful result, and filter response. Test a cold load on a mid-range phone and throttled mobile data. The index is currently **5,362,742 bytes compressed** and **15,149,848 bytes as JSON**; its arrays are parsed on the main thread and sent to a worker.
- Use [Core Web Vitals](https://web.dev/articles/vitals) as external targets: LCP at or below 2.5 s, INP at or below 200 ms, and CLS at or below 0.1 at the 75th percentile once there is field traffic. Before launch, use repeated lab runs plus an actual phone. Also track the app-specific time until the first pair can be opened; set a practical release budget of **4 s or less** on the chosen mobile test profile.
- If the budget fails, make a small featured/first-results payload available before the full catalog, then move catalog decompression and parsing into the worker so the main thread does not parse and clone 215,084 rows. Return only the page of IDs and metadata needed for visible cards. Recheck filter counts against the current catalog after any representation change.
- **Done when:** cold load and filtering meet the documented budget on the chosen device/network profile, and no profiling trace shows a blocking startup task that prevents interaction. Avoid a large data rewrite if measurement already passes.

### 5. Re-audit and release (about half a day)

- Run the automated gate on the exact release revision, repeat the manual keyboard and responsive paths, and record mobile performance results.
- Re-score all five dimensions. **Ship target: at least 18/20, no open P1 technical issue, no broken direct pair/method link.** Treat 19/20 as a stretch outcome if the measured performance is excellent; do not spend launch time adding dark mode solely to gain a theme point.
- After deployment, check the public URL, a featured pair link, social preview, and mobile behavior again. The CI check runs against local files; this last check catches hosting and cache differences.

## Separate launch gates

The technical score does not certify the musical claims or campaign assets. Before paid promotion, separately complete the listener review of featured matches, revise “Echoes” labels so date order cannot imply influence, verify the chosen recording uploads/timestamps, and clear the exact images and audio used in advertising. Those items are tracked in [the prelaunch audit](PRELAUNCH_AUDIT.md) and [media kit](MEDIA_KIT.md).

**Execution estimate:** roughly **5–8 focused working days for one developer**, excluding rights review and expert listening. Accessibility and responsive fixes can overlap in code, so review them together; performance restructuring is conditional on measured failure.
