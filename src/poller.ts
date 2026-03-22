import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { ILinkClient, WeixinMessage, WeixinItem } from "./ilink.js";
import { MSG_TYPE_USER } from "./ilink.js";
import { downloadMedia } from "./media.js";

const SYNC_DIR = join(homedir(), ".claude", "channels", "wechat");
const SYNC_BUF_FILE = join(SYNC_DIR, "sync_buf.txt");
const POLL_FAILURE_THRESHOLD = 4;
const POLL_COOLDOWN_MS = 25_000;
const POLL_RETRY_MS = 2_500;

export class MessagePoller {
  private client: ILinkClient;
  private server: Server;
  private running = false;
  private allowedUsers: Set<string>;
  private consecutiveFailures = 0;

  // Map from_user_id -> latest context_token for replying
  private contextTokens = new Map<string, string>();

  constructor(
    client: ILinkClient,
    server: Server,
    allowedUsers?: string[]
  ) {
    this.client = client;
    this.server = server;
    this.allowedUsers = new Set(allowedUsers || []);

    // Restore sync cursor from disk
    this.restoreSyncBuf();
  }

  private restoreSyncBuf(): void {
    try {
      if (existsSync(SYNC_BUF_FILE)) {
        const cursor = readFileSync(SYNC_BUF_FILE, "utf-8").trim();
        if (cursor) {
          this.client.setCursor(cursor);
          console.error(`[wechat] Resumed from saved poll position`);
        }
      }
    } catch {
      // ignore
    }
  }

  private saveSyncBuf(cursor: string): void {
    try {
      mkdirSync(SYNC_DIR, { recursive: true });
      writeFileSync(SYNC_BUF_FILE, cursor, "utf-8");
    } catch {
      // ignore
    }
  }

  getContextToken(userId: string): string | undefined {
    return this.contextTokens.get(userId);
  }

  isAllowed(userId: string): boolean {
    if (this.allowedUsers.size === 0) return true;
    return this.allowedUsers.has(userId);
  }

  addAllowedUser(userId: string): void {
    this.allowedUsers.add(userId);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.poll();
  }

  stop(): void {
    this.running = false;
  }

  private async poll(): Promise<void> {
    while (this.running) {
      try {
        const { msgs, cursor } = await this.client.getUpdates();
        this.consecutiveFailures = 0;

        // Persist sync cursor
        if (cursor) this.saveSyncBuf(cursor);

        for (const msg of msgs) {
          await this.handleMessage(msg);
        }
      } catch (err) {
        this.consecutiveFailures++;
        console.error("[wechat] Poll error:", err);

        if (this.consecutiveFailures >= POLL_FAILURE_THRESHOLD) {
          console.error(`[wechat] Polling failed ${POLL_FAILURE_THRESHOLD} times, cooling down ${POLL_COOLDOWN_MS / 1000}s`);
          this.consecutiveFailures = 0;
          await new Promise((r) => setTimeout(r, POLL_COOLDOWN_MS));
        } else {
          await new Promise((r) => setTimeout(r, POLL_RETRY_MS));
        }
      }
    }
  }

  private async extractContent(item: WeixinItem): Promise<{ text: string; imagePath?: string }> {
    switch (item.type) {
      case 1: {
        let text = item.text_item.text;
        // Prepend quoted message context if present
        if (item.ref_msg?.title) {
          text = `[回复「${item.ref_msg.title}」]\n${text}`;
        }
        return { text };
      }

      case 2: {
        try {
          const path = await downloadMedia(
            item.image_item.url,
            item.image_item.aes_key,
            "image.jpg"
          );
          return { text: "", imagePath: path };
        } catch (e) {
          console.error("[wechat] Failed to download image:", e);
          return { text: "[图片 - 下载失败]" };
        }
      }

      case 3: {
        const voiceText = item.voice_item.voice_text;
        if (voiceText) {
          return { text: `[语音转文字] ${voiceText}` };
        }
        return { text: "[语音消息]" };
      }

      case 4:
        return { text: `[文件] ${item.file_item.file_name}` };

      case 5:
        return { text: "[视频消息]" };

      default:
        return { text: "[未知消息类型]" };
    }
  }

  private async handleMessage(msg: WeixinMessage): Promise<void> {
    // Filter out bot's own messages to prevent echo loops
    if (msg.message_type !== MSG_TYPE_USER) return;

    const fromUser = msg.from_user_id;

    if (!this.isAllowed(fromUser)) {
      console.error(`[wechat] Blocked message from unauthorized user: ${fromUser}`);
      return;
    }

    // Store context_token for reply
    this.contextTokens.set(fromUser, msg.context_token);

    // Extract content from all items
    const textParts: string[] = [];
    const imagePaths: string[] = [];

    for (const item of msg.item_list) {
      const result = await this.extractContent(item);
      if (result.text) textParts.push(result.text);
      if (result.imagePath) imagePaths.push(result.imagePath);
    }

    const content = textParts.join("\n");
    if (!content && imagePaths.length === 0) {
      console.error("[wechat] Skipping empty message from:", fromUser);
      return;
    }

    const displayContent = content || "[图片]";
    // Use short sender name (strip @im.wechat)
    const senderShort = fromUser.split("@")[0] || fromUser;
    console.error(`[wechat] Message from ${senderShort}: ${displayContent.slice(0, 50)}...`);

    const meta: Record<string, string> = {
      chat_id: fromUser,
      sender: senderShort,
      context_token: msg.context_token,
      source: "wechat",
    };

    if (imagePaths.length > 0) {
      meta.image_path = imagePaths[0]!;
      if (imagePaths.length > 1) {
        meta.image_paths = imagePaths.join(",");
      }
    }

    await this.server.notification({
      method: "notifications/claude/channel",
      params: {
        content: displayContent,
        meta,
      },
    });
  }
}
