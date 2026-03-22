---
name: wechat-configure
description: Set up the WeChat channel — scan QR to login, check connection status, clear token. Use when the user asks to configure WeChat, check channel status, re-login, switch accounts, or troubleshoot connection issues.
user-invocable: true
allowed-tools:
  - Read
  - Write
  - Bash(ls *)
  - Bash(mkdir *)
  - Bash(rm *)
  - Bash(bun *)
  - Bash(cat *)
  - Bash(chmod *)
---

# /wechat:wechat-configure — WeChat Channel Setup

Manages WeChat iLink login and orients the user on connection status.
Token is stored at `~/.config/claude-channel-wechat/token.json`.

Arguments passed: `$ARGUMENTS`

---

## Dispatch on arguments

### No args — status and guidance

Read the token file and give the user a complete picture:

1. **Token** — check `~/.config/claude-channel-wechat/token.json`.
   - If exists: show Bot ID (part before `:`), created time, and test connection:
     ```bash
     bun -e "
     const fs = require('fs');
     const p = require('os').homedir() + '/.config/claude-channel-wechat/token.json';
     if (!fs.existsSync(p)) { console.log('Status: NOT LOGGED IN'); process.exit(0); }
     const t = JSON.parse(fs.readFileSync(p, 'utf-8'));
     console.log('Bot ID:', t.bot_token.split(':')[0]);
     console.log('Created:', new Date(t.created_at).toLocaleString());
     const c = new AbortController(); setTimeout(() => c.abort(), 5000);
     fetch('https://ilinkai.weixin.qq.com/ilink/bot/getupdates', {
       method: 'POST', signal: c.signal,
       headers: { 'Content-Type': 'application/json', 'AuthorizationType': 'ilink_bot_token', 'X-WECHAT-UIN': btoa(String(Math.floor(Math.random()*0xffffffff))), 'Authorization': 'Bearer ' + t.bot_token },
       body: JSON.stringify({ get_updates_buf: '', base_info: { channel_version: '1.0.2' } }),
     }).then(r => console.log('Connection: OK')).catch(e => {
       console.log(e.name === 'AbortError' ? 'Connection: OK' : 'Connection: FAILED - ' + e.message);
     });
     "
     ```
   - If missing: show "Not logged in."

2. **What next** — based on state give a concrete next step:
   - No token → *"Run `/wechat:wechat-configure login` to scan QR code and pair your WeChat account."*
   - Token exists, connection OK → *"Ready. Send a message from WeChat to reach the assistant. Restart Claude Code with `--dangerously-load-development-channels` to enable the channel."*
   - Token exists, connection FAILED → *"Token may have expired. Run `/wechat:wechat-configure login` to re-authenticate."*

3. **Supported features** — list briefly:
   - Text: send and receive
   - Images: receive (auto-download + decrypt)
   - Voice: receive (transcription)
   - Files: receive (filename)
   - Editing/reactions: not supported (WeChat limitation)

### `login` — scan QR to authenticate

Run the standalone setup script to initiate QR login:

```bash
bun ${CLAUDE_PLUGIN_ROOT:-$(pwd)}/src/setup-login.ts
```

This will display a QR code in the terminal. The user scans it with WeChat to complete authentication. Token is saved automatically.

After login completes, tell the user:
*"Login successful. Restart Claude Code with the WeChat channel to start receiving messages:"*
```
claude --dangerously-load-development-channels server:wechat
```

### `clear` — remove saved token

1. Delete the token file:
   ```bash
   rm -f ~/.config/claude-channel-wechat/token.json
   ```
2. Confirm: *"Token removed. Run `/wechat:wechat-configure login` to re-authenticate with a new account."*

---

## Implementation notes

- The token directory might not exist before first login. Missing file = not configured, not an error.
- The MCP server reads the token at boot. Token changes need a session restart. Say so after any change.
- The sync cursor at `~/.claude/channels/wechat/sync_buf.txt` preserves message position across restarts — don't delete it unless troubleshooting.
