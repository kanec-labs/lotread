// api/reserve.js
//
// Receives the LotRead WTP smoke-test reservation form and commits each submission as
// a new entry in a JSON array file inside the kanec-labs/agent-studio repo (private),
// via the GitHub Contents API. See D-015 in agent-studio/company/DECISIONS.md for why
// that repo (not this public repo, not Web3Forms) and the accepted trade-off.
//
// Required Vercel environment variables (Project Settings > Environment Variables):
//   GITHUB_TOKEN      - fine-grained PAT, resource owner kanec-labs, repo agent-studio
//                        ONLY, permissions: Contents (Read and write), Metadata (Read).
//                        Do NOT reuse the agents-agent-studio-rw-v1 token used by the
//                        studio's own agents -- this is a separate, public-facing
//                        credential and should be revocable independently.
//   GITHUB_OWNER      - "kanec-labs"
//   GITHUB_REPO       - "agent-studio"
//   GITHUB_FILE_PATH  - "ops/data/lotread-submissions.json"
//   GITHUB_BRANCH     - "main"

const GITHUB_API = "https://api.github.com";

// RFC 5321 caps a forward-path address at 254 characters. Enforcing it here bounds
// what can land in ops/data/lotread-submissions.json — a file agents read — closing
// the content-injection vector in WO-014 Finding 3 (CLAUDE.md rule 9).
const MAX_EMAIL_LENGTH = 254;

// Rate limit: caps how many *new* submissions can land in a rolling window, closing
// WO-023 QSE review Finding 2 (no rate limit on an unauthenticated write endpoint).
// Vercel functions are stateless and run across many instances, so an in-memory
// per-IP counter would reset unpredictably between invocations and offer only
// illusory protection. Instead this counts entries by the `timestamp` already stored
// in ops/data/lotread-submissions.json, read from the one file every request already
// reads regardless — consistent across every instance, no new dependency, no new
// infrastructure, no extra GitHub API call. This is a global ceiling, not a per-IP
// one; it bounds the abuse scenario QSE described (a scripted burst of distinct
// addresses in an afternoon) without needing a stateful primitive this environment
// doesn't offer. Revisit the threshold if genuine traffic approaches it.
const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
const RATE_LIMIT_MAX_PER_WINDOW = 50;

function isValidEmail(email) {
  return (
    typeof email === "string" &&
    email.length <= MAX_EMAIL_LENGTH &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  );
}

function hasEmail(submissions, emailLower) {
  return submissions.some(
    (s) =>
      s &&
      typeof s.email === "string" &&
      s.email.trim().toLowerCase() === emailLower
  );
}

async function githubRequest(path, options = {}) {
  return fetch(`${GITHUB_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {}),
    },
  });
}

async function readSubmissions(owner, repo, filePath, branch) {
  const res = await githubRequest(
    `/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}?ref=${branch}`
  );
  if (res.status === 404) {
    return { submissions: [], sha: null };
  }
  if (!res.ok) {
    throw new Error(`GitHub read failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();

  // Past this point the file is confirmed to exist (this is not the 404 branch), so
  // any failure to decode or parse it must not fall through to an empty array --
  // doing so lets the very next write silently overwrite every prior submission
  // (WO-023 QSE review, Finding 3). GitHub's Contents API returns content: "" with
  // encoding: "none" -- not an error -- for files between 1-100MB, which is the
  // specific trigger; a corrupt byte in an existing file has the same effect. Either
  // way: fail loudly here and let the caller's try/catch return a 500, instead of
  // quietly resetting to [] and letting the caller overwrite a real, non-empty file.
  if (data.encoding !== "base64") {
    throw new Error(
      `GitHub read returned encoding "${data.encoding}" instead of "base64" for an ` +
        `existing file -- refusing to treat this as an empty dataset`
    );
  }

  const decoded = Buffer.from(data.content, "base64").toString("utf-8");
  let submissions;
  try {
    submissions = JSON.parse(decoded);
  } catch (e) {
    throw new Error(
      `Existing submissions file failed to parse as JSON -- refusing to treat this ` +
        `as an empty dataset: ${e.message}`
    );
  }
  if (!Array.isArray(submissions)) {
    throw new Error(
      "Existing submissions file did not contain a JSON array -- refusing to treat " +
        "this as an empty dataset"
    );
  }
  return { submissions, sha: data.sha };
}

