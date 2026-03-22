import { createDecipheriv } from "crypto";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const MEDIA_DIR = join(homedir(), ".claude", "channels", "wechat", "inbox");

// Ensure inbox directory exists
mkdirSync(MEDIA_DIR, { recursive: true });

/**
 * Decrypt AES-128-ECB encrypted media from WeChat CDN.
 */
function decryptMedia(encrypted: Buffer, aesKeyBase64: string): Buffer {
  const key = Buffer.from(aesKeyBase64, "base64");
  const decipher = createDecipheriv("aes-128-ecb", key, null);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

/**
 * Download and decrypt a media file from WeChat CDN.
 * Returns the local file path.
 */
export async function downloadMedia(
  url: string,
  aesKey: string,
  filename: string
): Promise<string> {
  console.error(`[wechat] Downloading media: ${filename} from ${url.slice(0, 80)}...`);

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download media: ${res.status}`);
  }

  const encrypted = Buffer.from(await res.arrayBuffer());
  const decrypted = decryptMedia(encrypted, aesKey);

  const filePath = join(MEDIA_DIR, `${Date.now()}-${filename}`);
  writeFileSync(filePath, decrypted);

  console.error(`[wechat] Media saved to: ${filePath} (${decrypted.length} bytes)`);
  return filePath;
}

/**
 * Get the media inbox directory path.
 */
export function getMediaDir(): string {
  return MEDIA_DIR;
}
