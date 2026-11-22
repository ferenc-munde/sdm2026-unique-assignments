#!/usr/bin/env node
// Automatic evaluator for the SDM 2026 Harness Engineering assignment (see README.md).
//
//   node evaluate.mjs --repo owner/name [--url https://game/] [--deadline 2026-12-01T23:59:59+01:00]
//   node evaluate.mjs --submissions submissions.json [--deadline ...] [--json] > report.md
//
// Needs Node 18+ and the GitHub CLI (gh), logged in (`gh auth login`; for the Project check the
// token needs the read:project scope: `gh auth refresh -s read:project`). No npm packages.
// It reads the repository through the GitHub API and the game URL over HTTP. It NEVER runs the
// student's code: tests count through the student's CI results.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ---- scoring (pure: data in, report out) -------------------------------------------------

const CONVENTIONAL = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([\w./-]+\))?!?: \S/;
const BRANCH = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore)\/\d+-[\w.-]+$/;
const CLOSES = /\b(close[sd]?|fix(e[sd])?|resolve[sd]?)\s+#\d+/i;
const REFS = /(^|\n)\s*(refs|closes|fixes|resolves)\s+#\d+/i;
const CO_AUTHOR = /^co-authored-by:/im;
const CHECKLIST = /^\s*[-*] \[[ xX]\]/m;
const MULTIPLAYER_LIBS = [
  "colyseus", "@colyseus/sdk", "colyseus.js", "socket.io", "socket.io-client", "ws", "peerjs",
  "partykit", "partysocket", "@geckos.io/server", "@geckos.io/client", "boardgame.io", "@heroiclabs/nakama-js",
  "@supabase/supabase-js", "firebase", "ably", "pusher-js", "uWebSockets.js", "@liveblocks/client", "yjs",
];
const REQUIRED_SECTIONS = [
  ["Repository layout", /^#+\s.*(layout|structure)/im],
  ["Commands", /^#+\s.*command/im],
  ["Workflow", /^#+\s.*workflow/im],
  ["Definition of done", /^#+\s.*(definition of done|done)/im],
  ["Testing", /^#+\s.*test/im],
];

const pct = (part, all) => (all > 0 ? part / all : 0);
const nonEmptyLines = (text) => (text ?? "").split("\n").filter((l) => l.trim()).length;

/** One graded check. `got` is clamped to [0, max]. */
function check(area, id, title, max, got, detail) {
  return { area, id, title, max, got: Math.max(0, Math.min(max, got)), detail };
}

/**
 * @param {object} d  collected data: files (path -> text|null), tree (paths), workflows, runs, rules,
 *                    issues, pulls, commits, projects, live
 * @param {{deadline?: string}} opts
 */
export function score(d, opts = {}) {
  const before = (iso) => !opts.deadline || !iso || Date.parse(iso) <= Date.parse(opts.deadline);
  const file = (p) => d.files[p] ?? null;
  const tree = d.tree ?? [];
  const checks = [];

  // ---- Harness (50) ----
  const claude = file("CLAUDE.md");
  const sections = REQUIRED_SECTIONS.filter(([, re]) => re.test(claude ?? ""));
  const missingSections = REQUIRED_SECTIONS.filter(([, re]) => !re.test(claude ?? "")).map(([n]) => n);
  checks.push(check("Harness", "H1", "CLAUDE.md with the required sections", 8,
    (claude ? 2 : 0) + sections.length + (nonEmptyLines(claude) >= 40 ? 1 : 0),
    !claude ? "CLAUDE.md missing" : `${sections.length}/5 sections${missingSections.length ? `, missing: ${missingSections.join(", ")}` : ""}; ${nonEmptyLines(claude)} non-empty lines (40 needed for the last point)`));

  const agents = file("AGENTS.md");
  checks.push(check("Harness", "H2", "AGENTS.md points to CLAUDE.md", 2,
    agents && /CLAUDE\.md/.test(agents) ? 2 : agents ? 1 : 0,
    !agents ? "AGENTS.md missing" : /CLAUDE\.md/.test(agents) ? "ok" : "AGENTS.md does not mention CLAUDE.md"));

  const scripts = d.rootScripts ?? {};
  const has = (s) => typeof scripts[s] === "string" && scripts[s].trim() !== "";
  checks.push(check("Harness", "H3", "dev, test and check scripts", 4,
    (has("dev") ? 1 : 0) + (has("test") ? 1 : 0) + (has("check") ? 2 : 0),
    `found: ${["dev", "test", "check"].filter(has).join(", ") || "none"} (in ${d.rootScriptsFrom ?? "no package.json"})`));

  const prWorkflows = (d.workflows ?? []).filter((w) => /(^|\n)\s*(on:.*pull_request|pull_request\s*:|- pull_request)/m.test(w.text) || /on:\s*\[[^\]]*pull_request/.test(w.text));
  checks.push(check("Harness", "H4", "CI workflow runs on pull requests", 4,
    prWorkflows.length ? 4 : (d.workflows ?? []).length ? 1 : 0,
    prWorkflows.length ? `on PRs: ${prWorkflows.map((w) => w.path).join(", ")}` : (d.workflows ?? []).length ? "workflows exist but none runs on pull_request" : "no workflow in .github/workflows"));

  const runs = (d.runs ?? []).filter((r) => r.status === "completed" && before(r.created_at));
  const last = runs[0];
  checks.push(check("Harness", "H4b", "latest CI run on the default branch is green", 4,
    last?.conclusion === "success" ? 4 : 0,
    last ? `${last.name}: ${last.conclusion} (${last.created_at})` : "no completed run on the default branch"));

  const ruleTypes = new Set((d.rules ?? []).map((r) => r.type));
  const prRule = ruleTypes.has("pull_request") || d.branchProtection?.pr;
  const statusRule = ruleTypes.has("required_status_checks") || d.branchProtection?.status;
  checks.push(check("Harness", "H5", "main is protected: PRs only, CI required", 5,
    (prRule ? 3 : d.branchProtected ? 1 : 0) + (statusRule ? 2 : 0),
    `pull request rule: ${prRule ? "yes" : "no"}; required status checks: ${statusRule ? "yes" : "no"}${!prRule && d.branchProtected ? " (branch is protected, rules not readable)" : ""}`));

  const issueTemplates = tree.filter((p) => /^\.github\/ISSUE_TEMPLATE\/.+\.(md|ya?ml)$/i.test(p) && !/config\.ya?ml$/i.test(p));
  const prTemplate = tree.find((p) => /^(\.github\/|docs\/)?pull_request_template\.md$/i.test(p) || /^\.github\/PULL_REQUEST_TEMPLATE\/.+\.md$/i.test(p));
  checks.push(check("Harness", "H6", "issue and pull request templates", 4,
    (issueTemplates.length ? 2 : 0) + (prTemplate ? 2 : 0),
    `issue templates: ${issueTemplates.length}; PR template: ${prTemplate ?? "none"}`));

  const skills = tree.filter((p) => /^\.claude\/skills\/[^/]+\/SKILL\.md$/i.test(p) || /^\.claude\/commands\/[^/]+\.md$/i.test(p) || /^\.agents?\/(skills|commands)\/.+\.md$/i.test(p));
  checks.push(check("Harness", "H7", "at least two agent skills or commands", 5,
    skills.length >= 2 ? 5 : skills.length === 1 ? 2 : 0,
    skills.length ? skills.join(", ") : "none in .claude/skills/*/SKILL.md or .claude/commands/*.md"));

  const guardrails = [];
  if (tree.some((p) => /^(\.githooks|\.husky)\/(commit-msg|pre-commit|pre-push)$/.test(p))) guardrails.push("git hook");
  if ((d.workflows ?? []).some((w) => /commitlint|conventional|commit-?msg|Refs #/i.test(w.text))) guardrails.push("commit check in CI");
  if (/"hooks"\s*:/.test(file(".claude/settings.json") ?? "")) guardrails.push("agent hook in .claude/settings.json");
  if (tree.some((p) => /^commitlint\.config\.|^\.commitlintrc/.test(p))) guardrails.push("commitlint config");
  checks.push(check("Harness", "H8", "an automatic guardrail", 4,
    guardrails.length ? 4 : 0, guardrails.length ? guardrails.join(", ") : "no git hook, commit check, commitlint config or agent hook found"));

  const evalDirs = [...new Set(tree.filter((p) => /^evals\/[^/]+\/task\.md$/i.test(p)).map((p) => p.split("/")[1]))];
  const evalsWithCheck = evalDirs.filter((dir) => tree.some((p) => new RegExp(`^evals/${dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/check\\.(mjs|js|ts|sh|py)$`, "i").test(p)));
  checks.push(check("Harness", "H9", "at least three agent evals with a check", 6,
    Math.min(3, evalsWithCheck.length) * 2,
    `${evalDirs.length} task(s), ${evalsWithCheck.length} with a check script${evalsWithCheck.length ? `: ${evalsWithCheck.join(", ")}` : ""}`));

  const harness = file("HARNESS.md");
  const links = (harness ?? "").match(/https:\/\/github\.com\/[^\s)]+\/(pull\/\d+|actions\/runs\/\d+)/g) ?? [];
  checks.push(check("Harness", "H10", "HARNESS.md report with links to real catches", 4,
    (harness ? 1 : 0) + (nonEmptyLines(harness) >= 40 ? 1 : 0) + (new Set(links).size >= 2 ? 2 : 0),
    !harness ? "HARNESS.md missing" : `${nonEmptyLines(harness)} non-empty lines; ${new Set(links).size} link(s) to PRs or CI runs`));

  // ---- Way of working (30) ----
  const issues = (d.issues ?? []).filter((i) => !i.pull_request && before(i.created_at));
  const goodIssues = issues.filter((i) => (i.labels ?? []).length > 0 && CHECKLIST.test(i.body ?? ""));
  const issueShare = pct(goodIssues.length, issues.length);
  checks.push(check("Way of working", "W1", "10+ issues, with a label and a \"Done when\" checklist", 6,
    (issues.length >= 10 ? 2 : 0) + (issueShare >= 0.8 ? 4 : issueShare >= 0.5 ? 2 : 0),
    `${issues.length} issues; ${goodIssues.length} (${Math.round(issueShare * 100)}%) with a label and a checklist`));

  const merged = (d.pulls ?? []).filter((p) => p.merged_at && before(p.merged_at));
  const closing = merged.filter((p) => CLOSES.test(p.body ?? ""));
  const closeShare = pct(closing.length, merged.length);
  checks.push(check("Way of working", "W2", "8+ merged pull requests that close an issue", 5,
    (merged.length >= 8 ? 2 : 0) + (closeShare >= 0.8 ? 3 : closeShare >= 0.5 ? 1 : 0),
    `${merged.length} merged PRs; ${closing.length} (${Math.round(closeShare * 100)}%) with "Closes #N"`));

  const named = merged.filter((p) => BRANCH.test(p.head?.ref ?? ""));
  const nameShare = pct(named.length, merged.length);
  checks.push(check("Way of working", "W3", "branch names <type>/<issue>-<description>", 3,
    nameShare >= 0.8 ? 3 : nameShare >= 0.5 ? 1 : 0,
    `${named.length} of ${merged.length} merged PRs (${Math.round(nameShare * 100)}%)`));

  const commits = (d.commits ?? []).filter((c) => (c.parents ?? []).length < 2 && before(c.commit?.committer?.date));
  const msg = (c) => c.commit?.message ?? "";
  const conventional = commits.filter((c) => CONVENTIONAL.test(msg(c).split("\n")[0]));
  const referencing = commits.filter((c) => REFS.test(msg(c)));
  const convShare = pct(conventional.length, commits.length);
  const refShare = pct(referencing.length, commits.length);
  checks.push(check("Way of working", "W4", "Conventional Commits with an issue reference", 5,
    (convShare >= 0.8 ? 3 : convShare >= 0.5 ? 1 : 0) + (refShare >= 0.6 ? 2 : refShare >= 0.3 ? 1 : 0),
    `${commits.length} commits on the default branch: ${Math.round(convShare * 100)}% conventional, ${Math.round(refShare * 100)}% reference an issue`));

  const coAuthored = commits.filter((c) => CO_AUTHOR.test(msg(c)));
  const aiShare = pct(coAuthored.length, commits.length);
  checks.push(check("Way of working", "W5", "AI co-authored commits", 2,
    aiShare >= 0.5 ? 2 : aiShare >= 0.2 ? 1 : 0,
    `${coAuthored.length} of ${commits.length} commits (${Math.round(aiShare * 100)}%) have a Co-Authored-By trailer`));

  const issueNumbers = new Set(issues.map((i) => i.number));
  let best = null;
  for (const p of d.projects ?? []) {
    const onBoard = p.items.filter((it) => it.issue != null && issueNumbers.has(it.issue)).length;
    const statuses = new Set(p.items.map((it) => it.status).filter(Boolean));
    if (!best || onBoard > best.onBoard) best = { title: p.title, onBoard, statuses: statuses.size };
  }
  const boardShare = best ? pct(best.onBoard, issues.length) : 0;
  checks.push(check("Way of working", "W6", "GitHub Project with the issues and a used Status field", 6,
    (boardShare >= 0.8 ? 4 : boardShare >= 0.5 ? 2 : 0) + (best && best.statuses >= 2 ? 2 : 0),
    d.projectsError ? `could not read Projects: ${d.projectsError}` :
      best ? `"${best.title}": ${best.onBoard} of ${issues.length} issues (${Math.round(boardShare * 100)}%), ${best.statuses} different Status values` : "no Project linked to the repository"));

  const days = new Set(commits.map((c) => (c.commit?.author?.date ?? "").slice(0, 10)).filter(Boolean));
  checks.push(check("Way of working", "W7", "commits on three or more days", 3,
    days.size >= 3 ? 3 : days.size === 2 ? 1 : 0, `${days.size} day(s): ${[...days].sort().join(", ")}`));

  // ---- Game (20) ----
  const live = d.live ?? {};
  checks.push(check("Game", "G1", "the game is online and /health answers", 8,
    (live.pageOk ? 4 : 0) + (live.healthOk ? 4 : 0),
    !live.url ? "no game URL (pass --url or put a \"Play\" link in the README)" : `${live.url}: page ${live.pageStatus ?? "no answer"}, /health ${live.healthStatus ?? "no answer"}`));

  const readme = file("README.md") ?? "";
  const howTo = /^#+\s.*how to play/im.test(readme);
  checks.push(check("Game", "G2", "README: how to play, players, controls", 4,
    (howTo ? 2 : 0) + (/\bplayers?\b/i.test(readme) ? 1 : 0) + (/\b(controls?|keys?|keyboard|mouse|WASD|arrow)\b/i.test(readme) ? 1 : 0),
    `"How to play" heading: ${howTo ? "yes" : "no"}`));

  const deps = d.allDependencies ?? [];
  const mp = MULTIPLAYER_LIBS.filter((lib) => deps.includes(lib));
  checks.push(check("Game", "G3", "a real-time multiplayer library", 4,
    mp.length ? 4 : 0, mp.length ? mp.join(", ") : "none of the known libraries in any package.json (instructor checks other stacks by hand)"));

  const tests = tree.filter((p) => !/node_modules\//.test(p) && !/^evals\//.test(p) && (/\.(test|spec)\.[cm]?[jt]sx?$/.test(p) || /(^|\/)tests?\/.+\.[cm]?[jt]sx?$/.test(p) || /(^|\/)test_.+\.py$/.test(p)));
  checks.push(check("Game", "G4", "test files for the game rules", 4,
    tests.length >= 3 ? 4 : tests.length >= 1 ? 2 : 0, `${tests.length} test file(s)`));

  const total = checks.reduce((s, c) => s + c.got, 0);
  const max = checks.reduce((s, c) => s + c.max, 0);
  const grade = total >= 85 ? 5 : total >= 70 ? 4 : total >= 55 ? 3 : total >= 40 ? 2 : 1;
  return { total, max, grade, checks };
}

// ---- output ------------------------------------------------------------------------------

const GRADE_WORDS = { 5: "excellent", 4: "good", 3: "satisfactory", 2: "pass", 1: "fail" };

export function toMarkdown(results, opts = {}) {
  const lines = ["# Harness Engineering assignment – automatic evaluation", ""];
  if (opts.deadline) lines.push(`Deadline: ${opts.deadline}. Work after the deadline is not counted.`, "");
  lines.push("| Student | Repository | Points | Grade proposal |", "|---|---|---|---|");
  for (const r of results) {
    lines.push(r.error
      ? `| ${r.name ?? "–"} | ${r.repo} | – | error: ${r.error} |`
      : `| ${r.name ?? "–"} | [${r.repo}](https://github.com/${r.repo}) | ${r.report.total}/${r.report.max} | **${r.report.grade}** (${GRADE_WORDS[r.report.grade]}) |`);
  }
  lines.push("", "Grades: 85+ → 5, 70+ → 4, 55+ → 3, 40+ → 2. A proposal: the instructor reviews each report.", "");
  for (const r of results) {
    if (r.error) continue;
    lines.push(`## ${r.name ?? r.repo} – ${r.report.total}/${r.report.max}, grade ${r.report.grade}`, "");
    lines.push("| | Check | Points | Details |", "|---|---|---|---|");
    for (const c of r.report.checks) {
      lines.push(`| ${c.got === c.max ? "✅" : c.got > 0 ? "🟡" : "❌"} ${c.id} | ${c.title} | ${c.got}/${c.max} | ${String(c.detail).replace(/\|/g, "\\|")} |`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

// ---- data collection (GitHub CLI + HTTP) -------------------------------------------------

function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 128 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
}
const api = (path) => JSON.parse(gh(["api", "-H", "Accept: application/vnd.github+json", path]));
function apiOrNull(path) {
  try { return api(path); } catch { return null; }
}
function apiAll(path, limit = 1000) {
  const all = [];
  for (let page = 1; all.length < limit; page++) {
    const batch = api(`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
    const items = Array.isArray(batch) ? batch : batch.workflow_runs ?? [];
    all.push(...items);
    if (items.length < 100) break;
  }
  return all;
}
function readFile(repo, path, ref) {
  const f = apiOrNull(`repos/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}?ref=${encodeURIComponent(ref)}`);
  return f && f.content ? Buffer.from(f.content, "base64").toString("utf8") : null;
}

async function httpStatus(url) {
  try {
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(15000) });
    return res.status;
  } catch {
    return null;
  }
}

function readProjects(repo) {
  const [owner, name] = repo.split("/");
  const query = `query($owner:String!,$name:String!){repository(owner:$owner,name:$name){projectsV2(first:10){nodes{title items(first:100){nodes{content{... on Issue{number}} fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{name}}}}}}}}`;
  const out = JSON.parse(gh(["api", "graphql", "-f", `query=${query}`, "-F", `owner=${owner}`, "-F", `name=${name}`]));
  return (out.data?.repository?.projectsV2?.nodes ?? []).map((p) => ({
    title: p.title,
    items: (p.items?.nodes ?? []).map((it) => ({ issue: it.content?.number ?? null, status: it.fieldValueByName?.name ?? null })),
  }));
}

export async function collect(repo, url) {
  const info = api(`repos/${repo}`);
  const ref = info.default_branch;
  const tree = (apiOrNull(`repos/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`)?.tree ?? [])
    .filter((t) => t.type === "blob").map((t) => t.path);
  const files = {};
  for (const p of ["CLAUDE.md", "AGENTS.md", "HARNESS.md", "README.md", ".claude/settings.json"]) {
    files[p] = tree.includes(p) ? readFile(repo, p, ref) : null;
  }
  const packageFiles = tree.filter((p) => /(^|\/)package\.json$/.test(p) && !/node_modules\//.test(p)).sort((a, b) => a.split("/").length - b.split("/").length).slice(0, 15);
  let rootScripts = {};
  let rootScriptsFrom = null;
  const allDependencies = new Set();
  for (const p of packageFiles) {
    try {
      const pkg = JSON.parse(readFile(repo, p, ref) ?? "{}");
      if (!rootScriptsFrom && pkg.scripts) { rootScripts = pkg.scripts; rootScriptsFrom = p; }
      for (const k of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) allDependencies.add(k);
    } catch { /* not JSON: ignored */ }
  }
  const workflows = tree.filter((p) => /^\.github\/workflows\/.+\.ya?ml$/.test(p)).map((p) => ({ path: p, text: readFile(repo, p, ref) ?? "" }));
  const runs = apiOrNull(`repos/${repo}/actions/runs?branch=${encodeURIComponent(ref)}&per_page=30`)?.workflow_runs ?? [];
  const rules = apiOrNull(`repos/${repo}/rules/branches/${encodeURIComponent(ref)}`) ?? [];
  const branchProtected = apiOrNull(`repos/${repo}/branches/${encodeURIComponent(ref)}`)?.protected ?? false;
  const issues = apiAll(`repos/${repo}/issues?state=all`);
  const pulls = apiAll(`repos/${repo}/pulls?state=all`);
  const commits = apiAll(`repos/${repo}/commits?sha=${encodeURIComponent(ref)}`);
  let projects = [];
  let projectsError = null;
  try { projects = readProjects(repo); } catch (e) { projectsError = String(e.stderr || e.message).split("\n")[0]; }

  const readme = files["README.md"] ?? "";
  const gameUrl = url ?? readme.split("\n").filter((l) => /play|live|game|demo/i.test(l))
    .map((l) => /https?:\/\/[^\s)>\]]+/.exec(l)?.[0]).find((u) => u && !/github\.com/.test(u)) ?? null;
  const live = { url: gameUrl };
  if (gameUrl) {
    live.pageStatus = await httpStatus(gameUrl);
    live.healthStatus = await httpStatus(new URL("/health", gameUrl).toString());
    live.pageOk = live.pageStatus >= 200 && live.pageStatus < 300;
    live.healthOk = live.healthStatus === 200;
  }
  return { files, tree, workflows, runs, rules, branchProtected, issues, pulls, commits, projects, projectsError, rootScripts, rootScriptsFrom, allDependencies: [...allDependencies], live };
}

async function main(argv) {
  const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const opts = { deadline: arg("--deadline") };
  if (opts.deadline && Number.isNaN(Date.parse(opts.deadline))) { console.error(`Not a date: ${opts.deadline}`); process.exit(2); }
  const subs = arg("--submissions")
    ? JSON.parse(readFileSync(arg("--submissions"), "utf8"))
    : arg("--repo") ? [{ repo: arg("--repo"), url: arg("--url") }] : null;
  if (!subs) {
    console.error("Usage: node evaluate.mjs --repo owner/name [--url https://game/] [--deadline ISO-date] [--json]\n       node evaluate.mjs --submissions submissions.json [--deadline ISO-date] [--json]");
    process.exit(2);
  }
  const results = [];
  for (const s of subs) {
    const repo = String(s.repo).replace(/^https:\/\/github\.com\//, "").replace(/\.git$|\/$/g, "");
    process.stderr.write(`evaluating ${repo}...\n`);
    try {
      results.push({ ...s, repo, report: score(await collect(repo, s.url), opts) });
    } catch (e) {
      results.push({ ...s, repo, error: String(e.stderr || e.message).split("\n")[0] });
    }
  }
  process.stdout.write(argv.includes("--json") ? `${JSON.stringify(results, null, 2)}\n` : `${toMarkdown(results, opts)}\n`);
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  main(process.argv.slice(2));
}
