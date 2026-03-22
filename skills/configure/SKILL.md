---
name: configure
description: Set up the WeChat channel — check status, re-login, manage token. Use when the user asks to configure WeChat, check channel status, re-login, switch accounts, or troubleshoot connection issues.
disable-model-invocation: true
---

# WeChat Channel Configuration

Perform the requested action based on user intent:

## Check Status (default if no specific action requested)

1. Read `~/.config/claude-channel-wechat/token.json`
2. If token exists, report:
   - Bot ID (first part of bot_token before `:`)
   - Token created time
   - Run this to test connection:
     ```bash
     bun -e "
     const fs = require('fs');
     const path = require('os').homedir() + '/.config/claude-channel-wechat/token.json';
     if (!fs.existsSync(path)) { console.log('Status: NO TOKEN'); process.exit(0); }
     const token = JSON.parse(fs.readFileSync(path, 'utf-8'));
     console.log('Bot ID:', token.bot_token.split(':')[0]);
     console.log('Created:', new Date(token.created_at).toLocaleString());
     const c = new AbortController(); setTimeout(() => c.abort(), 5000);
     fetch('https://ilinkai.weixin.qq.com/ilink/bot/getupdates', {
       method: 'POST', signal: c.signal,
       headers: { 'Content-Type': 'application/json', 'AuthorizationType': 'ilink_bot_token', 'X-WECHAT-UIN': btoa(String(Math.floor(Math.random()*0xffffffff))), 'Authorization': 'Bearer ' + token.bot_token },
       body: JSON.stringify({ get_updates_buf: '', base_info: { channel_version: '1.0.2' } }),
     }).then(r => console.log('Connection: OK')).catch(e => {
       console.log(e.name === 'AbortError' ? 'Connection: OK (long poll)' : 'Connection: FAILED - ' + e.message);
     });
     "
     ```
3. If no token, report: "Not logged in. Restart Claude Code with the wechat channel to scan QR code."

## Re-login

1. Delete the cached token:
   ```bash
   rm -f ~/.config/claude-channel-wechat/token.json
   ```
2. Tell the user: "Token cleared. Restart Claude Code to scan a new QR code:"
   ```
   claude --dangerously-load-development-channels server:wechat
   ```

## Supported Features

Report the current feature set:
- Text messages: send and receive
- Images: receive (auto-download and decrypt from CDN)
- Voice: receive transcription text
- Files: receive file name and metadata
- Video: receive notification
- Typing indicator: supported
- Message editing: not supported (WeChat API limitation)
- Reactions: not supported (WeChat API limitation)
