import fs from "node:fs";
import path from "node:path";
import { Datastore } from "@google-cloud/datastore";
import { Firestore } from "@google-cloud/firestore";
import { Storage } from "@google-cloud/storage";

const API_PREFIX = "/api/project-library";
const FILE_STORE_DIR = path.resolve(process.cwd(), ".runtime-data");
const FILE_STORE_PATH = path.join(FILE_STORE_DIR, "published-projects.json");
const FILE_PDF_DIR = path.join(FILE_STORE_DIR, "published-project-files");
const FIRESTORE_COLLECTION = "publishedProjects";
const DATASTORE_PROJECT_KIND = "PublishedProject";

let firestoreClient = null;
let firestoreInitError = null;
let datastoreClient = null;
let datastoreInitError = null;
let storageClient = null;
let storageInitError = null;

function nowMs() {
  return Date.now();
}

function decodePathSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function json(response, statusCode, body) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(`${JSON.stringify(body)}\n`);
}

function streamPdf(response, fileName, contentType, buffer) {
  response.statusCode = 200;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Length", String(buffer.byteLength));
  response.setHeader("Content-Type", contentType || "application/pdf");
  response.setHeader(
    "Content-Disposition",
    `inline; filename*=UTF-8''${encodeURIComponent(fileName || "project-plan.pdf")}`
  );
  response.end(buffer);
}

function readJsonRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    request.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function readBinaryRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    request.on("end", () => {
      resolve(Buffer.concat(chunks));
    });
    request.on("error", reject);
  });
}

function slugifyProjectValue(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
}

function safeFileName(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, " ");
  return normalized || "project-plan.pdf";
}

function getProjectId() {
  return (
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    process.env.GCP_PROJECT ||
    ""
  ).trim();
}

function getConfiguredBackend() {
  const override = String(process.env.PROJECT_LIBRARY_BACKEND || "").trim().toLowerCase();
  if (override === "file" || override === "firestore" || override === "datastore") {
    return override;
  }
  if (getProjectId()) {
    return "datastore";
  }
  return "file";
}

function getBucketName() {
  const explicit = String(process.env.PROJECT_LIBRARY_BUCKET || "").trim();
  if (explicit) {
    return explicit;
  }
  const projectId = getProjectId();
  return projectId ? `${projectId}.appspot.com` : "";
}

function getFirestore() {
  if (firestoreClient || firestoreInitError) {
    return firestoreClient;
  }

  try {
    firestoreClient = new Firestore();
    return firestoreClient;
  } catch (error) {
    firestoreInitError = error;
    return null;
  }
}

function getDatastore() {
  if (datastoreClient || datastoreInitError) {
    return datastoreClient;
  }

  try {
    datastoreClient = new Datastore();
    return datastoreClient;
  } catch (error) {
    datastoreInitError = error;
    return null;
  }
}

function getStorage() {
  if (storageClient || storageInitError) {
    return storageClient;
  }

  try {
    storageClient = new Storage();
    return storageClient;
  } catch (error) {
    storageInitError = error;
    return null;
  }
}

function buildProjectScope(input) {
  const source = input && typeof input === "object" ? input : {};
  const explicitScope =
    typeof source.scope === "string" && source.scope.trim() ? slugifyProjectValue(source.scope) : "";
  if (explicitScope) {
    return explicitScope;
  }

  const scopedSegments = [
    typeof source.storeCode === "string" ? source.storeCode : "",
    typeof source.city === "string" ? source.city : "",
    typeof source.region === "string" ? source.region : "",
  ]
    .map((value) => slugifyProjectValue(value))
    .filter(Boolean);

  if (scopedSegments.length > 0) {
    return scopedSegments.join("-").slice(0, 96);
  }

  const titleFallback = slugifyProjectValue(typeof source.title === "string" ? source.title : "");
  if (titleFallback) {
    return titleFallback;
  }

  const fallback = slugifyProjectValue(
    typeof source.sourcePdfName === "string" ? source.sourcePdfName.replace(/\.pdf$/i, "") : ""
  );
  if (fallback) {
    return fallback;
  }

  return `project-${nowMs()}`;
}

