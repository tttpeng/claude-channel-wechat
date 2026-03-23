import { createDecipheriv } from "crypto";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const MEDIA_DIR = join(homedir(), ".claude", "channels", "wechat", "inbox");
const CDN_BASE_URL = "https://novac2c.cdn.weixin.qq.com/c2c";

mkdirSync(MEDIA_DIR, { recursive: true });

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

export function getMediaDir(): string {
  return MEDIA_DIR;
}
