import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { isAuthorized } from "@/lib/auth";
import {
  buildCleanupPlan,
  deleteCleanupPlan,
  GitHubApiError,
} from "@/lib/github";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const cleanupFilterSchema = {
  repository: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Optional repository name without the owner. Omit to scan all owned repositories.",
    ),
  olderThanDays: z
    .number()
    .int()
    .min(0)
    .max(3650)
    .optional()
    .describe(
      "Only include artifacts created at least this many days ago. Omit to include artifacts of every age.",
    ),
  keepLatestPerRepository: z
    .number()
    .int()
    .min(0)
    .max(1000)
    .default(0)
    .describe(
      "Keep this many newest artifacts in each repository and exclude them from cleanup.",
    ),
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";

  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );

  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 2)} ${
    units[index]
  }`;
}

function errorResult(error: unknown) {
  const message =
    error instanceof GitHubApiError
      ? `${error.message}. Check the GitHub token and its Actions permissions.`
      : error instanceof Error
        ? error.message
        : String(error);

  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}

const mcpHandler = createMcpHandler(
  (server) => {
    server.registerTool(
      "preview_actions_cleanup",
      {
        title: "Preview GitHub Actions artifact cleanup",
        description:
          "Use this before deletion to calculate which GitHub Actions artifacts match the requested scope. This tool never deletes anything.",
        inputSchema: z.object(cleanupFilterSchema),
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      async (input) => {
        try {
          const plan = await buildCleanupPlan(input);
          const preview = plan.artifacts.slice(0, 100).map((artifact) => ({
            repository: artifact.repository,
            id: artifact.id,
            name: artifact.name,
            sizeBytes: artifact.size_in_bytes,
            createdAt: artifact.created_at,
            expired: artifact.expired,
          }));

          return {
            structuredContent: {
              owner: plan.owner,
              scannedRepositories: plan.scannedRepositories,
              repositoriesWithArtifacts: plan.repositoriesWithArtifacts,
              totalArtifacts: plan.totalArtifacts,
              totalBytes: plan.totalBytes,
              totalSize: formatBytes(plan.totalBytes),
              preview,
              previewTruncated: plan.artifacts.length > preview.length,
            },
            content: [
              {
                type: "text",
                text:
                  `Cleanup preview for ${plan.owner}: ` +
                  `${plan.totalArtifacts} artifact(s), ${formatBytes(
                    plan.totalBytes,
                  )}, across ${plan.repositoriesWithArtifacts} repository/repositories. ` +
                  `No artifacts were deleted.`,
              },
            ],
          };
        } catch (error) {
          return errorResult(error);
        }
      },
    );

    server.registerTool(
      "delete_actions_artifacts",
      {
        title: "Delete GitHub Actions artifacts",
        description:
          'Permanently delete GitHub Actions artifacts matching the requested scope. Call preview_actions_cleanup first. The confirmation value must be exactly "DELETE_ACTIONS_ARTIFACTS".',
        inputSchema: z.object({
          ...cleanupFilterSchema,
          confirmation: z
            .literal("DELETE_ACTIONS_ARTIFACTS")
            .describe(
              'Required exact confirmation phrase: "DELETE_ACTIONS_ARTIFACTS".',
            ),
          maxArtifacts: z
            .number()
            .int()
            .min(1)
            .max(10000)
            .default(5000)
            .describe(
              "Safety cap for the number of artifacts deleted in one invocation.",
            ),
        }),
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      async ({ confirmation: _confirmation, maxArtifacts, ...filters }) => {
        try {
          const plan = await buildCleanupPlan(filters);
          const result = await deleteCleanupPlan(plan, maxArtifacts);
          const deletedBytes = result.deleted.reduce(
            (sum, artifact) => sum + artifact.size_in_bytes,
            0,
          );

          return {
            structuredContent: {
              owner: plan.owner,
              matchedArtifacts: plan.totalArtifacts,
              deletedArtifacts: result.deleted.length,
              failedArtifacts: result.failed.length,
              deletedBytes,
              deletedSize: formatBytes(deletedBytes),
              truncated: result.truncated,
              failures: result.failed.slice(0, 50).map(({ artifact, error }) => ({
                repository: artifact.repository,
                artifactId: artifact.id,
                artifactName: artifact.name,
                error,
              })),
            },
            content: [
              {
                type: "text",
                text:
                  `Deleted ${result.deleted.length} GitHub Actions artifact(s) ` +
                  `totalling ${formatBytes(deletedBytes)}. ` +
                  `${result.failed.length} deletion(s) failed.` +
                  (result.truncated
                    ? ` The safety cap stopped the operation before all ${plan.totalArtifacts} matching artifacts were processed.`
                    : ""),
              },
            ],
            isError: result.failed.length > 0,
          };
        } catch (error) {
          return errorResult(error);
        }
      },
    );
  },
  {},
  {
    basePath: "/api",
  },
);

async function authorizedHandler(request: Request): Promise<Response> {
  if (!isAuthorized(request)) {
    return new Response("Not found", {
      status: 404,
      headers: {
        "Cache-Control": "no-store",
      },
    });
  }

  return mcpHandler(request);
}

export {
  authorizedHandler as GET,
  authorizedHandler as POST,
  authorizedHandler as DELETE,
};
