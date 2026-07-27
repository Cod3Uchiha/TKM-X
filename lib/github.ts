const GITHUB_API_ROOT = "https://api.github.com";
const API_VERSION = "2022-11-28";

export type Repository = {
  name: string;
  full_name: string;
  owner: {
    login: string;
  };
  private: boolean;
  archived: boolean;
};

export type Artifact = {
  id: number;
  name: string;
  size_in_bytes: number;
  expired: boolean;
  created_at: string;
  expires_at: string | null;
  workflow_run?: {
    id: number;
    head_branch: string | null;
    head_sha: string;
  } | null;
};

type ArtifactListResponse = {
  total_count: number;
  artifacts: Artifact[];
};

export type ArtifactWithRepository = Artifact & {
  repository: string;
};

export type CleanupFilters = {
  repository?: string;
  olderThanDays?: number;
  keepLatestPerRepository?: number;
};

export type CleanupPlan = {
  owner: string;
  scannedRepositories: number;
  repositoriesWithArtifacts: number;
  totalArtifacts: number;
  totalBytes: number;
  artifacts: ArtifactWithRepository[];
};

export class GitHubApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "GitHubApiError";
  }
}

function requiredEnv(name: "GITHUB_TOKEN" | "GITHUB_OWNER"): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is not configured`);
  }

  return value;
}

async function githubRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = requiredEnv("GITHUB_TOKEN");

  const response = await fetch(`${GITHUB_API_ROOT}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": API_VERSION,
      "User-Agent": "github-actions-cleaner-mcp/1.0",
      ...init.headers,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    let details: unknown;

    try {
      details = await response.json();
    } catch {
      details = await response.text();
    }

    throw new GitHubApiError(
      `GitHub API request failed with HTTP ${response.status}`,
      response.status,
      details,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

async function paginate<T>(
  buildPath: (page: number) => string,
  selectItems: (response: unknown) => T[],
): Promise<T[]> {
  const items: T[] = [];

  for (let page = 1; ; page += 1) {
    const response = await githubRequest<unknown>(buildPath(page));
    const pageItems = selectItems(response);
    items.push(...pageItems);

    if (pageItems.length < 100) {
      break;
    }
  }

  return items;
}

export async function listOwnedRepositories(): Promise<Repository[]> {
  const owner = requiredEnv("GITHUB_OWNER").toLowerCase();

  const repositories = await paginate<Repository>(
    (page) =>
      `/user/repos?affiliation=owner&sort=full_name&direction=asc&per_page=100&page=${page}`,
    (response) => response as Repository[],
  );

  return repositories.filter(
    (repository) =>
      repository.owner.login.toLowerCase() === owner && !repository.archived,
  );
}

export async function listRepositoryArtifacts(
  repository: string,
): Promise<Artifact[]> {
  const owner = requiredEnv("GITHUB_OWNER");

  return paginate<Artifact>(
    (page) =>
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
        repository,
      )}/actions/artifacts?per_page=100&page=${page}`,
    (response) => (response as ArtifactListResponse).artifacts,
  );
}

function artifactMatchesAge(
  artifact: Artifact,
  olderThanDays?: number,
): boolean {
  if (olderThanDays === undefined) {
    return true;
  }

  const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
  return new Date(artifact.created_at).getTime() <= cutoff;
}

function applyRepositoryFilters(
  artifacts: Artifact[],
  filters: CleanupFilters,
): Artifact[] {
  const sorted = [...artifacts].sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  const keep = filters.keepLatestPerRepository ?? 0;

  return sorted
    .slice(Math.max(0, keep))
    .filter((artifact) => artifactMatchesAge(artifact, filters.olderThanDays));
}

export async function buildCleanupPlan(
  filters: CleanupFilters,
): Promise<CleanupPlan> {
  const owner = requiredEnv("GITHUB_OWNER");
  const allRepositories = await listOwnedRepositories();

  const requestedRepository = filters.repository?.trim();
  const repositories = requestedRepository
    ? allRepositories.filter(
        (repository) =>
          repository.name.toLowerCase() === requestedRepository.toLowerCase(),
      )
    : allRepositories;

  if (requestedRepository && repositories.length === 0) {
    throw new Error(
      `Repository "${requestedRepository}" was not found among repositories owned by ${owner}`,
    );
  }

  const artifacts: ArtifactWithRepository[] = [];
  let repositoriesWithArtifacts = 0;

  for (const repository of repositories) {
    const repositoryArtifacts = await listRepositoryArtifacts(repository.name);
    const matching = applyRepositoryFilters(repositoryArtifacts, filters);

    if (matching.length > 0) {
      repositoriesWithArtifacts += 1;
    }

    artifacts.push(
      ...matching.map((artifact) => ({
        ...artifact,
        repository: repository.name,
      })),
    );
  }

  return {
    owner,
    scannedRepositories: repositories.length,
    repositoriesWithArtifacts,
    totalArtifacts: artifacts.length,
    totalBytes: artifacts.reduce(
      (sum, artifact) => sum + artifact.size_in_bytes,
      0,
    ),
    artifacts,
  };
}

export async function deleteArtifact(
  repository: string,
  artifactId: number,
): Promise<void> {
  const owner = requiredEnv("GITHUB_OWNER");

  await githubRequest<void>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
      repository,
    )}/actions/artifacts/${artifactId}`,
    {
      method: "DELETE",
    },
  );
}

export async function deleteCleanupPlan(
  plan: CleanupPlan,
  maxArtifacts: number,
): Promise<{
  deleted: ArtifactWithRepository[];
  failed: Array<{
    artifact: ArtifactWithRepository;
    error: string;
  }>;
  truncated: boolean;
}> {
  const selected = plan.artifacts.slice(0, maxArtifacts);
  const deleted: ArtifactWithRepository[] = [];
  const failed: Array<{
    artifact: ArtifactWithRepository;
    error: string;
  }> = [];

  // Sequential deletion is deliberately conservative with GitHub API limits.
  for (const artifact of selected) {
    try {
      await deleteArtifact(artifact.repository, artifact.id);
      deleted.push(artifact);
    } catch (error) {
      failed.push({
        artifact,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    deleted,
    failed,
    truncated: plan.artifacts.length > selected.length,
  };
}
