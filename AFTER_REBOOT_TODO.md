# After Linux Reboot — Next Steps

Context: pushed 3 commits from Windows (setup-gate fix, LLM refactor, v0.1.7
desktop additions) before rebooting. The LLM refactor will fail CI until
Python lockfiles are regenerated — Docker wouldn't cooperate on Windows.

Work through in order:

## 1. Fix CI — regenerate Python lockfiles (urgent)

Dev branch is red until this is done.

```bash
git checkout dev
git pull origin dev

# Start Docker (native on Linux)
docker compose up -d flask

# Regenerate both lockfiles (tiktoken → instructor swap in requirements.in)
docker compose exec flask pip-compile requirements.in -o requirements.txt
docker compose exec flask pip-compile requirements-dev.in -o requirements-dev.txt

# Spot-check the diff
git diff backend/requirements.txt backend/requirements-dev.txt

# Commit and push
git add backend/requirements.txt backend/requirements-dev.txt
git commit -m "chore(deps): regenerate lockfiles for instructor swap"
git push origin dev
```

Watch CI: `gh run watch`. If other things are still red after the lockfile
regen, those are legitimate failures and will need investigation — the
LLM refactor renamed `structured_openai` → `structured_completion` across
many files and might have missed a call site.

## 2. Merge PR #202 and ship v0.1.7

Assuming CI is green after step 1, PR #202 is on `dev` → `main`. The PR
now contains:

- v0.1.7 desktop app (tray, overlay reposition, hide toggle, post-meeting
  modal with action items + decisions, dev simulation, coaching tip card)
- Setup-gate `accountsConnected` bug fix + 4-card SetupWall restructure
- LLM abstraction refactor (tiktoken → instructor)

That's genuinely three concerns; you may want to **split into three PRs**
rather than merging one big bundle. Judgment call on whether it's worth
the churn to split at this point.

Release flow for v0.1.7 after merge:

```bash
git checkout main
git pull origin main
git tag desktop-v0.1.7
git push origin desktop-v0.1.7
gh run watch --workflow desktop-release.yml
# After build + draft complete:
gh release edit desktop-v0.1.7 --repo Minerva-Coach/minerva-desktop --draft=false
```

Installed v0.1.6 should auto-update on next launch.

## 3. Security audit (next big task)

Hasn't started. `Task #25` in the todo list. Produces
`desktop_app/SECURITY_AUDIT.md` with findings rated Critical/High/Medium/
Low/Informational. Holistic review of: token storage, network TLS, OAuth
localhost callback, updater signature chain, Tauri capabilities, CSP,
IPC command handlers, logging, dev-vs-release gates, dependency CVEs.

## 4. Weekly Summary feature (deferred)

Design captured in `desktop_app/WEEKLY_SUMMARY_DESIGN.md`. Needs:

- Docker running (for migration autogeneration)
- Security audit complete first

Build order documented in that file.

## Open in another session

- Parallel session was doing the LLM refactor bugfix. That work is now
  committed on dev. If that session is still open, sync it or close it.

## Housekeeping

- v0.1.7 work including action items / decisions / dev sim / rotating
  tips is all in commit 3 below. PanelWindow.tsx + Gauges.tsx changes
  are there too.
- Frontend `node_modules` missing on the Windows machine. Disk was full
  (`ENOSPC`). Free up some space before retrying any frontend tooling
  back on Windows.
- When this doc's work is complete, delete this file.
