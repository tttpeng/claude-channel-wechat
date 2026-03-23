const ILINK_BASE_URL = "https://ilinkai.weixin.qq.com";

export interface WeixinRefMsg {
  message_item?: { type?: number; text_item?: { text?: string } };
  title?: string;
}

export interface WeixinTextItem {
  type: 1;
  text_item: { text: string };
  ref_msg?: WeixinRefMsg;
}

export interface WeixinImageItem {
  type: 2;
  image_item: {
    url: string;
    aeskey?: string;
    aes_key?: string;
    media?: { encrypt_query_param: string; aes_key?: string };
    file_size?: number;
  };
}

export interface WeixinVoiceItem {
  type: 3;
  voice_item: {
    url: string;
    aeskey?: string;
    aes_key?: string;
    voice_text?: string;
    text?: string;
    playtime?: number;
    media?: { encrypt_query_param: string; aes_key?: string };
  };
}

export interface WeixinFileItem {
  type: 4;
  file_item: {
    url: string;
    aeskey?: string;
    aes_key?: string;
    file_name: string;
    file_size?: number;
    media?: { encrypt_query_param: string; aes_key?: string };
  };
}

export interface WeixinVideoItem {
  type: 5;
  video_item: {
    url: string;
    aeskey?: string;
    aes_key?: string;
    thumb_url?: string;
    duration_ms?: number;
    play_length?: number;
    media?: { encrypt_query_param: string; aes_key?: string };
  };
}

export type WeixinItem = WeixinTextItem | WeixinImageItem | WeixinVoiceItem | WeixinFileItem | WeixinVideoItem;

export interface WeixinMessage {
  from_user_id: string;
  to_user_id: string;
  message_type: number;
  message_state: number;
  context_token: string;
  item_list: WeixinItem[];
}

// message_type constants
export const MSG_TYPE_USER = 1;
export const MSG_TYPE_BOT = 2;

export interface GetUpdatesResponse {
  ret: number;
  msgs: WeixinMessage[];
  get_updates_buf: string;
  longpolling_timeout_ms: number;
}

export interface LoginResult {
  bot_token: string;
  baseurl: string;
}

function randomUin(): string {
  const num = Math.floor(Math.random() * 0xffffffff);
  return btoa(String(num));
}

function makeHeaders(token: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    "X-WECHAT-UIN": randomUin(),
    Authorization: `Bearer ${token}`,
  };
}

export class ILinkClient {
  private token: string;
  private baseUrl: string;
  private cursor: string = "";

  constructor(token: string, baseUrl?: string) {
    this.token = token;
    this.baseUrl = baseUrl || ILINK_BASE_URL;
  }

  async getUpdates(): Promise<{ msgs: WeixinMessage[]; cursor: string }> {
    const res = await fetch(`${this.baseUrl}/ilink/bot/getupdates`, {
      method: "POST",
      headers: makeHeaders(this.token),
      body: JSON.stringify({
        get_updates_buf: this.cursor,
        base_info: { channel_version: "1.0.2" },
      }),
      signal: AbortSignal.timeout(40_000), // 35s server hold + 5s buffer
    });

    if (!res.ok) {
      throw new Error(`getupdates failed: ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as GetUpdatesResponse;

    if (data.get_updates_buf) {
      this.cursor = data.get_updates_buf;
    }

    return { msgs: data.msgs || [], cursor: this.cursor };
  }

  async sendMessage(
    toUserId: string,
    contextToken: string,
    text: string,
    messageState: 1 | 2 = 2  // 1=partial/ongoing, 2=complete
  ): Promise<boolean> {
    const payload = {
      msg: {
        from_user_id: "",
        to_user_id: toUserId,
        client_id: `cc-${crypto.randomUUID()}`,
        message_type: 2,
        message_state: messageState,
        context_token: contextToken,
        item_list: [{ type: 1, text_item: { text } }],
      },
      base_info: { channel_version: "1.0.2" },
    };

    console.error(`[wechat] sendmessage request: to=${toUserId}, state=${messageState}, token=${contextToken.slice(0, 20)}..., text=${text.slice(0, 50)}...`);

    try {
      const body = JSON.stringify(payload);
      const headers = makeHeaders(this.token);
      headers["Content-Length"] = String(new TextEncoder().encode(body).byteLength);

      const res = await fetch(`${this.baseUrl}/ilink/bot/sendmessage`, {
        method: "POST",
        headers,
        body,
      });

      const resText = await res.text();
      console.error(`[wechat] sendmessage HTTP ${res.status}: ${resText.slice(0, 300)}`);

      // iLink API returns HTTP 200 even on failure — check ret field
      // ret=0 means success; negative values mean failure
      // If ret is missing/undefined, treat as success (HTTP 200)
      try {
        const resData = JSON.parse(resText);
        if (typeof resData.ret === "number" && resData.ret < 0) {
          console.error(`[wechat] sendmessage API error: ret=${resData.ret}, errmsg=${resData.errmsg || "unknown"}`);
          return false;
        }
      } catch {
        // Non-JSON response with HTTP 200 — treat as success
      }

      return true;
    } catch (err) {
      console.error(`[wechat] sendmessage error:`, err);
      return false;
    }
  }

  async sendTyping(toUserId: string, typingTicket: string): Promise<void> {
    await fetch(`${this.baseUrl}/ilink/bot/sendtyping`, {
      method: "POST",
      headers: makeHeaders(this.token),
      body: JSON.stringify({
        to_user_id: toUserId,
        typing_ticket: typingTicket,
      }),
    }).catch(() => {}); // best-effort
  }

  async getConfig(): Promise<{ typing_ticket?: string }> {
    const res = await fetch(`${this.baseUrl}/ilink/bot/getconfig`, {
      method: "POST",
      headers: makeHeaders(this.token),
      body: JSON.stringify({}),
    });

    if (!res.ok) return {};
    return (await res.json()) as { typing_ticket?: string };
  }

  getCursor(): string {
    return this.cursor;
  }

  setCursor(cursor: string): void {
    this.cursor = cursor;
  }
}
