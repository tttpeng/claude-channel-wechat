#!/usr/bin/env bun
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ILinkClient } from "./ilink.js";
import { loadStoredToken } from "./auth.js";
import { MessagePoller } from "./poller.js";
import { TOOLS, handleToolCall } from "./tools.js";

const INSTRUCTIONS = `This channel bridges WeChat messages into your session. Your transcript is not visible to the WeChat user — all responses must go through the reply tool.

Inbound messages appear as <channel source="wechat" chat_id="..." context_token="...">. To respond, call the reply tool with the chat_id value. You do not need to quote-reply the most recent message.

Only the reply tool is available — WeChat's API does not support editing sent messages or adding reactions.

Write short, plain-text responses. WeChat does not render markdown, so avoid formatting like bold, headers, or bullet syntax.

If a message includes an image_path attribute, use the Read tool to view the attached photo. Voice messages include a transcription prefixed with [语音转文字]. File attachments show as [文件] followed by the filename.

Preserve any important details from tool results in your response text, since earlier tool output may be compacted later.

When the channel is not connected, guide the user to run /wechat:wechat-configure to set up.`;

async function main() {
  console.error("[wechat] Starting WeChat channel plugin...");

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

  let client: ILinkClient | null = null;
  let poller: MessagePoller | null = null;

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    if (!client || !poller) {
      return {
        content: [{ type: "text", text: "WeChat not connected. Run /wechat:wechat-configure login to authenticate." }],
        isError: true,
      };
    }
    const { name, arguments: args } = req.params;
    return handleToolCall(name, (args || {}) as Record<string, unknown>, client, poller);
  });

  // Connect MCP immediately
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[wechat] MCP server connected via stdio.");

  // Try to load existing token — don't block if missing
  const stored = loadStoredToken();
  if (stored) {
    console.error("[wechat] Found saved token, connecting...");
    client = new ILinkClient(stored.bot_token, stored.baseurl);
    poller = new MessagePoller(client, server);
    poller.start();
    console.error("[wechat] Message polling started.");
  } else {
    console.error("[wechat] No token found. Run /wechat:wechat-configure login to authenticate.");
  }
}

main().catch((err) => {
  console.error("[wechat] Fatal error:", err);
  process.exit(1);
});
