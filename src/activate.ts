import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { verifyLicenseKey } from "./license.js";

// [sl:WvU_sWubakQWRCkP993pp] CLI activation — store license key locally

const KEY_PREFIX = "graph_";

function validateKeyFormat(key: string): boolean {
  const raw = key.startsWith(KEY_PREFIX) ? key.slice(KEY_PREFIX.length) : key;
  const parts = raw.split(".");
  return parts.length === 3 && parts.every((p) => p.length > 0);
}

export function activate(key: string): void {
  if (!key) {
    console.error("Usage: graph activate <license-key>");
    process.exit(1);
  }

  // Basic format check
  if (!validateKeyFormat(key)) {
    console.error("Invalid key format. Expected: graph_<header>.<payload>.<signature>");
    process.exit(1);
  }

  // Try to verify if public key is available
  const info = verifyLicenseKey(key);
  if (info) {
    const expDate = new Date(info.exp * 1000).toISOString().split("T")[0];
    console.log(`Verified: ${info.tier} tier, expires ${expDate}`);
  } else if (process.env.GRAPH_LICENSE_PUBLIC_KEY) {
    console.error("Key signature verification failed. The key may be invalid or expired.");
    process.exit(1);
  }

  // Store to ~/.graph/license
  const dir = join(homedir(), ".graph");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "license");
  writeFileSync(path, key, "utf8");

  console.log(`License key saved to ${path}`);
  if (!info) {
    console.log("Key stored (signature not verified — public key not configured).");
  }
}
