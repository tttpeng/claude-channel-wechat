#!/usr/bin/env bun
/**
 * Standalone WeChat QR login tool.
 * Called by /wechat:wechat-configure login skill.
 * Saves token to ~/.claude/channels/wechat/token.json
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import QRCode from "qrcode";

const ILINK_BASE_URL = "https://ilinkai.weixin.qq.com";
const CONFIG_DIR = join(homedir(), ".claude", "channels", "wechat");
const TOKEN_FILE = join(CONFIG_DIR, "token.json");

function randomUin(): string {
  const num = Math.floor(Math.random() * 0xffffffff);
  return btoa(String(num));
}

async function main() {
  // Check existing token
  if (existsSync(TOKEN_FILE)) {
    try {
      const existing = JSON.parse(readFileSync(TOKEN_FILE, "utf-8"));
      const botId = existing.bot_token?.split(":")[0] || "unknown";
      const created = new Date(existing.created_at).toLocaleString();
      console.log(`Found existing token: Bot ID ${botId}, created ${created}`);
      console.log("Replacing with new login...\n");
    } catch {
      // ignore
    }
  }

  // Get QR code
  console.log("Requesting QR code from WeChat...\n");
  const qrRes = await fetch(
    `${ILINK_BASE_URL}/ilink/bot/get_bot_qrcode?bot_type=3`,
    {
      headers: {
        "Content-Type": "application/json",
        AuthorizationType: "ilink_bot_token",
        "X-WECHAT-UIN": randomUin(),
      },
    }
  );

  if (!qrRes.ok) {
    console.error(`Failed to get QR code: HTTP ${qrRes.status}`);
    process.exit(1);
  }

  const qrData = (await qrRes.json()) as Record<string, unknown>;
  const qrcode = qrData.qrcode as string;
  const qrUrl = (qrData.qrcode_img_content as string) || "";

  // Display QR code in terminal
  const scanUrl = qrUrl.startsWith("http")
    ? qrUrl
    : `https://liteapp.weixin.qq.com/q/?qrcode=${encodeURIComponent(qrcode)}&bot_type=3`;

  try {
    const qrAscii = await QRCode.toString(scanUrl, { type: "terminal", small: true });
    console.log(qrAscii);
  } catch {
    console.log(`(Could not render QR in terminal)`);
  }

  console.log(`Scan URL: ${scanUrl}\n`);
  console.log("Scan the QR code with WeChat...\n");

  // Poll for scan status
  let scannedPrinted = false;
  const deadline = Date.now() + 480_000;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));

    try {
      const statusRes = await fetch(
        `${ILINK_BASE_URL}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`,
        {
          headers: {
            "Content-Type": "application/json",
            AuthorizationType: "ilink_bot_token",
            "X-WECHAT-UIN": randomUin(),
          },
        }
      );

      if (!statusRes.ok) continue;

      const statusData = (await statusRes.json()) as {
        status: string;
        bot_token?: string;
        baseurl?: string;
      };

      if (statusData.status === "scaned" && !scannedPrinted) {
        console.log("QR scanned! Please confirm on your phone...");
        scannedPrinted = true;
      }

      if (statusData.status === "confirmed" && statusData.bot_token) {
        mkdirSync(CONFIG_DIR, { recursive: true });
        writeFileSync(
          TOKEN_FILE,
          JSON.stringify(
            {
              bot_token: statusData.bot_token,
              baseurl: statusData.baseurl || ILINK_BASE_URL,
              created_at: Date.now(),
            },
            null,
            2
          )
        );
        try { chmodSync(TOKEN_FILE, 0o600); } catch { /* best-effort */ }

        console.log("\nLogin successful!");
        console.log(`Token saved to: ${TOKEN_FILE}`);
        process.exit(0);
      }

      if (statusData.status === "expired") {
        console.error("\nQR code expired. Please run again.");
        process.exit(1);
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes("expired")) {
        process.exit(1);
      }
    }
  }

  console.error("\nLogin timed out.");
  process.exit(1);
}

main().catch((err) => {
  console.error(`Error: ${err}`);
  process.exit(1);
});
