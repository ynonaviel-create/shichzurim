# Importing one reconstruction (shichzur) into the archive: instructions for an import agent

**Read the skill first:** `WT/.claude/skills/import-shichzur/SKILL.md`, all of it. Then read `WT/QUESTION-STANDARD.md` (the explain standard) and the course brief, `WT/docs/shana-a/COURSE.md`, especially the import row for your exam.

## The rules (from the repo docs and memory)
- **Fidelity to the source.** Copy the question and the distractors as written in the original. Do not fix wording.
- **Never change `a` against the key.** If the key contradicts the material, add a `note` starting with ⚠️ and keep the key as it is.
- **topic:** only from the closed list in the course card (`exams/courses.json` → `topics`). Copy the name exactly.
- **explain** (the course is strict): 2–5 sentences on the mechanism, then one rejection per distractor ("המסיח ה<ordinal> שגוי כי…"), numbered 1-based by position (the correct option is counted in the numbering). Never write a rejection for the correct answer, and use no Markdown.
- **trust:** `verified` only when the source states the key was checked at the exam review. Otherwise use `partial` or `unverified`, as described in the brief.
- **Visual reading:** render the pages (PyMuPDF; if it doesn't render the Hebrew, use PDFKit through `scratchpad/render.swift` if it exists) and read the key **by eye**. Bold or underline in the key carries information.
- **A file-level note in the first write:** source, pages, what was skipped and why, and a bias report (how often the correct answer is the longest option, and where the answer sits).
- **An image belongs to a question** only when the question depends on it. Crop it to `assets/img/<id>-qN.png`.

## Output
- `WT/exams/<id>.json` (schema like the other exams of the course; see an existing file). Write the note in the first write, not at the end.
- Verify with a script: every topic is in the list, every explain has the right number of rejections, and none of them targets the correct answer. **Do not run `node sync.js`** (the parent session runs it).
- Do not touch any other file. Helper files only in a folder of your own, with the suffix you were given.
- Report in 6 lines: how many questions went in or were skipped, trust, ⚠️ (key against the material), images, the bias report, and what was not read.
