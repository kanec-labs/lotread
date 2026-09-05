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

function isValidEmail(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
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
  const decoded = Buffer.from(data.content, "base64").toString("utf-8");
  let submissions = [];
  try {
    submissions = JSON.parse(decoded);
    if (!Array.isArray(submissions)) submissions = [];
  } catch (e) {
    submissions = [];
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

  // Honeypot tripped: pretend success, write nothing, don't tip off the bot.
  if (honeypot) {
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

  try {
    const first = await readSubmissions(owner, repo, filePath, branch);
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
