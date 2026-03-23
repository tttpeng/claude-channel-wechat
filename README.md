# claude-channel-wechat

[English](#english) | [中文](#中文)

---

## English

WeChat channel plugin for Claude Code. Control your Claude Code session remotely via WeChat — send text, images, files, voice, and video.

### Prerequisites

- [Bun](https://bun.sh) (v1.0+)
- [Claude Code](https://code.claude.com) (v2.1.80+)
- WeChat (version 2026.2.9+, with iLink protocol support)

### Installation

#### Option 1: Plugin Marketplace (recommended)

In Claude Code, run:

```
/plugin marketplace add tttpeng/claude-channel-wechat
/plugin install wechat@claude-channel-wechat
```

#### Option 2: Manual Installation

```bash
git clone https://github.com/tttpeng/claude-channel-wechat.git
cd claude-channel-wechat
bun install
bun run setup
```

### Setup

After installation, start Claude Code with the channel enabled:

```bash
claude --dangerously-load-development-channels plugin:wechat@claude-channel-wechat
```

Or for manual installation:

```bash
claude --dangerously-load-development-channels server:wechat
```

To auto-approve all WeChat plugin tool calls (so replies don't require manual permission), add `--allowedTools`:

```bash
claude --dangerously-load-development-channels plugin:wechat@claude-channel-wechat --allowedTools "mcp__wechat__*"
```

Then configure the WeChat connection:

1. Run `/wechat:wechat-configure` to check status
2. Run `/wechat:wechat-configure login` — it will guide you to open another terminal and scan a QR code with WeChat
3. After login succeeds, restart Claude Code with the same command above

Token is cached at `~/.claude/channels/wechat/token.json` — no need to re-scan next time.

### Commands

| Command | Description |
|---------|-------------|
| `/wechat:wechat-configure` | Check connection status, guided setup |
| `/wechat:wechat-configure login` | Start QR login in external terminal |
| `/wechat:wechat-configure clear` | Remove saved token (logout) |

### Supported Message Types

| Type | Receive | Send |
|------|---------|------|
| Text | Yes | Yes |
| Image | Yes (CDN download + AES-128-ECB decrypt) | Yes (AES encrypt + CDN upload) |
| File | Yes (CDN download + decrypt) | Yes (encrypt + CDN upload) |
| Voice | Yes (transcription) | No |
| Video | Yes (CDN download + decrypt) | No |

### How It Works

```
WeChat User <--iLink API--> MCP Server (local) <--stdio--> Claude Code
```

**Receiving messages:**
1. Plugin long-polls iLink `getupdates` for incoming WeChat messages
2. Text is forwarded as channel events; media is downloaded from CDN and decrypted
3. Claude processes the request with full filesystem and tool access

**Sending messages:**
1. Claude calls the `reply` tool with text and/or file paths
2. Text is sent directly via iLink `sendmessage`
3. Files are encrypted with AES-128-ECB, uploaded to WeChat CDN, then sent as media messages

### Notes

- The iLink API is officially provided by Tencent for OpenClaw. Bridging it to Claude Code is at your own risk regarding WeChat's terms of service.
- Channels are in research preview — `--dangerously-load-development-channels` is required.
- If the token expires, run `/wechat:wechat-configure clear` then `/wechat:wechat-configure login` to re-authenticate.

---

## 中文

微信 Channel 插件，通过微信远程控制你的 Claude Code session。支持文本、图片、文件、语音、视频的收发。

### 前置要求

- [Bun](https://bun.sh) (v1.0+)
- [Claude Code](https://code.claude.com) (v2.1.80+)
- 微信（版本 2026.2.9+，支持 iLink 协议）

### 安装

#### 方式一：Plugin Marketplace（推荐）

在 Claude Code 中执行：

```
/plugin marketplace add tttpeng/claude-channel-wechat
/plugin install wechat@claude-channel-wechat
```

#### 方式二：手动安装

```bash
git clone https://github.com/tttpeng/claude-channel-wechat.git
cd claude-channel-wechat
bun install
bun run setup
```

### 配置

安装后，启动 Claude Code 并启用 channel：

```bash
claude --dangerously-load-development-channels plugin:wechat@claude-channel-wechat
```

手动安装方式：

```bash
claude --dangerously-load-development-channels server:wechat
```

如需自动授权微信插件的所有工具调用（回复消息时无需手动确认），可加 `--allowedTools`：

```bash
claude --dangerously-load-development-channels plugin:wechat@claude-channel-wechat --allowedTools "mcp__wechat__*"
```

然后配置微信连接：

1. 运行 `/wechat:wechat-configure` 查看状态
2. 运行 `/wechat:wechat-configure login` — 会引导你在另一个终端打开并用微信扫码
3. 登录成功后，用上面相同的命令重启 Claude Code

Token 会缓存到 `~/.claude/channels/wechat/token.json`，之后无需重复扫码。

### 命令

| 命令 | 说明 |
|------|------|
| `/wechat:wechat-configure` | 查看连接状态，引导配置 |
| `/wechat:wechat-configure login` | 在外部终端启动扫码登录 |
| `/wechat:wechat-configure clear` | 删除 token（退出登录） |

### 支持的消息类型

| 类型 | 接收 | 发送 |
|------|------|------|
| 文本 | 支持 | 支持 |
| 图片 | 支持（CDN 下载 + AES-128-ECB 解密） | 支持（AES 加密 + CDN 上传） |
| 文件 | 支持（CDN 下载 + 解密） | 支持（加密 + CDN 上传） |
| 语音 | 支持（语音转文字） | 不支持 |
| 视频 | 支持（CDN 下载 + 解密） | 不支持 |

### 工作原理

```
微信用户 <--iLink协议--> MCP Server（本地）<--stdio--> Claude Code
```

**接收消息：**
1. 插件通过 iLink `getupdates` 长轮询接收微信消息
2. 文本直接转发为 channel 事件；媒体从 CDN 下载并解密
3. Claude 处理请求，可访问文件系统和所有工具

**发送消息：**
1. Claude 调用 `reply` tool，传入文本和/或文件路径
2. 文本直接通过 iLink `sendmessage` 发送
3. 文件先用 AES-128-ECB 加密，上传到微信 CDN，再作为媒体消息发送

### 注意事项

- iLink 协议由腾讯为 OpenClaw 开放，桥接到 Claude Code 的合规性需自行评估
- Channel 功能目前在研究预览阶段，必须使用 `--dangerously-load-development-channels`
- Token 失效后运行 `/wechat:wechat-configure clear` 再 `/wechat:wechat-configure login` 重新认证
