import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";
import { writeFileSync, readFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const MEDIA_DIR = join(homedir(), ".claude", "channels", "wechat", "inbox");
const CDN_BASE_URL = "https://novac2c.cdn.weixin.qq.com/c2c";
const UPLOAD_MAX_RETRIES = 3;

mkdirSync(MEDIA_DIR, { recursive: true });

// ── AES-128-ECB helpers ──

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

function pkcs7Pad(data: Buffer): Buffer {
  const blockSize = 16;
  const padLen = blockSize - (data.length % blockSize);
  const padding = Buffer.alloc(padLen, padLen);
  return Buffer.concat([data, padding]);
}

function encryptAesEcb(plaintext: Buffer, key: Buffer): Buffer {
  const padded = pkcs7Pad(plaintext);
  const cipher = createCipheriv("aes-128-ecb", key, null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(padded), cipher.final()]);
}

function decryptAesEcb(ciphertext: Buffer, key: Buffer): Buffer {
  const decipher = createDecipheriv("aes-128-ecb", key, null);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function md5Hex(data: Buffer): string {
  return createHash("md5").update(data).digest("hex");
}

function aesEcbPaddedSize(plaintextLen: number): number {
  return Math.ceil((plaintextLen + 16) / 16) * 16;
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
  if (!res.ok) {
    throw new Error(`CDN download failed: HTTP ${res.status}`);
  }

  const raw = Buffer.from(await res.arrayBuffer());
  console.error(`[wechat] Downloaded ${raw.length} bytes`);

  let data: Buffer;
  if (aesKey) {
    const key = parseAesKey(aesKey);
    data = decryptAesEcb(raw, key);
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

interface UploadResult {
  downloadParam: string;
  aesKey: Buffer;
  cipherSize: number;
  rawSize: number;
}

const UPLOAD_MEDIA_IMAGE = 1;
const UPLOAD_MEDIA_FILE = 3;

export async function uploadMedia(
  botToken: string,
  baseUrl: string,
  toUserId: string,
  filePath: string,
  mediaType: "image" | "file"
): Promise<UploadResult> {
  const plaintext = Buffer.from(readFileSync(filePath));
  if (plaintext.length === 0) throw new Error("Empty file");

  const rawSize = plaintext.length;
  const aesKey = randomBytes(16);
  const filekey = randomBytes(16).toString("hex");
  const uploadMediaType = mediaType === "image" ? UPLOAD_MEDIA_IMAGE : UPLOAD_MEDIA_FILE;

  // Step 1: Get upload URL from iLink API
  console.error(`[wechat] Requesting upload URL for ${mediaType}...`);
  const uploadUrlRes = await fetch(`${baseUrl}/ilink/bot/getuploadurl`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      AuthorizationType: "ilink_bot_token",
      "X-WECHAT-UIN": Buffer.from(String(Math.floor(Math.random() * 0xffffffff))).toString("base64"),
      Authorization: `Bearer ${botToken}`,
    },
    body: JSON.stringify({
      filekey,
      media_type: uploadMediaType,
      to_user_id: toUserId,
      rawsize: rawSize,
      rawfilemd5: md5Hex(plaintext),
      filesize: aesEcbPaddedSize(rawSize),
      no_need_thumb: true,
      aeskey: aesKey.toString("hex"),
      base_info: { channel_version: "1.0.2" },
    }),
  });

  const uploadUrlData = (await uploadUrlRes.json()) as { upload_param?: string };
  if (!uploadUrlData.upload_param) {
    throw new Error(`getuploadurl failed: ${JSON.stringify(uploadUrlData)}`);
  }

  // Step 2: Encrypt and upload to CDN
  const ciphertext = encryptAesEcb(plaintext, aesKey);
  const uploadUrl = `${CDN_BASE_URL}/upload?encrypted_query_param=${encodeURIComponent(uploadUrlData.upload_param)}&filekey=${encodeURIComponent(filekey)}`;

  console.error(`[wechat] Uploading ${ciphertext.length} bytes to CDN...`);

  let downloadParam = "";
  for (let attempt = 1; attempt <= UPLOAD_MAX_RETRIES; attempt++) {
    try {
      const uploadRes = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: ciphertext,
        signal: AbortSignal.timeout(60_000),
      });

      if (uploadRes.status >= 400 && uploadRes.status < 500) {
        throw new Error(`CDN upload client error: ${uploadRes.status}`);
      }
      if (uploadRes.status !== 200) {
        console.error(`[wechat] CDN upload attempt ${attempt} failed: ${uploadRes.status}`);
        continue;
      }

      // CDN may return the param under either header name
      downloadParam = uploadRes.headers.get("x-encrypted-query-param")
        || uploadRes.headers.get("x-encrypted-param") || "";
      if (downloadParam) break;
      const hdrs = Object.fromEntries(uploadRes.headers.entries());
      console.error(`[wechat] CDN upload attempt ${attempt}: no download param, headers: ${JSON.stringify(hdrs)}`);
    } catch (e) {
      console.error(`[wechat] CDN upload attempt ${attempt} error:`, e);
      if (attempt === UPLOAD_MAX_RETRIES) throw e;
    }
  }

  if (!downloadParam) {
    throw new Error("CDN upload failed: no download param after retries");
  }

  console.error(`[wechat] Upload successful`);
  return { downloadParam, aesKey, cipherSize: ciphertext.length, rawSize };
}

export { UPLOAD_MEDIA_IMAGE, UPLOAD_MEDIA_FILE };

export function getMediaDir(): string {
  return MEDIA_DIR;
}
