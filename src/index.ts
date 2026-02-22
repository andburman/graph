// [sl:WvU_sWubakQWRCkP993pp] CLI routing — activate subcommand or MCP server
export {};

const args = process.argv.slice(2);

if (args[0] === "activate") {
  const { activate } = await import("./activate.js");
  activate(args[1]);
} else if (args[0] === "init") {
  const { init } = await import("./init.js");
  init();
} else if (args[0] === "backup") {
  const { setDbPath, resolveDbPath, initDb, backupDb, listBackups, restoreDb } = await import("./db.js");
  const dbp = resolveDbPath();
  setDbPath(dbp);

  const sub = args[1];
  if (sub === "create") {
    initDb();
    const dest = backupDb("manual");
    if (dest) {
      console.log(`✓ Backup created: ${dest}`);
    } else {
      console.log("✗ No database found to backup");
    }
  } else if (sub === "restore") {
    const target = args[2];
    if (!target) {
      console.error("Usage: graph backup restore <filename|number>");
      console.error("  number: 1 = most recent, 2 = second most recent, etc.");
      process.exit(1);
    }
    const restored = restoreDb(target);
    console.log(`✓ Restored from ${restored}`);
    console.log("  Restart Claude Code to use the restored database.");
  } else {
    // Default: list backups
    const backups = listBackups();
    if (backups.length === 0) {
      console.log("No backups found.");
      console.log("Backups are created automatically on daily startup and before schema migrations.");
      console.log("");
      console.log("Manual backup: graph backup create");
    } else {
      console.log(`Backups (${backups.length}):\n`);
      backups.forEach((b, i) => {
        const sizeKb = Math.round(b.size / 1024);
        console.log(`  ${i + 1}. ${b.filename}  ${sizeKb}KB  [${b.tag}]`);
      });
      console.log("");
      console.log("Restore:  graph backup restore <number>");
      console.log("Create:   graph backup create");
    }
  }
} else if (args[0] === "ui") {
  const { startUi } = await import("./ui.js");
  startUi(args.slice(1));
} else {
  const { startServer } = await import("./server.js");
  startServer().catch((error) => {
    console.error("Failed to start graph:", error);
    process.exit(1);
  });
}