function normalizeProjectDraft(input) {
  const source = input && typeof input === "object" ? input : {};
  const scope = buildProjectScope(source);
  const title =
    typeof source.title === "string" && source.title.trim()
      ? source.title.trim()
      : scope;
  const sourcePdfName =
    typeof source.sourcePdfName === "string" && source.sourcePdfName.trim()
      ? safeFileName(source.sourcePdfName)
      : `${scope}.pdf`;
  const storeCode =
    typeof source.storeCode === "string" && source.storeCode.trim()
      ? source.storeCode.trim()
      : "";
  const city =
    typeof source.city === "string" && source.city.trim()
      ? source.city.trim()
      : "";
  const region =
    typeof source.region === "string" && source.region.trim()
      ? source.region.trim()
      : "";

  return {
    city,
    region,
    scope,
    sourcePdfName,
    storeCode,
    title,
  };
}

function normalizeProjectRecord(input) {
  const base = normalizeProjectDraft(input);
  const source = input && typeof input === "object" ? input : {};

  return {
    ...base,
    createdAt:
      typeof source.createdAt === "number" && Number.isFinite(source.createdAt)
        ? source.createdAt
        : nowMs(),
    pdfAvailable: Boolean(source.pdfAvailable),
    pdfSizeBytes:
      typeof source.pdfSizeBytes === "number" && Number.isFinite(source.pdfSizeBytes)
        ? Math.max(0, Math.round(source.pdfSizeBytes))
        : 0,
    pdfBucket:
      typeof source.pdfBucket === "string" && source.pdfBucket.trim()
        ? source.pdfBucket.trim()
        : "",
    pdfContentType:
      typeof source.pdfContentType === "string" && source.pdfContentType.trim()
        ? source.pdfContentType.trim()
        : "application/pdf",
    pdfFileName:
      typeof source.pdfFileName === "string" && source.pdfFileName.trim()
        ? source.pdfFileName.trim()
        : base.sourcePdfName,
    pdfLocalPath:
      typeof source.pdfLocalPath === "string" && source.pdfLocalPath.trim()
        ? source.pdfLocalPath.trim()
        : "",
    pdfObjectPath:
      typeof source.pdfObjectPath === "string" && source.pdfObjectPath.trim()
        ? source.pdfObjectPath.trim()
        : "",
    pdfStorageMode:
      typeof source.pdfStorageMode === "string" && source.pdfStorageMode.trim()
        ? source.pdfStorageMode.trim()
        : "file",
    storageMode:
      typeof source.storageMode === "string" && source.storageMode.trim()
        ? source.storageMode.trim()
        : "file",
    updatedAt:
      typeof source.updatedAt === "number" && Number.isFinite(source.updatedAt)
        ? source.updatedAt
        : nowMs(),
  };
}

function readFileStore() {
  if (!fs.existsSync(FILE_STORE_PATH)) {
    return { projects: {} };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(FILE_STORE_PATH, "utf8"));
    return parsed &&
      typeof parsed === "object" &&
      parsed.projects &&
      typeof parsed.projects === "object"
      ? parsed
      : { projects: {} };
  } catch {
    return { projects: {} };
  }
}

