import type { ILinkClient } from "./ilink.js";
import type { MessagePoller } from "./poller.js";

export const TOOLS = [
  {
    name: "reply",
    description: "Send a text response back to a WeChat conversation. Use the chat_id from the incoming channel event.",
    inputSchema: {
      type: "object" as const,
      properties: {
        chat_id: {
          type: "string",
          description: "Recipient identifier from the inbound channel event (xxx@im.wechat format)",
        },
        text: {
          type: "string",
          description: "Plain text content to deliver (no markdown)",
        },
      },
      required: ["chat_id", "text"],
    },
  },
];

export async function handleToolCall(
  toolName: string,
  args: Record<string, unknown>,
  client: ILinkClient,
  poller: MessagePoller
): Promise<{ content: Array<{ type: string; text: string }> }> {
  if (toolName === "reply") {
    const chatId = args.chat_id as string;
    const text = args.text as string;

    if (!chatId || !text) {
      throw new Error("Both chat_id and text are required for reply");
    }

    const contextToken = poller.getContextToken(chatId);
    if (!contextToken) {
      throw new Error(
        `Cannot reply to ${chatId} — no active conversation token. A new inbound message is needed first.`
      );
    }

    const ok = await client.sendMessage(chatId, contextToken, text);
    if (!ok) {
      return {
        content: [{ type: "text", text: `Delivery to ${chatId} failed. The conversation token may be stale — wait for a fresh inbound message.` }],
        isError: true,
      } as any;
    }
    return { content: [{ type: "text", text: "delivered" }] };
  }

  throw new Error(`Unrecognized tool: ${toolName}`);
}
