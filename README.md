# GitHub Actions Cleaner MCP

A private, tool-only MCP server for previewing and permanently deleting GitHub Actions artifacts across repositories owned by one GitHub account.

## Tools

### `preview_actions_cleanup`

Read-only. Scans matching repositories and reports:

- number of matching artifacts
- estimated storage occupied
- repositories containing artifacts
- a preview of the first 100 matching artifacts

### `delete_actions_artifacts`

Destructive. Permanently deletes matching artifacts.

Safeguards:

- marked with `destructiveHint: true`
- exact confirmation phrase required
- configurable maximum deletions per invocation
- supports one repository or all owned repositories
- supports age filters and keeping the newest artifacts

## Environment variables

Copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

Set:

```env
GITHUB_TOKEN=...
GITHUB_OWNER=Cod3Uchiha
MCP_ACCESS_KEY=...
```

Generate the access key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Create the GitHub token

Create a **fine-grained personal access token**:

- Resource owner: your GitHub account
- Repository access: all repositories, or only repositories you want the app to clean
- Repository permissions:
  - **Actions: Read and write**
  - Metadata is included automatically

The token is stored only as a Vercel environment variable. Do not commit it.

GitHub's artifact deletion endpoint requires **Actions: write** for fine-grained tokens.

## Local development

```bash
npm install
npm run dev
```

Health check:

```text
http://localhost:3000/api/health
```

MCP endpoint:

```text
http://localhost:3000/api/mcp?key=YOUR_MCP_ACCESS_KEY
```

Test with MCP Inspector:

```bash
npx @modelcontextprotocol/inspector@latest
```

Choose Streamable HTTP and enter the endpoint URL above.

## Deploy to Vercel

1. Push this repository to GitHub.
2. Import the repository in Vercel.
3. Add `GITHUB_TOKEN`, `GITHUB_OWNER`, and `MCP_ACCESS_KEY` to the Production environment.
4. Deploy.
5. Confirm `/api/health` returns `"configured": true`.

Production endpoint:

```text
https://YOUR_PROJECT.vercel.app/api/mcp?key=YOUR_MCP_ACCESS_KEY
```

## Connect to ChatGPT

This app is intended for private Developer Mode use, not public directory submission.

1. Open ChatGPT settings.
2. Enable Developer Mode under Apps/Connectors advanced settings.
3. Create a custom app/connector.
4. Use the production MCP endpoint, including the `key` query parameter.
5. Select no authentication because the endpoint URL already contains a private access key.
6. Run `preview_actions_cleanup`.
7. Review the results.
8. Run `delete_actions_artifacts` only after approving the destructive call.

## Security notes

- Keep the endpoint URL private; it contains the access key.
- Rotate `MCP_ACCESS_KEY` immediately if the URL is exposed.
- Use a fine-grained GitHub token with only Actions access.
- Do not expose this server as a public app.
- Vercel and application logs may contain request paths. For stronger production security, replace the private URL key with a full OAuth authorization server before sharing the app with other users.
