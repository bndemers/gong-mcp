# Gong MCP Server

A Model Context Protocol (MCP) server that exposes Gong's call data (metadata, AI-generated summaries, and transcripts) to Claude and other MCP clients.

Can run two ways:

- **Hosted (remote)** — deployed to Render, teammates connect over HTTPS with a bearer token
- **Local (stdio)** — run on your machine, wired into Claude Desktop's config

## Available Tools

| Tool                  | What it does                                                                                                    |
| --------------------- | --------------------------------------------------------------------------------------------------------------- |
| `list_calls`          | List Gong calls in a date range. Use first to discover call IDs.                                                |
| `get_call_details`    | Fetch AI-generated brief, key points, highlights, topics, and outcomes for calls. **Preferred over transcripts** unless you need exact quotes. Supports `summary` / `detailed` / `full` levels. |
| `retrieve_transcripts` | Full verbatim transcripts with timestamped sentences. Large payloads — use sparingly.                          |

## Using the Hosted Server (Teammates)

If Confido's server is already deployed, you just need:

- The server URL — ask an admin (looks like `https://<name>.onrender.com/mcp`)
- Your personal bearer token — ask an admin (they'll issue one just for you)

Add a remote MCP connector in your client:

**Claude Desktop / Claude Code:**

```json
{
  "mcpServers": {
    "gong": {
      "type": "http",
      "url": "https://<name>.onrender.com/mcp",
      "headers": {
        "Authorization": "Bearer <your-token>"
      }
    }
  }
}
```

**claude.ai:** add a custom connector in Settings → Connectors, paste the URL, add the header `Authorization: Bearer <your-token>`.

Keep your token secret — it identifies you in the server's request logs and gives access to Confido's Gong data. If it leaks, ask an admin to rotate it.

## Running Locally (Development)

Requires Node 20+.

1. Clone and install:

   ```bash
   git clone git@github.com:bndemers/gong-mcp.git
   cd gong-mcp
   npm install
   npm run build
   ```

2. Create `.env` in the repo root:

   ```bash
   GONG_ACCESS_KEY=your_key
   GONG_ACCESS_SECRET=your_secret
   GONG_API_URL=https://api.gong.io
   ```

3. Point Claude Desktop at the built server (`claude_desktop_config.json`):

   ```json
   {
     "mcpServers": {
       "gong": {
         "command": "node",
         "args": ["/absolute/path/to/gong-mcp/dist/index.js"]
       }
     }
   }
   ```

   The server auto-detects mode: no `PORT` env var → stdio (this path); `PORT` set → HTTP.

## Deploying to Render (Admins)

The repo ships with a [render.yaml](render.yaml) blueprint. First deploy:

1. Render dashboard → **New → Blueprint** → connect this repo. Render detects `render.yaml` and creates a Docker web service on the Starter plan with `/health` checks and auto-deploy on push to `master`.
2. Fill in the four secrets (Render prompts because `render.yaml` marks them `sync: false`):
   - `GONG_ACCESS_KEY`, `GONG_ACCESS_SECRET` — dedicated Gong service account credentials
   - `GONG_API_URL` — e.g. `https://api.gong.io`
   - `MCP_AUTH_TOKENS` — JSON map, see next section
3. First build takes ~2 min. `/health` returning `ok` means it's ready.

Once created, pushes to `master` auto-deploy — teammates get updates without doing anything.

### Managing `MCP_AUTH_TOKENS`

`MCP_AUTH_TOKENS` is a JSON object mapping bearer tokens → human-readable user labels. One token per teammate lets you revoke a single person without disrupting anyone else, and each request logs the resolved label so you can trace usage.

**Format** (paste as a single-line JSON string into Render's env var value field):

```json
{"tok_abc123...":"alice","tok_def456...":"bob"}
```

**Generate tokens:**

```bash
for name in alice bob carol; do
  echo "  \"$(openssl rand -hex 24)\": \"$name\","
done
```

Wrap the output in `{ }` and remove the trailing comma. Save the token → name mapping somewhere secure (1Password, etc.) so you can distribute tokens later.

**Distributing tokens:** send each teammate only their own token. They only need the URL and their token — no repo, no Docker, no install.

**Rotating one teammate's token:**

1. Generate a new token with `openssl rand -hex 24`
2. Edit `MCP_AUTH_TOKENS` in Render's Environment tab: change that teammate's entry
3. Send them the new value. Other teammates are unaffected.

Render auto-redeploys on env var changes, so the new value goes live within ~30 seconds.

**Rotating all tokens (e.g., suspected leak):** generate a fresh JSON blob, replace `MCP_AUTH_TOKENS` entirely, redistribute.

### Watching request logs

Every authenticated request logs `[<user>] <method>` to stdout (visible in Render's Logs tab). Use it to:

- Confirm a teammate's token is working
- Spot Gong API rate-limit warnings (`Rate limited (429)`)
- Attribute usage if you're near a Gong quota

## Architecture Notes

- Single Node process, Express in front of `StreamableHTTPServerTransport` from the MCP SDK
- Stateless mode: a fresh `Server` + transport is spun up per request, so requests don't share state
- Gong API calls use HMAC-SHA256 signing per Gong's spec, with automatic retry on `429`s
- The `list_calls` tool paginates via cursor up to 500 results, with a 350ms delay between pages to stay under Gong's ~3 req/sec limit

## License

MIT License - see LICENSE file for details

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request
