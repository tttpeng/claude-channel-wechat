#!/usr/bin/env bun
/**
 * One-time setup script: registers the WeChat channel in ~/.claude.json
 * so it can be used from any directory.
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const CLAUDE_CONFIG = join(homedir(), ".claude.json");
const PROJECT_DIR = join(import.meta.dir, "..");
const ENTRY = join(PROJECT_DIR, "src", "index.ts");

function setup() {
  console.log("=== WeChat Channel Setup ===\n");

  // Read or create ~/.claude.json
  let config: Record<string, any> = {};
  if (existsSync(CLAUDE_CONFIG)) {
    try {
      config = JSON.parse(readFileSync(CLAUDE_CONFIG, "utf-8"));
    } catch {
      console.log(`Warning: Could not parse ${CLAUDE_CONFIG}, will create new config.`);
    }
  }

  // Add MCP server entry
  if (!config.mcpServers) {
    config.mcpServers = {};
  }

  config.mcpServers.wechat = {
    command: "bun",
    args: [ENTRY],
  };

  writeFileSync(CLAUDE_CONFIG, JSON.stringify(config, null, 2));
  console.log(`✓ Added "wechat" MCP server to ${CLAUDE_CONFIG}`);
  console.log(`  command: bun`);
  console.log(`  args: [${ENTRY}]\n`);

  console.log("Setup complete! To use:\n");
  console.log("  claude --dangerously-load-development-channels server:wechat\n");
  console.log("First time will open a QR code page in your browser — scan with WeChat to pair.");
  console.log("Token is cached at ~/.claude/channels/wechat/token.json\n");
}

setup();
