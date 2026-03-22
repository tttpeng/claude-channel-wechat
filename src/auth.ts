import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import QRCode from "qrcode";

const ILINK_BASE_URL = "https://ilinkai.weixin.qq.com";
const CONFIG_DIR = join(homedir(), ".config", "claude-channel-wechat");
const TOKEN_FILE = join(CONFIG_DIR, "token.json");

interface StoredToken {
  bot_token: string;
  baseurl: string;
  created_at: number;
}

function randomUin(): string {
  const num = Math.floor(Math.random() * 0xffffffff);
  return btoa(String(num));
}

function makeHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    "X-WECHAT-UIN": randomUin(),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

export function loadStoredToken(): StoredToken | null {
  if (!existsSync(TOKEN_FILE)) return null;
  try {
    return JSON.parse(readFileSync(TOKEN_FILE, "utf-8")) as StoredToken;
  } catch {
    return null;
  }
}

function saveToken(token: StoredToken): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(TOKEN_FILE, JSON.stringify(token, null, 2));
  try { chmodSync(TOKEN_FILE, 0o600); } catch { /* best-effort */ }
}

async function verifyToken(token: string, baseUrl: string): Promise<boolean> {
  // Use getupdates with a short timeout to verify token validity
  // getupdates is the most reliable endpoint — getconfig requires extra params
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 5000);

    const res = await fetch(`${baseUrl}/ilink/bot/getupdates`, {
      method: "POST",
      headers: makeHeaders(token),
      body: JSON.stringify({
        get_updates_buf: "",
        base_info: { channel_version: "1.0.2" },
      }),
      signal: controller.signal,
    });

    if (!res.ok) return false;

    // If we get here (HTTP 200), token is valid
    // getupdates holds the connection for long polling, so we abort early
    return true;
  } catch (e) {
    // AbortError means the request was accepted (long polling started) — token is valid
    if (e instanceof Error && e.name === "AbortError") {
      return true;
    }
    return false;
  }
}

export async function login(): Promise<{ token: string; baseUrl: string }> {
  // Check for stored token first
  const stored = loadStoredToken();
  if (stored) {
    console.error("[wechat] Found stored token, verifying...");
    const valid = await verifyToken(stored.bot_token, stored.baseurl || ILINK_BASE_URL);
    if (valid) {
      console.error("[wechat] Stored token is valid.");
      return { token: stored.bot_token, baseUrl: stored.baseurl || ILINK_BASE_URL };
    }
    console.error("[wechat] Stored token expired, re-authenticating...");
  }

  // Step 1: Get QR code
  console.error("[wechat] Requesting QR code...");
  const qrRes = await fetch(
    `${ILINK_BASE_URL}/ilink/bot/get_bot_qrcode?bot_type=3`,
    { headers: makeHeaders() }
  );
  if (!qrRes.ok) {
    throw new Error(`Failed to get QR code: ${qrRes.status}`);
  }

  const qrData = (await qrRes.json()) as Record<string, unknown>;

  const qrcode = qrData.qrcode as string;
  const qrImgContent = qrData.qrcode_img_content as string | undefined;

  // Build the scan URL
  const qrUrl = qrImgContent && qrImgContent.startsWith("http")
    ? qrImgContent
    : `https://liteapp.weixin.qq.com/q/?qrcode=${encodeURIComponent(qrcode)}&bot_type=3`;

  // Display QR code directly in terminal
  console.error("[wechat] ==========================================");
  console.error("[wechat] Please scan with WeChat:");
  console.error("");

  try {
    const qrAscii = await QRCode.toString(qrUrl, { type: "terminal", small: true });
    // QRCode.toString writes to stdout by default, we need stderr for MCP
    process.stderr.write(qrAscii + "\n");
  } catch {
    console.error(`[wechat] (Could not render QR in terminal)`);
  }

  console.error(`[wechat] URL: ${qrUrl}`);
  console.error("[wechat] ==========================================");

  // Step 2: Poll for scan status
  console.error("[wechat] Waiting for QR code scan...");
  let scannedPrinted = false;
  while (true) {
    await new Promise((resolve) => setTimeout(resolve, 2000));

    try {
      const statusRes = await fetch(
        `${ILINK_BASE_URL}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`,
        { headers: makeHeaders() }
      );

      if (!statusRes.ok) continue;

      const statusData = (await statusRes.json()) as {
        status: string;
        bot_token?: string;
        baseurl?: string;
      };

      if (statusData.status === "scaned" && !scannedPrinted) {
        console.error("[wechat] QR code scanned! Please confirm on your phone...");
        scannedPrinted = true;
      }

      if (statusData.status === "confirmed" && statusData.bot_token) {
        console.error("[wechat] Login successful!");
        const result = {
          token: statusData.bot_token,
          baseUrl: statusData.baseurl || ILINK_BASE_URL,
        };

        // Persist the token
        saveToken({
          bot_token: result.token,
          baseurl: result.baseUrl,
          created_at: Date.now(),
        });

        return result;
      }

      if (statusData.status === "expired") {
        throw new Error("QR code expired. Please restart to get a new one.");
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes("expired")) throw e;
      // Network error, keep polling
    }
  }
}
