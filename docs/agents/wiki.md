# Wiki updates

Users learn Isopod from the wiki on the website (repo `Isopod-Project/Isopod-Website`, file `src/WikiPage.tsx`, live at https://isopod-project.github.io/Isopod-Website/#/wiki). The dashboard's help buttons link into it. Keep it current as part of each issue, not as a separate chore.

## When a wiki update is required

Update the wiki in the same piece of work when the issue changes something a user can see or configure:

- a new feature, tab, button, or dashboard area
- changed behavior of an existing feature
- a new setting, environment variable, or install step
- a new supported platform, server type, or loader
- a new error message or a new limitation
- a workaround for a known problem

## When it is exempt

- Small bug fixes that make a feature work the way the wiki already describes
- Internal changes: refactors, dependency bumps, CI, test-only changes, developer tooling

If unsure, ask: "Would a user who read the wiki yesterday now be wrong or missing something?" If yes, update it.

## How to update it

1. In a clone of `Isopod-Project/Isopod-Website`, branch off `main` with the same issue number as the Isopod branch.
2. Edit `src/WikiPage.tsx`. Each article is an entry in the `articles` array with `id`, `title`, `category`, `summary`, `sections`, and `content`.
   - Put new content in the article that already covers that part of the dashboard. Add a new article only for a new area.
   - Lay out each article as: what it is, how to use or set it up, then troubleshooting or limitations.
   - Give every `<h2>` an `id` and list it in the article's `sections`, so search and the index find it and help buttons can deep-link to it.
   - Never rename or remove an existing article or section id. Help buttons in released versions of the dashboard link to them.
3. If the change adds a dashboard area with its own help button, add its topic to `HELP_TOPICS` in `frontend/src/components/HelpButton.tsx` pointing at `<article>/<section>`. Unknown topics fall back to the wiki home.
4. Run `npm run build` in the website repo and open a PR there. Link it from the Isopod PR.
5. Keep `documentation/everyone/getting-started.md` in step when you change a user-facing feature it covers.

In the Isopod PR template, tick **Wiki updated** with the website PR link, or **N/A** with the exempt reason.
