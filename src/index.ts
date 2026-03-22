#!/usr/bin/env bun
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ILinkClient } from "./ilink.js";
import { login } from "./auth.js";
import { MessagePoller } from "./poller.js";
import { TOOLS, handleToolCall } from "./tools.js";

const INSTRUCTIONS = `This channel bridges WeChat messages into your session. Your transcript is not visible to the WeChat user — all responses must go through the reply tool.

Inbound messages appear as <channel source="wechat" chat_id="..." context_token="...">. To respond, call the reply tool with the chat_id value. You do not need to quote-reply the most recent message.

Only the reply tool is available — WeChat's API does not support editing sent messages or adding reactions.

Write short, plain-text responses. WeChat does not render markdown, so avoid formatting like bold, headers, or bullet syntax.

If a message includes an image_path attribute, use the Read tool to view the attached photo. Voice messages include a transcription prefixed with [语音转文字]. File attachments show as [文件] followed by the filename.

Preserve any important details from tool results in your response text, since earlier tool output may be compacted later.`;

async function main() {
  console.error("[wechat] Starting WeChat channel plugin...");

  // Create MCP server FIRST — Claude Code expects a fast stdio handshake
  const server = new Server(
    { name: "wechat", version: "0.1.0" },
    {
      capabilities: {
        experimental: { "claude/channel": {} },
        tools: {},
      },
      instructions: INSTRUCTIONS,
    }
  );

  // These will be set after login completes
  let client: ILinkClient | null = null;
  let poller: MessagePoller | null = null;

  // Register tools (available immediately, but reply will fail until login completes)
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    if (!client || !poller) {
      return {
        content: [{ type: "text", text: "WeChat is still logging in, please wait..." }],
        isError: true,
      };
    }
    const { name, arguments: args } = req.params;
    return handleToolCall(name, (args || {}) as Record<string, unknown>, client, poller);
  });

  // Connect to Claude Code over stdio BEFORE login
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[wechat] MCP server connected via stdio.");

  // Now authenticate (this may block waiting for QR scan)
  const { token, baseUrl } = await login();
  client = new ILinkClient(token, baseUrl);

  // Create and start poller
  poller = new MessagePoller(client, server);
  poller.start();
  console.error("[wechat] Message polling started.");
}

main().catch((err) => {
  console.error("[wechat] Fatal error:", err);
  process.exit(1);
});
