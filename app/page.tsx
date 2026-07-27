const steps = [
  "Create a fine-grained GitHub token with Actions: Read and write.",
  "Set GITHUB_TOKEN, GITHUB_OWNER and MCP_ACCESS_KEY in Vercel.",
  "Connect ChatGPT to /api/mcp?key=YOUR_MCP_ACCESS_KEY.",
  "Run preview_actions_cleanup before delete_actions_artifacts.",
];

export default function Home() {
  return (
    <main>
      <section className="card">
        <p className="eyebrow">Private MCP server</p>
        <h1>GitHub Actions Cleaner</h1>
        <p className="lede">
          Preview and permanently delete GitHub Actions artifacts across repositories
          owned by one GitHub account.
        </p>

        <div className="warning">
          The delete tool is destructive. It requires an exact confirmation phrase and
          is marked as destructive for MCP clients.
        </div>

        <ol>
          {steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>

        <div className="endpoint">
          <span>MCP endpoint</span>
          <code>/api/mcp?key=YOUR_MCP_ACCESS_KEY</code>
        </div>
      </section>
    </main>
  );
}
