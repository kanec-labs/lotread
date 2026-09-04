# lotread

Tennessee site-work cost report — pre-launch willingness-to-pay (WTP) test.

**Status:** pre-launch smoke test. No real product has shipped yet; this repo currently
holds only the landing page used to gauge demand, per a 2026-09-04 G0 decision in the
`agent-studio` repo.

**Docs, gates, and process for this product live in the private `kanec-labs/agent-studio`
repo, not here** — see `products/lotread/` there (opportunity brief, `STATUS.md`, gate
decisions, work orders). This repo is code only, per that repo's D-005/D-014.

## What's here

- `index.html` — the smoke-test landing page. Static HTML/CSS/vanilla JS, no backend, no
  framework. Collects email reservations via [Web3Forms](https://web3forms.com) — see
  the `WEB3FORMS_ACCESS_KEY` constant near the top of the `<script>` block. Replace the
  placeholder with a real access key before this goes live; it's safe to hardcode,
  Web3Forms' access keys are designed for public client-side use (they only route a
  submission to one destination inbox, no read/write access to anything else).
- `noindex, nofollow` meta tag is intentional — this page isn't meant to be crawled or
  indexed while it's still a demand test, not a live product.

## Deploying

Import this repo into Vercel. Framework Preset: **Other** (no build step, no
`package.json`). Root directory: repo root.

## Why this repo is public

Vercel's free (Hobby) tier won't deploy from a private repo owned by a GitHub
organization — only public repos, or private repos under a personal account. Public was
chosen (over Vercel Pro or a personal-account repo) to keep product code under the
`kanec-labs` org while staying at zero cost; see D-014 in `agent-studio/company/DECISIONS.md`.
Revisit if this product ever holds real IP worth keeping private before launch.
