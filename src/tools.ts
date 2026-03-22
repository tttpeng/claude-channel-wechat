import { existsSync } from "fs";
import { basename } from "path";
import type { ILinkClient } from "./ilink.js";
import type { MessagePoller } from "./poller.js";
import { uploadMedia } from "./media.js";

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
        files: {
          type: "array",
          items: { type: "string" },
          description: "Absolute file paths to attach. Images (jpg/png/gif/webp) send as image messages; other types as file messages.",
        },
      },
      required: ["chat_id", "text"],
    },
  },
];

function isImageFile(filePath: string): boolean {
  const ext = filePath.toLowerCase().split(".").pop() || "";
  return ["jpg", "jpeg", "png", "gif", "webp", "bmp"].includes(ext);
}

function resolveContext(chatId: string, poller: MessagePoller): string {
  const contextToken = poller.getContextToken(chatId);
  if (!contextToken) {
    throw new Error(
      `Cannot reply to ${chatId} — no active conversation token. A new inbound message is needed first.`
    );
  }
  return contextToken;
}

export async function handleToolCall(
  toolName: string,
  args: Record<string, unknown>,
  client: ILinkClient,
  poller: MessagePoller
): Promise<{ content: Array<{ type: string; text: string }> }> {
  if (toolName === "reply") {
    const chatId = args.chat_id as string;
    const text = (args.text as string) || "";
    const files = (args.files as string[]) || [];

    if (!chatId) {
      throw new Error("chat_id is required");
    }
    if (!text && files.length === 0) {
      throw new Error("Either text or files must be provided");
    }

    const contextToken = resolveContext(chatId, poller);

    // Send text if provided
    if (text) {
      const ok = await client.sendMessage(chatId, contextToken, text, 2);
      if (!ok) {
        return {
          content: [{ type: "text", text: `Text delivery to ${chatId} failed. The conversation token may be stale.` }],
          isError: true,
        } as any;
      }
    }

    // Send attachments
    const results: string[] = [];
    for (const filePath of files) {
      if (!existsSync(filePath)) {
        results.push(`${basename(filePath)}: file not found`);
        continue;
      }

      const mediaType = isImageFile(filePath) ? "image" : "file";
      try {
        const uploaded = await uploadMedia(
          client.getToken(),
          client.getBaseUrl(),
          chatId,
          filePath,
          mediaType
        );

        const aesKeyB64 = uploaded.aesKey.toString("base64");

        let item: Record<string, unknown>;
        if (mediaType === "image") {
          item = {
            type: 2,
            image_item: {
              media: {
                encrypt_query_param: uploaded.downloadParam,
                aes_key: aesKeyB64,
                encrypt_type: 1,
              },
              mid_size: uploaded.cipherSize,
            },
          };
        } else {
          item = {
            type: 4,
            file_item: {
              media: {
                encrypt_query_param: uploaded.downloadParam,
                aes_key: aesKeyB64,
                encrypt_type: 1,
              },
              file_name: basename(filePath),
              len: String(uploaded.rawSize),
            },
          };
        }

        const ok = await client.sendMediaItem(chatId, contextToken, item);
        results.push(`${basename(filePath)}: ${ok ? "sent" : "failed"}`);
      } catch (e) {
        console.error(`[wechat] Upload failed for ${filePath}:`, e);
        results.push(`${basename(filePath)}: upload failed`);
      }
    }

    const summary = text ? "delivered" : "";
    const fileSummary = results.length > 0 ? results.join(", ") : "";
    return {
      content: [{ type: "text", text: [summary, fileSummary].filter(Boolean).join("; ") }],
    };
  }

  throw new Error(`Unrecognized tool: ${toolName}`);
}
