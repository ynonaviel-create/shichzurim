# Filling units in a study doc (studyDoc / lomda)

The agent prompt gives you: COURSE (the course id), WT (the repo), DIR (the folder holding the u-tNN.html files), DUMPS (the per-topic question dumps), the spine and secondary sources for the course, and the list of your files.

**Read the skill first:** `WT/.claude/skills/write-study-guide/SKILL.md` (writing rules, illustrations, SVG traps). **Example of a finished unit:** open `WT/guides/cellbio-full.html`, search for `<section class="unit"`, and look at one or two finished units (structure, length, SVG, exercise).

## Input
- Your files: `DIR/u-tNN.html`, one unit skeleton per file, with TODOs. **There are no trap boxes and no "נסה קודם" gates — they were removed from the site (04/10/2026). Do not add any.**
- What was actually asked in the unit: `WT/exams/COURSE-guide.json`, the unit with the same `topic` (what, points, gap). For every question: `DUMPS/tNN.md`.
- **The sources (the truth)** are listed in the agent prompt. Write **only from them**, plus the explanations attached to the questions. Anything that is in the explanations only gets a short note in the text saying so. Anything that is in neither does not go in.

## What to fill in each unit (and write back to the same file)
1. **The idea in depth (הרעיון לעומק):** 3–5 paragraphs, 400–900 words for the unit as a whole. Flowing Hebrew, pitched at a first-year student, with `<b>` on key terms. Aim it at what is actually asked (the points in the map), but explain the material instead of listing it. If a topic has calculations or reactions, add **one worked example** (`<div class="note"><b>דוגמה פתורה:</b> …</div>`) using the numbers from one of the archive questions, step by step.
2. **One inline SVG** (viewBox="0 0 520 H"). Colors only through the classes in the example (`.pos .neg .fld .lbl` and so on) and `var(--ink)`. **No `<b>` inside `<text>`**; use `<tspan style="font-weight:800">` instead. **The page is RTL, so `text-anchor="end"` is reversed.** Prefer `middle`. Latin text inside Hebrew `<text>` goes on a separate line or gets `style="direction:ltr"`. Render it in headless Chrome and look at it. The figcaption states the conclusion being tested.
3. **The medical connection (החיבור הרפואי):** only if there is a real connection in the sources or the questions. If there isn't, **delete** the h4 and the paragraph.
4. **Disputed keys:** if a point is marked ⚠️ disputed key, write the material's version in the body and say the key is disputed. **Never rule against the key and never fix questions.**
5. **Matching exercise:** 3–5 pairs of `<span data-t>מונח</span><span data-d>הגדרה</span>` taken from the unit. If the unit has a multi-step process, add an `ex-order` too. If there is nothing to match, delete the exercise block and its TODO.
6. **Videos:** there are no verified IDs, so **delete** the video TODO line.
7. **Zero TODOs at the end.** Do not touch the `<h3>` line, the read-aloud buttons, the `id` or the drill link.
8. **A number range uses a plain hyphen (2-4%), not an en dash.** An en dash between digits displays reversed in Hebrew.

## Verify before you finish (with a script)
For each file:
- It starts with `<section class="unit" id="u-tNN">` and ends with `</section>`.
- Zero "TODO".
- No `<b>` inside `<text>`.
- Exactly 1 `<figure>`.
- No `class="trap"` / `class="traps"` anywhere.
- The HTML is balanced.

**Do not touch any other file.** Give helper scripts the suffix you were assigned and delete them at the end. Report in 4 lines: units, words per unit, what was not in the sources, doubts.
