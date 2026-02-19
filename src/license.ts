import { verify } from "crypto";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";

// [sl:VQtVq1bsZeGG4v5ngDh5z] Offline license key validation

export type Tier = "free" | "pro";

export interface LicenseInfo {
  tier: Tier;
  exp: number;
  sub?: string;
}

// Ed25519 public key (base64-encoded DER/SPKI format).
// Set via env var. Replace with your actual public key after generating a keypair.
const PUBLIC_KEY = process.env.GRAPH_LICENSE_PUBLIC_KEY ?? "";

const KEY_PREFIX = "graph_";

/**
 * Decode and verify a license key.
 * Returns the license info if valid, null if invalid/expired/missing.
 */
export function verifyLicenseKey(key: string | undefined): LicenseInfo | null {
  if (!key || !PUBLIC_KEY) return null;

  try {
    // Strip prefix
    const raw = key.startsWith(KEY_PREFIX) ? key.slice(KEY_PREFIX.length) : key;

    // JWT: header.payload.signature (all base64url)
    const parts = raw.split(".");
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, signatureB64] = parts;

    // Verify Ed25519 signature
    const signedData = Buffer.from(`${headerB64}.${payloadB64}`);
    const signature = Buffer.from(signatureB64, "base64url");
    const publicKeyBuffer = Buffer.from(PUBLIC_KEY, "base64");

    const isValid = verify(
      null, // Ed25519 doesn't use a digest algorithm
      signedData,
      { key: publicKeyBuffer, format: "der", type: "spki" },
      signature
    );

    if (!isValid) return null;

    // Decode payload
    const payload = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf8")
    );

    // Check expiry
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) return null;

    // Extract tier
    const tier: Tier = payload.tier === "pro" ? "pro" : "free";

    return {
      tier,
      exp: payload.exp,
      sub: payload.sub,
    };
  } catch {
    return null;
  }
}

/**
 * Read license key from env or file.
 * Checks: GRAPH_LICENSE env var → ~/.graph/license → <db-dir>/license
 */
export function readLicenseKey(dbPath?: string): string | undefined {
  const envKey = process.env.GRAPH_LICENSE;
  if (envKey) return envKey.trim();

  try {
    const globalPath = join(homedir(), ".graph", "license");
    if (existsSync(globalPath)) {
      return readFileSync(globalPath, "utf8").trim();
    }

    if (dbPath) {
      const localPath = join(dirname(dbPath), "license");
      if (existsSync(localPath)) {
        return readFileSync(localPath, "utf8").trim();
      }
    }
  } catch {
    // File read failed — treat as no license
  }

  return undefined;
}

/**
 * Get the current license tier. Returns "free" if no valid license found.
 */
export function getLicenseTier(dbPath?: string): Tier {
  const key = readLicenseKey(dbPath);
  const info = verifyLicenseKey(key);
  return info?.tier ?? "free";
}
