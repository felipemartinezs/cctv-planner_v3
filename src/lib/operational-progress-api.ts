import type {
  OperationalDeviceProgress,
  OperationalProjectMeta,
  OperationalProjectRecord,
} from "../types";

interface OperationalProjectResponse {
  deviceProgressByKey: Record<string, OperationalDeviceProgress>;
  ok: boolean;
  project: OperationalProjectRecord | null;
  storageMode: string;
}

interface OperationalProjectListResponse {
  ok: boolean;
  projects: OperationalProjectRecord[];
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T & { error?: string; ok?: boolean };
  if (!response.ok || (payload && payload.ok === false)) {
    throw new Error(payload?.error || `Operational progress request failed with ${response.status}.`);
  }
  return payload as T;
}

export async function fetchOperationalProject(
  scope: string
): Promise<OperationalProjectResponse> {
  const response = await fetch(`/api/operational-projects/${encodeURIComponent(scope)}`, {
    cache: "no-store",
    credentials: "same-origin",
  });
  return parseJsonResponse<OperationalProjectResponse>(response);
}

export async function listOperationalProjects(limit = 25): Promise<OperationalProjectRecord[]> {
  const response = await fetch(`/api/operational-projects?limit=${limit}`, {
    cache: "no-store",
    credentials: "same-origin",
  });
  const payload = await parseJsonResponse<OperationalProjectListResponse>(response);
  return payload.projects;
}

export async function syncOperationalProjectSnapshot(
  scope: string,
  project: OperationalProjectMeta,
  deviceProgressByKey: Record<string, OperationalDeviceProgress>
): Promise<OperationalProjectResponse> {
  const response = await fetch(`/api/operational-projects/${encodeURIComponent(scope)}`, {
    body: JSON.stringify({
      deviceProgressByKey,
      project,
    }),
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
    },
    method: "PUT",
  });
  return parseJsonResponse<OperationalProjectResponse>(response);
}

export async function syncOperationalDeviceProgress(
  scope: string,
  project: OperationalProjectMeta,
  deviceKey: string,
  progress: OperationalDeviceProgress
): Promise<OperationalProjectResponse> {
  const response = await fetch(
    `/api/operational-projects/${encodeURIComponent(scope)}/devices/${encodeURIComponent(deviceKey)}`,
    {
      body: JSON.stringify({
        progress,
        project,
      }),
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
      },
      method: "PUT",
    }
  );
  return parseJsonResponse<OperationalProjectResponse>(response);
}
