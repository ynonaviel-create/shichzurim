# Fact-check review of a study doc (lomda)

Your input:
- `WT/guides/COURSE-full.html`, the study doc you are reviewing.
- `WT/sources/guide-work/COURSE/*.txt`, the summaries the doc was written from. Files with `spine-` in the name are the primary summary and `sup-` files are secondary; pages are marked "===== עמ׳ N =====".
- `WT/sources/guide-work/COURSE/tNN.md`, the questions with their explanations.

The doc was written by agents. Your job is to find **factual errors**, not to improve the writing.

## Process
1. **Extract the claims.** Use a script to pull every factual sentence from each `section.unit`: the "הרעיון לעומק" paragraphs, the "החיבור הרפואי" section, every "האמת:" in the traps, the worked examples (`.note`) and the figcaptions. Do the same for the "הרגע האחרון" table.
2. **Draw a sample.** Use `random.seed(42)` and take **3 claims per unit** plus **5 rows from the "הרגע האחרון" table**. Prefer specific claims (numbers, names, "X comes from Y", "only in…") over general ones.
3. **Check each claim against the summaries.** Search them with grep, using key terms in both Hebrew and English. Give each claim one verdict:
   - `נתמך`: the summary says this. Record the file and page.
   - `נתמך-שאלה`: it isn't in the summaries but it is in a question's explanation. Record the qid.
   - `לא נמצא`: it is in neither. Explain why you think it is true or false, based only on what is written in these sources.
   - `סותר`: the summary states the opposite. Quote it with the page number.
4. **Recompute every worked example** in the sampled units, the arithmetic and the units, step by step.
5. **Fix the doc only when there is a clear error:**
   - `סותר` where the summary says otherwise explicitly, and the claim is not a "the key is disputed" statement.
   - A wrong calculation.
   - Use the smallest possible edit and change only the text of the sentence. Never change `<b>המלכודת:</b>`, `<b>האמת:</b>`, the h3 headings, the ids, the links or the dockit sections.
   - **Do not change answer keys or questions, and do not decide disputes between sources.** If the two summaries contradict each other, report it and leave the text as it is.
6. **Validate after editing.** The HTML must be balanced, the number of units and of traps must not change, and there must be no en-dash between digits.

## Output
- `WT/sources/guide-work/factcheck/COURSE.json` (create the folder if needed) with this structure: `{"course": "...", "sampled": N, "verdicts": {"נתמך": n, ...}, "items": [{"unit": "...", "claim": "...", "verdict": "...", "evidence": "...", "fixed": true|false, "fix": "before → after"}]}`.
- A report in 5 lines covering the sample size, the verdict counts, what you fixed with each before → after, what you did not fix and why, and any contradictions between the summaries.
- Touch no file other than `guides/COURSE-full.html` and the output file. Give helper scripts the suffix you were assigned, and delete them when you finish.
