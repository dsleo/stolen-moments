# Stolen Moments — launch media kit

**Working editorial angle:** *What happens when you put two jazz solos, recorded decades apart, side by side and listen to the notes?*

**One-line description:** Stolen Moments is an interactive listening archive that finds similar passages in 456 transcribed jazz solos and lets you hear and inspect the match.

**Audience:** jazz listeners and musicians. **Voice:** curious, editorial, precise about what the data can show. **Configured publication URL:** <https://dsleo.github.io/stolen-moments/>. **Featured pair URL after the next deployment:** <https://dsleo.github.io/stolen-moments/?pair=87.562.200.283>.

## The story to lead with

In 1954, Clifford Brown played “A Night in Tunisia.” In a 1991 recording, Joe Henderson played “Johnny Come Lately.” In the Weimar Jazz Database transcriptions, the archive lines up **38 notes** across those two different compositions, with **one skipped note** and **85.4% similarity under this project's pitch-and-rhythm score**. The dates are 37 years apart. That does not tell us whether one musician heard or borrowed from the other. It gives listeners a musical question they can actually test: play the two transcribed phrases, inspect the aligned notes, then follow the available recordings.

This is the suggested lead for a 30-second demo or feature pitch. Before releasing it, manually confirm the two linked uploads and timestamps, listen to the passages with at least one musician who did not build the algorithm, and check all visuals used in the edit.

Source transcription pages: [Brown, solo 87](https://jazzomat.hfm-weimar.de/dbformat/synopsis/solo87.html) and [Henderson, solo 200](https://jazzomat.hfm-weimar.de/dbformat/synopsis/solo200.html). Catalog result at export: row 2, source note windows 562–599 and 283–321. The pair URL uses solo IDs and starting note positions, so a ranking reorder does not change it. If a future catalog removes the match, the app offers the archive instead.

## Copy ready to adapt

### Short description

Stolen Moments turns a jazz transcription archive into a listening experiment. Choose two solos, hear the matched phrases, see where the notes agree or diverge, and jump to an available source recording. Its matches are invitations to listen, not claims that one artist copied another.

### Press paragraph

What if the history of jazz could be explored one phrase at a time? Stolen Moments searches the 456 solo transcriptions in the Weimar Jazz Database for passages with similar pitch and rhythm. It pairs an audio rendering of each transcription with side-by-side notation and, where available, links into recordings. One striking example places Clifford Brown’s 1954 “A Night in Tunisia” next to Joe Henderson’s 1991 “Johnny Come Lately”: 38 notes align under the project’s heuristic score. The archive does not declare influence. It opens a path from a surprising visual match to a close listen.

### Short social post

Two solos. Thirty-seven years apart. A phrase worth hearing twice. Stolen Moments lets you compare matched passages from the Weimar Jazz Database note by note, then listen for yourself. [Open the pair](https://dsleo.github.io/stolen-moments/?pair=87.562.200.283).

### Alternative social post for musicians

Is it a shared lick, a common shape, or a coincidence? Put two jazz transcriptions side by side and listen. Stolen Moments shows the aligned notes, skipped notes, and the source context so your ears can make the next call. [Hear an example](https://dsleo.github.io/stolen-moments/?pair=87.562.200.283).

## A 30-second launch clip

| Time | Picture | On-screen words / sound |
| --- | --- | --- |
| 0–4 s | Turntable opens, then cut straight to the two scores. | “Can you hear the connection?” |
| 4–12 s | Brown phrase plays, highlighting the printed passage. | “Clifford Brown · 1954” |
| 12–20 s | Henderson phrase plays; show the note comparison. | “Joe Henderson · 1991” |
| 20–26 s | Show one skipped note and the two recording links. | “38 paired notes · one skipped note” |
| 26–30 s | Return to the archive and a stable pair URL. | “Listen. Compare. Decide.” |

Use the app’s synthesized transcription audio for the clip unless the recording and recording rights have been separately cleared. Caption the video and identify synthesized sound as such.

## Other stories to develop

1. **A network, not a family tree.** John Coltrane and Miles Davis have the largest raw count of different-composition solo pairings between two musicians in this catalog: **236**. Their 20 and 19 included solos create many opportunities for a match. This is a good way to show the network, provided the graphic says “matching solo pairs in this archive” and never “influence.”
2. **A shared vocabulary.** An eight-note window in Hank Mobley’s “Soul Station” appears in matches with 35 other solos by 27 musicians. This may be a common jazz figure. Cluster nearby windows and have musicians listen before turning it into a “most shared phrase” claim.
3. **A musician’s listening challenge.** Invite one jazz player to select three matches, rate each as a compelling connection, shared vocabulary, or weak resemblance, and explain the call. Their judgment makes a stronger feature than an algorithmic leaderboard alone.

## Fact sheet and language guardrails

| Safe to say | Exact scope |
| --- | --- |
| 456 solos, 78 musicians, 200,809 note events | WJazzD v2.1 in this import. |
| 215,084 indexed passage pairs | Includes same-composition results in the exported catalog. |
| 213,870 passages in the default Crate | Different-composition results after the app's default exclusion. |
| “85.4% similarity” for the Brown–Henderson example | A heuristic score on aligned transcribed pitch and rhythm; not a probability of borrowing or identical audio. |
| “Listen to the passages” | Synthesized notes are available in the app; source recording links are available for some pairs and can have approximate timestamps. |

Do not say “proved quotation,” “copied,” “plagiarized,” “influenced by,” or “the most influential musician.” Avoid “all of jazz.” Use “matched passages in this archive,” “similar transcribed phrases,” and “earlier/later recording” instead. The title *Stolen Moments* is the project's name, not an accusation.

## Assets and credits

- **Social card:** [social-card.png](static/social-card.png) (1200 × 630; project-authored artwork, no cover or portrait imagery), with an editable [SVG source](static/social-card.svg). The site Open Graph metadata points to this PNG and includes image alt text.
- **Hero art:** [jazz-desk-base.webp](static/assets/jazz-desk-base.webp) (1672 × 941; generated for this project). This is another project-art option for a text-led social post.
- **Icon:** [favicon.svg](static/favicon.svg). Use “Stolen Moments” as live text beside it rather than stretching the icon into a wordmark.
- **Product screenshots:** capture the landing, a pair view with both score excerpts, and the Echoes view after final UI and rights review. A press screenshot showing a third-party cover or portrait needs an explicit asset decision. The [campaign asset register](static/ASSET_RIGHTS.md) records known sources and clearance gaps.
- **Data credit:** “Based on the Weimar Jazz Database v2.1 by the Jazzomat Research Project (HfM Weimar); data licensed under ODbL 1.0.” See [data attribution and licence](static/DATA_LICENSE.txt) and the [Jazzomat download page](https://jazzomat.hfm-weimar.de/download/download.html).
- **Method:** link the public `method.html` page after its current local files are committed and deployed.
- **Feedback:** a “Send feedback” route now opens a GitHub issue form. This provides a direct feedback path without adding tracking scripts or collecting visitor analytics.
- **Press contact:** add a named contact and working email before sending this kit externally.

## Distribution checklist

Choose and verify three featured pairs; confirm their URLs and social preview in the deployed build; make the 30-second captioned clip; confirm the visual and audio rights for each deliverable using the asset register; add a named press contact before sending the kit externally; send it first to a small group of jazz players, educators, and music writers. Use their reactions to sharpen the public story before paying for reach.
