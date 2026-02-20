import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { handleAgentConfig } from "./tools/agent-config.js";

// [sl:hy8oXisWnrZN1BfkonUqd] npx @graph-tl/graph init — zero friction onboarding

const MCP_CONFIG = {
  command: "npx",
  args: ["-y", "@graph-tl/graph"],
  env: {
    GRAPH_AGENT: "claude-code",
  },
};

export function init(): void {
  const cwd = process.cwd();
  let wrote = false;

  // 1. Write .mcp.json
  const configPath = join(cwd, ".mcp.json");
  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, "utf8"));
      if (config.mcpServers?.graph) {
        console.log("✓ .mcp.json — graph already configured");
      } else {
        config.mcpServers = config.mcpServers ?? {};
        config.mcpServers.graph = MCP_CONFIG;
        writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
        console.log("✓ .mcp.json — added graph server");
        wrote = true;
      }
    } catch {
      console.error(`✗ .mcp.json exists but is not valid JSON — skipping`);
    }
  } else {
    const config = { mcpServers: { graph: MCP_CONFIG } };
    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
    console.log("✓ .mcp.json — created with graph server");
    wrote = true;
  }

  // 2. Write .claude/agents/graph.md
  const agentPath = join(cwd, ".claude", "agents", "graph.md");
  if (existsSync(agentPath)) {
    console.log("✓ .claude/agents/graph.md — already exists");
  } else {
    const { agent_file } = handleAgentConfig();
    mkdirSync(dirname(agentPath), { recursive: true });
    writeFileSync(agentPath, agent_file, "utf8");
    console.log("✓ .claude/agents/graph.md — created graph workflow agent");
    wrote = true;
  }

  // 3. Summary
  console.log("");
  if (wrote) {
    console.log("Graph is ready. Restart Claude Code to load the MCP server.");
    console.log("");
    console.log("Then try:");
    console.log('  "Use graph to plan building a REST API with auth and tests."');
  } else {
    console.log("Graph is already set up — nothing to do.");
  }
}
