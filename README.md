# lotread

Tennessee site-work cost report -- pre-launch willingness-to-pay (WTP) test.

**Status:** pre-launch smoke test. No real product has shipped yet; this repo currently
holds only the landing page used to gauge demand, per a 2026-09-04 G0 decision in the
`agent-studio` repo.

**Docs, gates, and process for this product live in the private `kanec-labs/agent-studio`
repo, not here** -- see `products/lotread/` there (opportunity brief, `STATUS.md`, gate
decisions, work orders). This repo is code only, per that repo's D-005/D-014.

## What's here

- `index.html` -- the smoke-test landing page. Static HTML/CSS/vanilla JS, no framework.
- `api/reserve.js` -- a Vercel serverless function the page's reservation form POSTs to.
  It validates the email, drops anything that trips the honeypot field, and commits each
  real submission as a new entry in a JSON file inside the **private**
  `kanec-labs/agent-studio` repo (not this repo) via the GitHub API. See D-015 in
  `agent-studio/company/DECISIONS.md` for why submissions land there rather than in a
  third-party form service or in this public repo.

## Deploying

Import this repo into Vercel. Framework Preset: **Other**. Root directory: repo root.
`api/reserve.js` deploys automatically as a Serverless Function -- no build step needed.

**Required environment variables** (Vercel Project Settings > Environment Variables --
set these before the reservation form will work; see `api/reserve.js`'s header comment
for exact details):

- `GITHUB_TOKEN` -- a fine-grained PAT, resource owner `kanec-labs`, scoped to the
  `agent-studio` repo ONLY, with Contents (Read and write) + Metadata (Read). Create a
  new one for this purpose; do not reuse the studio agents' own token.
- `GITHUB_OWNER` = `kanec-labs`
- `GITHUB_REPO` = `agent-studio`
- `GITHUB_FILE_PATH` = `ops/data/lotread-submissions.json`
- `GITHUB_BRANCH` = `main`

## Why this repo is public

Vercel's free (Hobby) tier won't deploy from a private repo owned by a GitHub
organization -- only public repos, or private repos under a personal account, deploy for
free. Public was chosen (over Vercel Pro or a personal-account repo) to keep product code
under the `kanec-labs` org while staying at zero cost; see D-014 in
`agent-studio/company/DECISIONS.md`. Submitted emails do NOT live in this repo -- see
D-015 for where they actually go and why.
