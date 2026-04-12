import type { PublishedProjectDraft, PublishedProjectRecord } from "../types";

const PROJECT_LIBRARY_API_PREFIX = "/api/project-library";

interface ProjectLibraryListResponse {
  ok: true;
  projects: PublishedProjectRecord[];
}

interface ProjectLibraryProjectResponse {
  ok: true;
  project: PublishedProjectRecord | null;
}

export interface PublishedProjectFilePayload {
  bytes: Uint8Array;
  fileName: string;
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const payload = (await response.json()) as { error?: string };
      if (payload?.error) {
        message = payload.error;
      }
    } catch {
      // ignore malformed error body
    }
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

export async function listPublishedProjects(limit = 25): Promise<PublishedProjectRecord[]> {
  const response = await fetch(
    `${PROJECT_LIBRARY_API_PREFIX}?limit=${encodeURIComponent(String(limit))}`,
    {
      cache: "no-store",
    }
  );
  const payload = await readJsonResponse<ProjectLibraryListResponse>(response);
  return Array.isArray(payload.projects) ? payload.projects : [];
}

export async function fetchPublishedProject(scope: string): Promise<PublishedProjectRecord | null> {
  const response = await fetch(`${PROJECT_LIBRARY_API_PREFIX}/${encodeURIComponent(scope)}`, {
    cache: "no-store",
  });
  const payload = await readJsonResponse<ProjectLibraryProjectResponse>(response);
  return payload.project ?? null;
}

export async function createPublishedProject(
  draft: PublishedProjectDraft
): Promise<PublishedProjectRecord> {
  const response = await fetch(PROJECT_LIBRARY_API_PREFIX, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      project: draft,
    }),
  });

  const payload = await readJsonResponse<ProjectLibraryProjectResponse>(response);
  if (!payload.project) {
    throw new Error("Project library did not return a project record.");
  }
  return payload.project;
}

export async function uploadPublishedProjectPdf(
  scope: string,
  file: File
): Promise<PublishedProjectRecord> {
  const response = await fetch(
    `${PROJECT_LIBRARY_API_PREFIX}/${encodeURIComponent(scope)}/file`,
    {
      method: "PUT",
      headers: {
        "Content-Type": file.type || "application/pdf",
        "X-File-Name": encodeURIComponent(file.name),
      },
      body: file,
    }
  );

  const payload = await readJsonResponse<ProjectLibraryProjectResponse>(response);
  if (!payload.project) {
    throw new Error("Project library did not confirm the uploaded PDF.");
  }
  return payload.project;
}

function parseFileNameFromDisposition(value: string | null): string {
  if (!value) {
    return "project-plan.pdf";
  }

  const utf8Match = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }

  const plainMatch = value.match(/filename="?([^";]+)"?/i);
  if (plainMatch?.[1]) {
    return plainMatch[1];
  }

  return "project-plan.pdf";
}

export async function downloadPublishedProjectPdf(
  scope: string
): Promise<PublishedProjectFilePayload> {
  const response = await fetch(
    `${PROJECT_LIBRARY_API_PREFIX}/${encodeURIComponent(scope)}/file`,
    {
      cache: "no-store",
    }
  );

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const payload = (await response.json()) as { error?: string };
      if (payload?.error) {
        message = payload.error;
      }
    } catch {
      // ignore malformed error body
    }
    throw new Error(message);
  }

  const fileName = parseFileNameFromDisposition(response.headers.get("Content-Disposition"));
  const arrayBuffer = await response.arrayBuffer();
  return {
    bytes: new Uint8Array(arrayBuffer),
    fileName,
  };
}