function writeFileStore(store) {
  fs.mkdirSync(FILE_STORE_DIR, { recursive: true });
  const tempPath = `${FILE_STORE_PATH}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, FILE_STORE_PATH);
}

async function listProjectsFromFile(limit) {
  const store = readFileStore();
  return Object.keys(store.projects || {})
    .map((scope) => normalizeProjectRecord(store.projects[scope]))
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, limit);
}

async function getProjectFromFile(scope) {
  const store = readFileStore();
  const record = store.projects?.[scope];
  return record ? normalizeProjectRecord(record) : null;
}

async function upsertProjectInFile(projectInput) {
  const store = readFileStore();
  const nextRecord = normalizeProjectRecord({
    ...(store.projects?.[buildProjectScope(projectInput)] || {}),
    ...normalizeProjectDraft(projectInput),
    storageMode: "file",
    updatedAt: nowMs(),
  });

  if (!nextRecord.createdAt) {
    nextRecord.createdAt = nowMs();
  }

  store.projects[nextRecord.scope] = nextRecord;
  writeFileStore(store);
  return normalizeProjectRecord(store.projects[nextRecord.scope]);
}

async function storeProjectPdfInFile(scope, fileName, contentType, buffer) {
  const store = readFileStore();
  const current = normalizeProjectRecord(store.projects?.[scope] || { scope });
  const safeName = safeFileName(fileName || current.sourcePdfName || `${scope}.pdf`);
  const projectDir = path.join(FILE_PDF_DIR, scope);
  const pdfPath = path.join(projectDir, safeName);

  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(pdfPath, buffer);

  const nextRecord = normalizeProjectRecord({
    ...current,
    pdfAvailable: true,
    pdfContentType: contentType || "application/pdf",
    pdfFileName: safeName,
    pdfLocalPath: pdfPath,
    pdfSizeBytes: buffer.byteLength,
    pdfStorageMode: "file",
    storageMode: "file",
    updatedAt: nowMs(),
  });

  store.projects[scope] = nextRecord;
  writeFileStore(store);
  return normalizeProjectRecord(nextRecord);
}

async function getProjectPdfFromFile(scope) {
  const project = await getProjectFromFile(scope);
  if (!project?.pdfAvailable) {
    return null;
  }

  const store = readFileStore();
  const current = store.projects?.[scope];
  const pdfPath =
    typeof current?.pdfLocalPath === "string" && current.pdfLocalPath.trim()
      ? current.pdfLocalPath
      : path.join(FILE_PDF_DIR, scope, safeFileName(project.sourcePdfName));

  if (!fs.existsSync(pdfPath)) {
    return null;
  }

  return {
    buffer: fs.readFileSync(pdfPath),
    contentType:
      typeof current?.pdfContentType === "string" && current.pdfContentType.trim()
        ? current.pdfContentType
        : "application/pdf",
    fileName:
      typeof current?.pdfFileName === "string" && current.pdfFileName.trim()
        ? current.pdfFileName
        : project.sourcePdfName,
  };
}

function datastoreProjectKey(datastore, scope) {
  return datastore.key([DATASTORE_PROJECT_KIND, scope]);
}

function scopeFromDatastoreEntity(entity) {
  const key = entity?.[Datastore.KEY];
  return key?.name || (typeof key?.id !== "undefined" ? String(key.id) : "");
}

async function listProjectsFromDatastore(limit) {
  const datastore = getDatastore();
  if (!datastore) {
    throw datastoreInitError || new Error("Datastore unavailable.");
  }

  const query = datastore
    .createQuery(DATASTORE_PROJECT_KIND)
    .order("updatedAt", { descending: true })
    .limit(limit);
  const [entities] = await datastore.runQuery(query);

  return entities.map((entity) =>
    normalizeProjectRecord({
      ...entity,
      scope: scopeFromDatastoreEntity(entity),
      storageMode: "datastore",
    })
  );
}

async function getProjectFromDatastore(scope) {
  const datastore = getDatastore();
  if (!datastore) {
    throw datastoreInitError || new Error("Datastore unavailable.");
  }

  const [entity] = await datastore.get(datastoreProjectKey(datastore, scope));
  if (!entity) {
    return null;
  }

  return normalizeProjectRecord({
    ...entity,
    scope,
    storageMode: "datastore",
  });
}

async function upsertProjectInDatastore(projectInput) {
  const datastore = getDatastore();
  if (!datastore) {
    throw datastoreInitError || new Error("Datastore unavailable.");
  }

  const draft = normalizeProjectDraft(projectInput);
  const key = datastoreProjectKey(datastore, draft.scope);
  const [entity] = await datastore.get(key);
  const current = entity
    ? normalizeProjectRecord({
        ...entity,
        scope: draft.scope,
        storageMode: "datastore",
      })
    : null;

  const nextRecord = normalizeProjectRecord({
    ...(current || {}),
    ...draft,
    createdAt: current?.createdAt || nowMs(),
    storageMode: "datastore",
    updatedAt: nowMs(),
  });

  await datastore.save({ key, data: nextRecord });
  return nextRecord;
}

async function storeProjectPdfInDatastore(scope, fileName, contentType, buffer) {
  const datastore = getDatastore();
  if (!datastore) {
    throw datastoreInitError || new Error("Datastore unavailable.");
  }

  const storage = getStorage();
  if (!storage) {
    throw storageInitError || new Error("Cloud Storage unavailable.");
  }

  const bucketName = getBucketName();
  if (!bucketName) {
    throw new Error("PROJECT_LIBRARY_BUCKET is not configured.");
  }

  const key = datastoreProjectKey(datastore, scope);
  const [entity] = await datastore.get(key);
  const current = entity
    ? normalizeProjectRecord({
        ...entity,
        scope,
        storageMode: "datastore",
      })
    : normalizeProjectRecord({ scope, storageMode: "datastore" });

  const safeName = safeFileName(fileName || current.sourcePdfName || `${scope}.pdf`);
  const objectPath = `published-projects/${scope}/${safeName}`;
  const bucket = storage.bucket(bucketName);
  const blob = bucket.file(objectPath);

  await blob.save(buffer, {
    contentType: contentType || "application/pdf",
    metadata: {
      cacheControl: "private, max-age=0, no-store",
    },
    resumable: false,
    validation: false,
  });

  const nextRecord = normalizeProjectRecord({
    ...current,
    pdfAvailable: true,
    pdfBucket: bucketName,
    pdfContentType: contentType || "application/pdf",
    pdfFileName: safeName,
    pdfObjectPath: objectPath,
    pdfSizeBytes: buffer.byteLength,
    pdfStorageMode: "cloud-storage",
    storageMode: "datastore",
    updatedAt: nowMs(),
  });

  await datastore.save({ key, data: nextRecord });
  return nextRecord;
}

async function getProjectPdfFromDatastore(scope) {
  const project = await getProjectFromDatastore(scope);
  if (!project?.pdfAvailable) {
    return null;
  }

  const storage = getStorage();
  if (!storage) {
    throw storageInitError || new Error("Cloud Storage unavailable.");
  }

  const bucketName =
    typeof project.pdfBucket === "string" && project.pdfBucket.trim()
      ? project.pdfBucket.trim()
      : getBucketName();
  const objectPath =
    typeof project.pdfObjectPath === "string" && project.pdfObjectPath.trim()
      ? project.pdfObjectPath.trim()
      : "";

  if (!bucketName || !objectPath) {
    return null;
  }

  const [buffer] = await storage.bucket(bucketName).file(objectPath).download();
  return {
    buffer,
    contentType:
      typeof project.pdfContentType === "string" && project.pdfContentType.trim()
        ? project.pdfContentType
        : "application/pdf",
    fileName:
      typeof project.pdfFileName === "string" && project.pdfFileName.trim()
        ? project.pdfFileName
        : project.sourcePdfName,
  };
}

async function listProjectsFromFirestore(limit) {
  const db = getFirestore();
  if (!db) {
    throw firestoreInitError || new Error("Firestore unavailable.");
  }

  const snapshot = await db
    .collection(FIRESTORE_COLLECTION)
    .orderBy("updatedAt", "desc")
    .limit(limit)
    .get();

  return snapshot.docs.map((doc) =>
    normalizeProjectRecord({
      ...doc.data(),
      scope: doc.id,
      storageMode: "firestore",
    })
  );
}

async function getProjectFromFirestore(scope) {
  const db = getFirestore();
  if (!db) {
    throw firestoreInitError || new Error("Firestore unavailable.");
  }

  const snap = await db.collection(FIRESTORE_COLLECTION).doc(scope).get();
  if (!snap.exists) {
    return null;
  }

  return normalizeProjectRecord({
    ...snap.data(),
    scope,
    storageMode: "firestore",
  });
}

async function upsertProjectInFirestore(projectInput) {
  const db = getFirestore();
  if (!db) {
    throw firestoreInitError || new Error("Firestore unavailable.");
  }

  const draft = normalizeProjectDraft(projectInput);
  const ref = db.collection(FIRESTORE_COLLECTION).doc(draft.scope);
  const currentSnap = await ref.get();
  const current = currentSnap.exists
    ? normalizeProjectRecord({
        ...currentSnap.data(),
        scope: draft.scope,
        storageMode: "firestore",
      })
    : null;

  const nextRecord = normalizeProjectRecord({
    ...(current || {}),
    ...draft,
    createdAt: current?.createdAt || nowMs(),
    storageMode: "firestore",
    updatedAt: nowMs(),
  });

  await ref.set(nextRecord, { merge: true });
  return nextRecord;
}

async function storeProjectPdfInFirestore(scope, fileName, contentType, buffer) {
  const db = getFirestore();
  if (!db) {
    throw firestoreInitError || new Error("Firestore unavailable.");
  }

  const storage = getStorage();
  if (!storage) {
    throw storageInitError || new Error("Cloud Storage unavailable.");
  }

  const bucketName = getBucketName();
  if (!bucketName) {
    throw new Error("PROJECT_LIBRARY_BUCKET is not configured.");
  }

  const ref = db.collection(FIRESTORE_COLLECTION).doc(scope);
  const currentSnap = await ref.get();
  const current = currentSnap.exists
    ? normalizeProjectRecord({
        ...currentSnap.data(),
        scope,
        storageMode: "firestore",
      })
    : normalizeProjectRecord({ scope, storageMode: "firestore" });

  const safeName = safeFileName(fileName || current.sourcePdfName || `${scope}.pdf`);
  const objectPath = `published-projects/${scope}/${safeName}`;
  const bucket = storage.bucket(bucketName);
  const blob = bucket.file(objectPath);

  await blob.save(buffer, {
    contentType: contentType || "application/pdf",
    metadata: {
      cacheControl: "private, max-age=0, no-store",
    },
    resumable: false,
    validation: false,
  });

  const nextRecord = normalizeProjectRecord({
    ...current,
    pdfAvailable: true,
    pdfBucket: bucketName,
    pdfContentType: contentType || "application/pdf",
    pdfFileName: safeName,
    pdfObjectPath: objectPath,
    pdfSizeBytes: buffer.byteLength,
    pdfStorageMode: "cloud-storage",
    storageMode: "firestore",
    updatedAt: nowMs(),
  });

  await ref.set(nextRecord, { merge: true });
  return nextRecord;
}

async function getProjectPdfFromFirestore(scope) {
  const project = await getProjectFromFirestore(scope);
  if (!project?.pdfAvailable) {
    return null;
  }

  const db = getFirestore();
  if (!db) {
    throw firestoreInitError || new Error("Firestore unavailable.");
  }

  const storage = getStorage();
  if (!storage) {
    throw storageInitError || new Error("Cloud Storage unavailable.");
  }

  const snap = await db.collection(FIRESTORE_COLLECTION).doc(scope).get();
  if (!snap.exists) {
    return null;
  }

  const data = snap.data() || {};
  const bucketName =
    typeof data.pdfBucket === "string" && data.pdfBucket.trim()
      ? data.pdfBucket.trim()
      : getBucketName();
  const objectPath =
    typeof data.pdfObjectPath === "string" && data.pdfObjectPath.trim()
      ? data.pdfObjectPath.trim()
      : "";
  if (!bucketName || !objectPath) {
    return null;
  }

  const [buffer] = await storage.bucket(bucketName).file(objectPath).download();
  return {
    buffer,
    contentType:
      typeof data.pdfContentType === "string" && data.pdfContentType.trim()
        ? data.pdfContentType
        : "application/pdf",
    fileName:
      typeof data.pdfFileName === "string" && data.pdfFileName.trim()
        ? data.pdfFileName
        : project.sourcePdfName,
  };
}

async function listProjects(limit) {
  const backend = getConfiguredBackend();
  if (backend === "datastore") {
    return listProjectsFromDatastore(limit);
  }
  if (backend === "firestore") {
    return listProjectsFromFirestore(limit);
  }
  return listProjectsFromFile(limit);
}

async function getProject(scope) {
  const backend = getConfiguredBackend();
  if (backend === "datastore") {
    return getProjectFromDatastore(scope);
  }
  if (backend === "firestore") {
    return getProjectFromFirestore(scope);
  }
  return getProjectFromFile(scope);
}

async function upsertProject(projectInput) {
  const backend = getConfiguredBackend();
  if (backend === "datastore") {
    return upsertProjectInDatastore(projectInput);
  }
  if (backend === "firestore") {
    return upsertProjectInFirestore(projectInput);
  }
  return upsertProjectInFile(projectInput);
}

async function storeProjectPdf(scope, fileName, contentType, buffer) {
  const backend = getConfiguredBackend();
  if (backend === "datastore") {
    return storeProjectPdfInDatastore(scope, fileName, contentType, buffer);
  }
  if (backend === "firestore") {
    return storeProjectPdfInFirestore(scope, fileName, contentType, buffer);
  }
  return storeProjectPdfInFile(scope, fileName, contentType, buffer);
}

async function getProjectPdf(scope) {
  const backend = getConfiguredBackend();
  if (backend === "datastore") {
    return getProjectPdfFromDatastore(scope);
  }
  if (backend === "firestore") {
    return getProjectPdfFromFirestore(scope);
  }
  return getProjectPdfFromFile(scope);
}

export function createProjectLibraryMiddleware() {
  return async (request, response, next) => {
    const requestUrl = new URL(request.url || "/", "http://localhost");
    if (!requestUrl.pathname.startsWith(API_PREFIX)) {
      next();
      return;
    }

    try {
      const segments = requestUrl.pathname
        .replace(/^\/+|\/+$/g, "")
        .split("/")
        .map((value) => decodePathSegment(value));

      if (request.method === "GET" && segments.length === 2) {
        const limit = Math.min(
          100,
          Math.max(1, Number.parseInt(requestUrl.searchParams.get("limit") || "25", 10) || 25)
        );
        const projects = await listProjects(limit);
        json(response, 200, { ok: true, projects });
        return;
      }

      if (request.method === "POST" && segments.length === 2) {
        const body = await readJsonRequestBody(request);
        const project = await upsertProject(body?.project);
        json(response, 200, { ok: true, project });
        return;
      }

      if (segments.length < 3) {
        json(response, 404, { ok: false, error: "Not found." });
        return;
      }

      const scope = segments[2];

      if (request.method === "GET" && segments.length === 3) {
        const project = await getProject(scope);
        json(response, 200, { ok: true, project });
        return;
      }

      if (request.method === "PUT" && segments.length === 4 && segments[3] === "file") {
        const fileName = safeFileName(
          decodePathSegment(String(request.headers["x-file-name"] || "")) || `${scope}.pdf`
        );
        const contentType =
          typeof request.headers["content-type"] === "string" && request.headers["content-type"]
            ? request.headers["content-type"]
            : "application/pdf";
        const buffer = await readBinaryRequestBody(request);
        const project = await storeProjectPdf(scope, fileName, contentType, buffer);
        json(response, 200, { ok: true, project });
        return;
      }

      if (request.method === "GET" && segments.length === 4 && segments[3] === "file") {
        const filePayload = await getProjectPdf(scope);
        if (!filePayload) {
          json(response, 404, { ok: false, error: "Project PDF not found." });
          return;
        }
        streamPdf(response, filePayload.fileName, filePayload.contentType, filePayload.buffer);
        return;
      }

      json(response, 404, { ok: false, error: "Not found." });
    } catch (error) {
      console.error("[project-library-api]", error);
      json(response, 500, {
        error: error instanceof Error ? error.message : "Unexpected project library error.",
        ok: false,
      });
    }
  };
}