async function writeSubmissions(owner, repo, filePath, branch, submissions, sha, entry) {
  const content = Buffer.from(
    JSON.stringify(submissions, null, 2) + "\n",
    "utf-8"
  ).toString("base64");
  const body = {
    message: `Add lotread WTP reservation (${entry.timestamp})`,
    content,
    branch,
  };
  if (sha) body.sha = sha;
  return githubRequest(`/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (e) {
      body = {};
    }
  }
  body = body || {};

  const honeypot = body.botcheck;
  const email = typeof body.email === "string" ? body.email.trim() : "";

  // Honeypot: the client always sends botcheck as a string (see the fetch call in
  // index.html) -- populated only if something fills in a field real users never see
  // (tabindex="-1", positioned off-screen). This used to reject only a *non-empty*
  // botcheck, which meant a bot posting straight to this endpoint -- skipping the
  // client's hidden field entirely -- arrived with botcheck === undefined and sailed
  // through identically to a legitimate blank submission (WO-023 QSE review,
  // Finding 2). Failing closed on "missing, wrong type, or non-empty" instead of just
  // "non-empty" closes that gap without changing anything a real browser ever sends.
  if (typeof honeypot !== "string" || honeypot !== "") {
    // Missing field, wrong type, or filled in: pretend success, write nothing, don't
    // tip off the bot.
    res.status(200).json({ ok: true });
    return;
  }

  if (!isValidEmail(email)) {
    res.status(400).json({ ok: false, error: "Invalid email address" });
    return;
  }

  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const filePath = process.env.GITHUB_FILE_PATH;
  const branch = process.env.GITHUB_BRANCH || "main";

  if (!process.env.GITHUB_TOKEN || !owner || !repo || !filePath) {
    console.error("lotread reserve: missing required environment variables");
    res.status(500).json({ ok: false, error: "Server not configured" });
    return;
  }

  const entry = {
    email,
    timestamp: new Date().toISOString(),
    ip: req.headers["x-forwarded-for"] || req.socket?.remoteAddress || null,
    userAgent: req.headers["user-agent"] || null,
  };

  const emailLower = email.toLowerCase();

  try {
    const first = await readSubmissions(owner, repo, filePath, branch);

    // Dedupe: if this address is already on file, return the same response a fresh
    // success gives and write nothing. No new commit into agent-studio, so one address
    // cannot drive repeated writes; and because the response is identical to success,
    // this does not become an email-enumeration oracle.
    if (hasEmail(first.submissions, emailLower)) {
      res.status(200).json({ ok: true });
      return;
    }

    // Rate limit: count *new* submissions in the rolling window before accepting
    // another one. Known addresses already returned above without counting, so a
    // dedupe hit never eats into the ceiling.
    const windowStart = Date.now() - RATE_LIMIT_WINDOW_MS;
    const recentCount = first.submissions.filter((s) => {
      const t = s && typeof s.timestamp === "string" ? Date.parse(s.timestamp) : NaN;
      return !Number.isNaN(t) && t >= windowStart;
    }).length;
    if (recentCount >= RATE_LIMIT_MAX_PER_WINDOW) {
      res.status(429).json({ ok: false, error: "Too many submissions -- please try again later" });
      return;
    }

    first.submissions.push(entry);
    let writeRes = await writeSubmissions(
      owner,
      repo,
      filePath,
      branch,
      first.submissions,
      first.sha,
      entry
    );

    // Handle a stale-sha race (two submissions landing at once): re-read and retry once.
    if (writeRes.status === 409) {
      const retry = await readSubmissions(owner, repo, filePath, branch);
      if (hasEmail(retry.submissions, emailLower)) {
        res.status(200).json({ ok: true });
        return;
      }
      retry.submissions.push(entry);
      writeRes = await writeSubmissions(
        owner,
        repo,
        filePath,
        branch,
        retry.submissions,
        retry.sha,
        entry
      );
    }

    if (!writeRes.ok) {
      const errText = await writeRes.text();
      console.error("lotread reserve: GitHub write failed", writeRes.status, errText);
      res.status(502).json({ ok: false, error: "Could not record submission" });
      return;
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("lotread reserve: unexpected error", err);
    res.status(500).json({ ok: false, error: "Unexpected server error" });
  }
};
