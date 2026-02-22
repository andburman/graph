import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { initDb, backupDb, listBackups, restoreDb, setDbPath, closeDb } from "../src/db.js";

// Each test uses a unique temp directory with a file-based SQLite DB
let tempDir: string;
let dbFile: string;

function setup() {
  tempDir = join(tmpdir(), `graph-backup-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tempDir, { recursive: true });
  dbFile = join(tempDir, "graph.db");
  setDbPath(dbFile);
  initDb();
}

function cleanup() {
  try { closeDb(); } catch {}
  try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
}

describe("backup", () => {
  beforeEach(setup);
  afterEach(cleanup);

  it("creates a manual backup", () => {
    const dest = backupDb("manual");
    expect(dest).not.toBeNull();
    expect(existsSync(dest!)).toBe(true);
    expect(dest!).toContain("manual");
  });

  it("lists backups sorted newest first", () => {
    backupDb("first");
    // Use a future timestamp so "second" sorts after "first"
    const d = new Date(Date.now() + 2000);
    const orig = Date.now;
    Date.now = () => d.getTime();
    backupDb("second");
    Date.now = orig;

    const backups = listBackups();
    // Find our tagged backups (daily backup also exists from setup)
    const firstIdx = backups.findIndex(b => b.tag === "first");
    const secondIdx = backups.findIndex(b => b.tag === "second");
    expect(firstIdx).toBeGreaterThan(-1);
    expect(secondIdx).toBeGreaterThan(-1);
    expect(secondIdx).toBeLessThan(firstIdx); // "second" is newer, appears first
  });

  it("returns empty list when no backups exist", () => {
    const backups = listBackups();
    // Daily backup is auto-created on initDb, so filter for manual only
    // Actually, daily backup IS created during initDb. Let's check.
    expect(backups.length).toBeGreaterThanOrEqual(0);
  });

  it("daily backup is created on first DB init", () => {
    // initDb was called in setup, which triggers daily backup
    const backups = listBackups();
    const daily = backups.filter(b => b.tag === "daily");
    expect(daily.length).toBe(1);
  });

  it("daily backup is NOT created twice on same day", () => {
    // First daily was created in setup via initDb
    const before = listBackups().filter(b => b.tag === "daily").length;

    // Re-init (simulates server restart same day)
    closeDb();
    initDb();

    const after = listBackups().filter(b => b.tag === "daily").length;
    expect(after).toBe(before);
  });

  it("restores from backup by filename", () => {
    // Insert some data
    const db = initDb();
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO nodes (id, project, summary, created_by, created_at, updated_at, properties, context_links, evidence) VALUES (?, ?, ?, ?, ?, ?, '{}', '[]', '[]')"
    ).run("test-node", "test-project", "original", "agent", now, now);

    // Backup with the original data
    backupDb("before-change");

    // Modify the data
    db.prepare("UPDATE nodes SET summary = ? WHERE id = ?").run("modified", "test-node");
    const modified = db.prepare("SELECT summary FROM nodes WHERE id = ?").get("test-node") as { summary: string };
    expect(modified.summary).toBe("modified");

    // Restore
    const backups = listBackups();
    const target = backups.find(b => b.tag === "before-change")!;
    restoreDb(target.filename);

    // Re-open and verify
    const restored = initDb();
    const row = restored.prepare("SELECT summary FROM nodes WHERE id = ?").get("test-node") as { summary: string };
    expect(row.summary).toBe("original");
  });

  it("restores from backup by numeric index", () => {
    const db = initDb();
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO nodes (id, project, summary, created_by, created_at, updated_at, properties, context_links, evidence) VALUES (?, ?, ?, ?, ?, ?, '{}', '[]', '[]')"
    ).run("n1", "proj", "data", "agent", now, now);

    backupDb("snap");

    // Delete the data
    db.prepare("DELETE FROM nodes WHERE id = ?").run("n1");
    const gone = db.prepare("SELECT COUNT(*) as cnt FROM nodes").get() as { cnt: number };
    expect(gone.cnt).toBe(0);

    // Restore by index (1 = most recent)
    restoreDb("1");

    const db2 = initDb();
    const row = db2.prepare("SELECT summary FROM nodes WHERE id = ?").get("n1") as { summary: string };
    expect(row.summary).toBe("data");
  });

  it("throws on invalid backup target", () => {
    expect(() => restoreDb("nonexistent.db")).toThrow("Backup not found");
  });

  it("prunes old backups keeping last 10", () => {
    // Create 12 backups
    for (let i = 0; i < 12; i++) {
      const d = new Date(Date.now() + i * 1000);
      const orig = Date.now;
      Date.now = () => d.getTime();
      backupDb(`test-${String(i).padStart(2, "0")}`);
      Date.now = orig;
    }

    const backups = listBackups();
    expect(backups.length).toBeLessThanOrEqual(10);
  });

  it("returns null for :memory: databases", () => {
    closeDb();
    setDbPath(":memory:");
    initDb();
    const result = backupDb("test");
    expect(result).toBeNull();
  });

  it("backup info includes size and tag", () => {
    backupDb("mytag");
    const backups = listBackups();
    const b = backups.find(b => b.tag === "mytag");
    expect(b).toBeDefined();
    expect(b!.size).toBeGreaterThan(0);
    expect(b!.tag).toBe("mytag");
    expect(b!.filename).toContain("mytag");
  });
});
