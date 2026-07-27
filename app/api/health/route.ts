export const dynamic = "force-dynamic";

export async function GET() {
  const configured = Boolean(
    process.env.GITHUB_TOKEN &&
      process.env.GITHUB_OWNER &&
      process.env.MCP_ACCESS_KEY,
  );

  return Response.json(
    {
      ok: true,
      service: "github-actions-cleaner-mcp",
      configured,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
