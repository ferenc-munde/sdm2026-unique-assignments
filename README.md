# SDM 2026 – Individual assignment: Harness Engineering

For students who could not attend the hackathon. You work **alone**, with AI agents, and build two things:

1. a small **online cooperative browser game**, and
2. the **harness** around it: everything that lets AI coding agents work in your repository safely and productively.

The harness is the main part of the grade. The game is what the harness is for.

> **Harness engineering** is designing the environment an AI agent works in: the instructions it reads, the commands it runs, the checks that stop it from breaking things, the reusable workflows it follows, and the feedback that tells you whether it did the job. A good harness lets you hand an agent an issue and get back a reviewable, tested pull request.

## Deadline and submission

- **Deadline:** 31. December 2026. Work merged after the deadline is not counted.
- Send your **repository URL** and your **game URL** to the instructor@munde.group email address with your Neptun ID.
- The repository must be **public** (or invite `ferenc-munde` as a collaborator with read access).
- The evaluation is **automatic** (see [Grading](#grading)), then checked by an instructor. Run the self-check before you submit.

## 1. The game

An online cooperative game in the spirit of the hackathon:

- **2–x players**, each in their own browser, play **together against the game**: they win or lose as a team.
- **Real-time multiplayer:** players join one room with a **room code or a shared link**; the server owns the game state, clients only send input.
- **Interdependence:** players need each other, for example different roles, shared resources, or tasks that need two players at once.
- **A complete loop:** lobby → play → win or lose → play again, in rounds of a few minutes.
- **Online:** deployed to a public URL (Railway, Render, Fly.io or any free host) with a `GET /health` endpoint that answers HTTP 200.
- **Stack:** your choice. TypeScript with Vite and Colyseus (the hackathon stack) is recommended; anything else is fine if `CLAUDE.md` explains it.
- **Tests:** the game rules (scoring, win/lose, the state changes of an action) have automated tests.

Keep the game small. A simple game with a strong harness scores better than an ambitious game without one.

## 2. The harness

Your repository must contain the following. The automatic evaluator looks for exactly these names.

| # | Part | What it must be |
|---|---|---|
| H1 | `CLAUDE.md` | The single source of truth for agents (and humans). Sections (as headings): **Repository layout**, **Commands**, **Workflow**, **Definition of done**, **Testing**. Concrete, not generic: real paths, real commands. |
| H2 | `AGENTS.md` | Points to `CLAUDE.md`, so agents other than Claude find the rules. |
| H3 | One-command checks | `package.json` scripts (or the equivalent for your stack, documented in `CLAUDE.md`): `dev`, `test` and `check`. `check` runs everything a change must pass: lint or format, type check, tests. |
| H4 | CI | A GitHub Actions workflow in `.github/workflows/` that runs `check` on **every pull request** and on pushes to `main`. |
| H5 | Protected `main` | A ruleset (or branch protection) on `main`: changes only through pull requests, and the CI check must pass. |
| H6 | Templates | Issue template(s) in `.github/ISSUE_TEMPLATE/` and a pull request template (`.github/pull_request_template.md`). |
| H7 | Agent skills | At least **two** reusable agent workflows, for example `.claude/skills/<name>/SKILL.md` or `.claude/commands/<name>.md`: "start work on issue N", "open a PR that follows the template", "add a game rule with its test"… |
| H8 | Guardrails | Something that stops a wrong change automatically: a commit-message check (Conventional Commits and `Refs #N`) in CI or a git hook, an agent hook in `.claude/settings.json`, or a check that blocks edits to protected files. |
| H9 | Agent evals | A folder `evals/` with at least **three** tasks. Each task is a folder with a `task.md` (the prompt you give an agent) and a `check` script (`check.mjs`, `check.sh` or `check.py`) that decides automatically whether the agent's result is right. |
| H10 | `HARNESS.md` | Your report: for each part above, what it does and which agent mistake it prevents; the results of running your evals with an agent (pass/fail per task, and what you changed in the harness after a failure); at least **two links** to pull requests or CI runs where the harness caught a real mistake. |

## 3. The way of working (as in the hackathon)

- **Issue first.** Every change starts with a GitHub issue: a clear title, at least one label, a goal, and a **"Done when"** checklist (`- [ ] …`).
- **GitHub Project.** One GitHub Project linked to the repository, with every issue on it and a **Status** field (Backlog / Ready to development / In progress / QA / Accepted / Done) that you actually move.
- **Branches:** one branch per issue, named `<type>/<issue-number>-<short-description>`, for example `feat/12-room-codes`.
- **Commits:** [Conventional Commits](https://www.conventionalcommits.org/) (`feat: add room codes`), with `Refs #12` on its own line in the body.
- **Pull requests:** one per issue, into `main`, with `Closes #12` in the description and the template filled in. Merge only when CI is green.
- **AI first:** let agents do the work, and keep the `Co-Authored-By:` trailer your agent adds to commits.
- **Steady work:** commits on at least **three different days**. A single dump of the whole project the night before the deadline scores low.
- **Minimum volume:** at least **100 issues** and **60 merged pull requests**.

## Grading

Your final score (0–100) has two parts:

| Part | Weight | Who grades it |
|---|---|---|
| **Automatic checks** | **70%** | the evaluator script (`evaluate.mjs`) |
| **Game quality** | **30%** | an instructor, who plays your game |

**Final score = 0.7 × automatic checks (0–100) + 3 × game quality (0–10).**

### Automatic checks (70%)

The evaluator reads your repository through the GitHub API and your game URL over HTTP. It **never runs your code**: tests count through your CI results. It gives 0–100 points:

| Area | Points | What is checked |
|---|---|---|
| **Harness** | 50 | H1–H10 above: files, sections, CI on PRs, green CI on `main`, protected `main`, at least two skills, a guardrail, at least three evals with a check each, `HARNESS.md` with links |
| **Way of working** | 30 | issues with label and "Done when"; merged PRs that close an issue; branch names; commit format and issue references; AI co-authored commits; the Project with your issues and a used Status field; commits on three or more days |
| **Game** | 20 | the game URL and its `/health` answer; README "How to play" with players and controls; a multiplayer library in the dependencies; test files for the game rules |

### Game quality (30%)

An instructor plays your game with at least two players and gives 0–10 points:

| Criterion | Points |
|---|---|
| **Cooperation:** the players really need each other, and working together is the core of the game | 0–3 |
| **Complete and fun:** lobby → play → win or lose → play again works, rounds are short, and the game is worth replaying | 0–3 |
| **Stable:** joining by code or link, playing and reconnecting work without errors or desync | 0–2 |
| **Clear and polished:** a new player understands what to do from the game and the README, and the game looks and feels finished | 0–2 |

### Grade

| Final score | Grade |
|---|---|
| 85–100 | 5 (excellent) |
| 70–84 | 4 (good) |
| 55–69 | 3 (satisfactory) |
| 40–54 | 2 (pass) |
| 0–39 | 1 (fail) |

The instructor also reviews every automatic report, and can lower the grade if a requirement is met only on paper (for example an empty `HARNESS.md` section or an eval whose check always passes), or raise it for exceptional work. Copying another student's repository is a fail.

## Self-check

You can run the evaluator on your own repository before you submit. It needs [Node.js](https://nodejs.org/) 18+ and the [GitHub CLI](https://cli.github.com/), logged in (`gh auth login`):

```bash
node evaluate.mjs --repo <your-login>/<your-repo> --url https://<your-game-address>/
```

`evaluate.mjs` is in this repository: clone it, or download the file. The report lists every check with the points it gave and what is missing. The instructors run the same script on your submission. Without the game quality score the report shows your automatic part and the range of grades still possible.
