import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { writeFileSync, readFileSync, mkdirSync } from "fs";
import { join, basename, extname } from "path";
import { homedir } from "os";

const MEDIA_DIR = join(homedir(), ".claude", "channels", "wechat", "inbox");
const CDN_BASE_URL = "https://novac2c.cdn.weixin.qq.com/c2c";
const UPLOAD_MAX_RETRIES = 3;

mkdirSync(MEDIA_DIR, { recursive: true });

// ── AES-128-ECB ──

function parseAesKey(raw: string): Buffer {
  if (/^[0-9a-fA-F]{32}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }
  const decoded = Buffer.from(raw, "base64");
  if (decoded.length === 16) return decoded;
  if (decoded.length === 32 && /^[0-9a-fA-F]{32}$/.test(decoded.toString("utf-8"))) {
    return Buffer.from(decoded.toString("utf-8"), "hex");
  }
  throw new Error(`Invalid AES key length: ${decoded.length} bytes after decode`);
}

function encryptAesEcb(plaintext: Buffer, key: Buffer): Buffer {
  const cipher = createCipheriv("aes-128-ecb", key, null);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}

function aesEcbPaddedSize(size: number): number {
  return size + (16 - (size % 16));
}

// ── Download ──

export async function downloadMedia(
  encryptQueryParam: string,
  aesKey: string | undefined,
  filename: string
): Promise<string> {
  const cdnUrl = `${CDN_BASE_URL}/download?encrypted_query_param=${encodeURIComponent(encryptQueryParam)}`;
  console.error(`[wechat] Downloading media: ${filename} from CDN...`);

  const res = await fetch(cdnUrl, {
    signal: AbortSignal.timeout(60_000),
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  if (!res.ok) throw new Error(`CDN download failed: HTTP ${res.status}`);

  const raw = Buffer.from(await res.arrayBuffer());
  console.error(`[wechat] Downloaded ${raw.length} bytes`);

  let data: Buffer;
  if (aesKey) {
    const key = parseAesKey(aesKey);
    const decipher = createDecipheriv("aes-128-ecb", key, null);
    data = Buffer.concat([decipher.update(raw), decipher.final()]);
    console.error(`[wechat] Decrypted to ${data.length} bytes`);
  } else {
    data = raw;
  }

  const filePath = join(MEDIA_DIR, `${Date.now()}-${filename}`);
  writeFileSync(filePath, data);
  console.error(`[wechat] Media saved to: ${filePath}`);
  return filePath;
}

// ── Upload ──

const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp"]);

function randomUin(): string {
  return Buffer.from(String(Math.floor(Math.random() * 0xffffffff))).toString("base64");
}

function makeUploadHeaders(token: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    "X-WECHAT-UIN": randomUin(),
    Authorization: `Bearer ${token}`,
  };
}

export interface UploadResult {
  downloadParam: string;
  aesKeyHex: string;
  fileSize: number;
  rawSize: number;
  mediaType: number; // 1=image, 3=file
}

export async function uploadMedia(
  botToken: string,
  baseUrl: string,
  toUserId: string,
  filePath: string
): Promise<UploadResult> {
  const plaintext = readFileSync(filePath);
  if (plaintext.length === 0) throw new Error("Empty file");

  const ext = extname(filePath).toLowerCase().replace(".", "");
  const isImage = IMAGE_EXTS.has(ext);
  const mediaType = isImage ? 1 : 3; // 1=image, 3=file

  const rawSize = plaintext.length;
  const aesKey = randomBytes(16);
  const aesKeyHex = aesKey.toString("hex");
  const filekey = randomBytes(16).toString("hex");
  const fileSize = aesEcbPaddedSize(rawSize);

  // Step 1: getuploadurl
  console.error(`[wechat] getuploadurl for ${basename(filePath)} (${rawSize} bytes, type=${mediaType})...`);
  const uploadUrlRes = await fetch(`${baseUrl.replace(/\/$/, "")}/ilink/bot/getuploadurl`, {
    method: "POST",
    headers: makeUploadHeaders(botToken),
    body: JSON.stringify({
      filekey,
      media_type: mediaType,
      to_user_id: toUserId,
      rawsize: rawSize,
      rawfilemd5: createHash("md5").update(plaintext).digest("hex"),
      filesize: fileSize,
      no_need_thumb: true,
      aeskey: aesKeyHex,
      base_info: { channel_version: "1.0.2" },
    }),
  });

  const uploadUrlData = (await uploadUrlRes.json()) as { upload_param?: string };
  if (!uploadUrlData.upload_param) {
    throw new Error(`getuploadurl failed: ${JSON.stringify(uploadUrlData)}`);
  }

  // Step 2: encrypt and upload to CDN
  const ciphertext = encryptAesEcb(plaintext, aesKey);
  const cdnUrl = `${CDN_BASE_URL}/upload?encrypted_query_param=${encodeURIComponent(uploadUrlData.upload_param)}&filekey=${encodeURIComponent(filekey)}`;

  console.error(`[wechat] Uploading ${ciphertext.length} bytes to CDN...`);

  let downloadParam = "";
  let lastError: unknown;

  for (let attempt = 1; attempt <= UPLOAD_MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(cdnUrl, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: new Uint8Array(ciphertext),
        signal: AbortSignal.timeout(60_000),
      });

      if (res.status >= 400 && res.status < 500) {
        const errMsg = res.headers.get("x-error-message") ?? `status ${res.status}`;
        throw new Error(`CDN upload client error ${res.status}: ${errMsg}`);
      }
      if (res.status !== 200) {
        throw new Error(`CDN upload server error: ${res.headers.get("x-error-message") ?? `status ${res.status}`}`);
      }

      downloadParam = res.headers.get("x-encrypted-param") ?? "";
      if (!downloadParam) {
        throw new Error("CDN response missing x-encrypted-param header");
      }
      break;
    } catch (err) {
      lastError = err;
      if (err instanceof Error && err.message.includes("client error")) throw err;
      console.error(`[wechat] CDN upload attempt ${attempt} failed:`, err);
    }
  }

  if (!downloadParam) {
    throw lastError instanceof Error ? lastError : new Error("CDN upload failed after retries");
  }

  console.error(`[wechat] Upload successful`);
  return { downloadParam, aesKeyHex, fileSize, rawSize, mediaType };
}

export function getMediaDir(): string {
  return MEDIA_DIR;
}
