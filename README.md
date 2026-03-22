# claude-channel-wechat

[English](#english) | [中文](#中文)

---

## English

WeChat channel plugin for Claude Code. Control your Claude Code session remotely via WeChat.

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

Token is cached at `~/.config/claude-channel-wechat/token.json` — no need to re-scan next time.

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
| Image | Yes (auto-download + AES decrypt) | No |
| Voice | Yes (transcription) | No |
| File | Yes (filename) | No |
| Video | Yes (notification) | No |

### How It Works

```
WeChat User <--iLink API--> MCP Server (local) <--stdio--> Claude Code
```

1. WeChat user sends a message
2. Plugin receives it via iLink long-polling (`getupdates`)
3. Plugin pushes it as a channel event to Claude Code
4. Claude processes the request and calls the `reply` tool
5. Plugin sends the reply back to WeChat via iLink (`sendmessage`)

### Notes

- The iLink API is officially provided by Tencent for OpenClaw. Bridging it to Claude Code is at your own risk regarding WeChat's terms of service.
- Channels are in research preview — `--dangerously-load-development-channels` is required.
- If the token expires, run `/wechat:wechat-configure clear` then `/wechat:wechat-configure login` to re-authenticate.

---

## 中文

微信 Channel 插件，通过微信远程控制你的 Claude Code session。

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

Token 会缓存到 `~/.config/claude-channel-wechat/token.json`，之后无需重复扫码。

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
| 图片 | 支持（自动下载 + AES 解密） | 不支持 |
| 语音 | 支持（语音转文字） | 不支持 |
| 文件 | 支持（文件名） | 不支持 |
| 视频 | 支持（通知） | 不支持 |

### 工作原理

```
微信用户 <--iLink协议--> MCP Server（本地）<--stdio--> Claude Code
```

1. 微信用户发送消息
2. 插件通过 iLink 长轮询（`getupdates`）收到消息
3. 插件将消息作为 channel event 推送到 Claude Code
4. Claude 处理请求并调用 `reply` tool
5. 插件通过 iLink（`sendmessage`）将回复发回微信

### 注意事项

- iLink 协议由腾讯为 OpenClaw 开放，桥接到 Claude Code 的合规性需自行评估
- Channel 功能目前在研究预览阶段，必须使用 `--dangerously-load-development-channels`
- Token 失效后运行 `/wechat:wechat-configure clear` 再 `/wechat:wechat-configure login` 重新认证
