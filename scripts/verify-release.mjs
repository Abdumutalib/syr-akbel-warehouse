#!/usr/bin/env node

const targetBase = String(process.env.VERIFY_PROD_BASE_URL || "https://akbelim.com").trim().replace(/\/+$/, "");
const expectedCommit = String(process.env.EXPECTED_COMMIT_SHA || process.argv[2] || "").trim();

if (!expectedCommit) {
  console.error("EXPECTED_COMMIT_SHA env yoki argument bilan commit SHA bering.");
  process.exit(1);
}

async function main() {
  const response = await fetch(`${targetBase}/healthz`, {
    headers: {
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
  });

  if (!response.ok) {
    throw new Error(`/healthz failed: HTTP ${response.status}`);
  }

  const payload = await response.json();
  const actualBuild = String(payload?.build || "").trim();

  if (!actualBuild) {
    throw new Error("/healthz build qiymati bo'sh, deploy commit aniqlanmadi");
  }

  if (actualBuild !== expectedCommit) {
    throw new Error(`deploy mismatch: expected=${expectedCommit} actual=${actualBuild}`);
  }

  console.log(`[OK] production build matched commit: ${actualBuild}`);
}

main().catch((error) => {
  console.error("Release verification failed:", error.message || error);
  process.exit(1);
});
