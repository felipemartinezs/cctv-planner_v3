import fs from "node:fs";
import path from "node:path";
import { Datastore } from "@google-cloud/datastore";
import { Firestore } from "@google-cloud/firestore";

const API_PREFIX = "/api/operational-projects";
const FILE_STORE_DIR = path.resolve(process.cwd(), ".runtime-data");
const FILE_STORE_PATH = path.join(FILE_STORE_DIR, "operational-progress.json");
const FIRESTORE_COLLECTION = "operationalProjects";
const DATASTORE_PROJECT_KIND = "OperationalProject";
const DATASTORE_PROGRESS_KIND = "OperationalDeviceProgress";

let firestoreClient = null;
let firestoreInitError = null;
let datastoreClient = null;
let datastoreInitError = null;

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

function readRequestBody(request) {
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

function normalizeProjectMeta(scope, input) {
  const source = input && typeof input === "object" ? input : {};
  const title =
    typeof source.title === "string" && source.title.trim()
      ? source.title.trim()
      : scope;
  const sourcePdfName =
    typeof source.sourcePdfName === "string" && source.sourcePdfName.trim()
      ? source.sourcePdfName.trim()
      : title;
  const markerCount =
    typeof source.markerCount === "number" && Number.isFinite(source.markerCount)
      ? Math.max(0, Math.round(source.markerCount))
      : 0;

  return {
    markerCount,
    scope,
    sourcePdfName,
    title,
  };
}

const PROGRESS_STEP_KEYS = ["cableRun", "installed", "switchConnected"];

function normalizeStamp(input) {
  if (!input || typeof input !== "object") {
    return null;
  }
  const by = input.by;
  if (!by || typeof by !== "object") {
    return null;
  }
  const id = typeof by.id === "string" ? by.id.trim() : "";
  const name = typeof by.name === "string" ? by.name.trim() : "";
  const initials =
    typeof by.initials === "string" && by.initials.trim()
      ? by.initials.trim().slice(0, 4).toUpperCase()
      : name
        ? name
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((token) => token[0])
            .join("")
            .toUpperCase()
        : "";
  if (!id || !name) {
    return null;
  }
  const at =
    typeof input.at === "number" && Number.isFinite(input.at) ? input.at : nowMs();
  return { by: { id, name, initials }, at };
}

function normalizeStamps(input, progress) {
  if (!input || typeof input !== "object") {
    return null;
  }
  const result = {};
  PROGRESS_STEP_KEYS.forEach((step) => {
    if (!progress[step]) {
      return;
    }
    const stamp = normalizeStamp(input[step]);
    if (stamp) {
      result[step] = stamp;
    }
  });
  return Object.keys(result).length > 0 ? result : null;
}

function normalizeDeviceProgress(input) {
  if (!input || typeof input !== "object") {
    return null;
  }

  const progress = {
    cableRun: Boolean(input.cableRun),
    installed: Boolean(input.installed),
    switchConnected: Boolean(input.switchConnected),
    updatedAt:
      typeof input.updatedAt === "number" && Number.isFinite(input.updatedAt)
        ? input.updatedAt
        : nowMs(),
  };

  const stamps = normalizeStamps(input.stamps, progress);
  if (stamps) {
    progress.stamps = stamps;
  }

  return progress;
}

function hasActiveProgress(progress) {
  return Boolean(progress?.cableRun || progress?.installed || progress?.switchConnected);
}

function normalizeProjectDoc(doc, scope, fallback = {}) {
  const source = doc && typeof doc === "object" ? doc : {};
  return {
    createdAt:
      typeof source.createdAt === "number" && Number.isFinite(source.createdAt)
        ? source.createdAt
        : typeof fallback.createdAt === "number"
          ? fallback.createdAt
          : nowMs(),
    deviceCount:
      typeof source.deviceCount === "number" && Number.isFinite(source.deviceCount)
        ? Math.max(0, Math.round(source.deviceCount))
        : typeof fallback.deviceCount === "number"
          ? fallback.deviceCount
          : 0,
    markerCount:
      typeof source.markerCount === "number" && Number.isFinite(source.markerCount)
        ? Math.max(0, Math.round(source.markerCount))
        : typeof fallback.markerCount === "number"
          ? fallback.markerCount
          : 0,
    scope,
    sourcePdfName:
      typeof source.sourcePdfName === "string" && source.sourcePdfName.trim()
        ? source.sourcePdfName.trim()
        : typeof fallback.sourcePdfName === "string"
          ? fallback.sourcePdfName
          : scope,
    title:
      typeof source.title === "string" && source.title.trim()
        ? source.title.trim()
        : typeof fallback.title === "string"
          ? fallback.title
          : scope,
    updatedAt:
      typeof source.updatedAt === "number" && Number.isFinite(source.updatedAt)
        ? source.updatedAt
        : typeof fallback.updatedAt === "number"
          ? fallback.updatedAt
          : 0,
  };
}

function readFileStore() {
  if (!fs.existsSync(FILE_STORE_PATH)) {
    return { projects: {} };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(FILE_STORE_PATH, "utf8"));
    return parsed && typeof parsed === "object" && parsed.projects && typeof parsed.projects === "object"
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

function getConfiguredBackend() {
  const override = String(process.env.OPERATIONAL_PROGRESS_BACKEND || "").trim().toLowerCase();
  if (override === "file" || override === "firestore" || override === "datastore") {
    return override;
  }
  if (process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT) {
    return "datastore";
  }
  return "file";
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

async function listProjectsFromFile(limit) {
  const store = readFileStore();
  return Object.keys(store.projects || {})
    .map((scope) => {
      const project = normalizeProjectDoc(store.projects[scope], scope);
      return {
        ...project,
        storageMode: "file",
      };
    })
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, limit);
}

async function getProjectFromFile(scope) {
  const store = readFileStore();
  const projectEntry = store.projects?.[scope];
  if (!projectEntry) {
    return {
      deviceProgressByKey: {},
      project: null,
      storageMode: "file",
    };
  }

  const deviceProgressByKey = {};
  Object.keys(projectEntry.deviceProgressByKey || {}).forEach((deviceKey) => {
    const normalized = normalizeDeviceProgress(projectEntry.deviceProgressByKey[deviceKey]);
    if (normalized && hasActiveProgress(normalized)) {
      deviceProgressByKey[deviceKey] = normalized;
    }
  });

  return {
    deviceProgressByKey,
    project: {
      ...normalizeProjectDoc(projectEntry, scope),
      deviceCount: Object.keys(deviceProgressByKey).length,
      storageMode: "file",
    },
    storageMode: "file",
  };
}

async function mergeProjectSnapshotInFile(scope, projectInput, snapshotInput) {
  const store = readFileStore();
  const currentProject = store.projects?.[scope] || {};
  const nextProject = normalizeProjectDoc(currentProject, scope, normalizeProjectMeta(scope, projectInput));
  const nextProgressByKey = { ...(currentProject.deviceProgressByKey || {}) };

  Object.keys(snapshotInput || {}).forEach((deviceKey) => {
    const normalized = normalizeDeviceProgress(snapshotInput[deviceKey]);
    if (!normalized) {
      return;
    }
    const currentValue = normalizeDeviceProgress(nextProgressByKey[deviceKey]);
    if (!currentValue || normalized.updatedAt >= currentValue.updatedAt) {
      if (hasActiveProgress(normalized)) {
        nextProgressByKey[deviceKey] = normalized;
      } else {
        delete nextProgressByKey[deviceKey];
      }
    }
  });

  const latestDeviceUpdate = Object.values(nextProgressByKey).reduce(
    (max, value) => Math.max(max, normalizeDeviceProgress(value)?.updatedAt || 0),
    0
  );

  store.projects[scope] = {
    ...nextProject,
    createdAt: nextProject.createdAt || nowMs(),
    deviceCount: Object.keys(nextProgressByKey).length,
    deviceProgressByKey: nextProgressByKey,
    updatedAt: Math.max(nextProject.updatedAt || 0, latestDeviceUpdate, nowMs()),
  };
  writeFileStore(store);
  return getProjectFromFile(scope);
}

async function mergeDeviceInFile(scope, projectInput, deviceKey, progressInput) {
  return mergeProjectSnapshotInFile(scope, projectInput, {
    [deviceKey]: progressInput,
  });
}

function datastoreProjectKey(datastore, scope) {
  return datastore.key([DATASTORE_PROJECT_KIND, scope]);
}

function datastoreProgressKey(datastore, scope, deviceKey) {
  return datastore.key([DATASTORE_PROJECT_KIND, scope, DATASTORE_PROGRESS_KIND, deviceKey]);
}

function scopeFromDatastoreEntity(entity) {
  const key = entity?.[Datastore.KEY];
  return key?.name || (typeof key?.id !== "undefined" ? String(key.id) : "");
}

function deviceKeyFromDatastoreEntity(entity) {
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

  return entities.map((entity) => ({
    ...normalizeProjectDoc(entity, scopeFromDatastoreEntity(entity)),
    storageMode: "datastore",
  }));
}

async function getProjectFromDatastore(scope) {
  const datastore = getDatastore();
  if (!datastore) {
    throw datastoreInitError || new Error("Datastore unavailable.");
  }

  const projectKey = datastoreProjectKey(datastore, scope);
  const progressQuery = datastore.createQuery(DATASTORE_PROGRESS_KIND).hasAncestor(projectKey);
  const [[projectEntity], [progressEntities]] = await Promise.all([
    datastore.get(projectKey),
    datastore.runQuery(progressQuery),
  ]);

  const deviceProgressByKey = {};
  progressEntities.forEach((entity) => {
    const normalized = normalizeDeviceProgress(entity);
    const deviceKey = deviceKeyFromDatastoreEntity(entity);
    if (deviceKey && normalized && hasActiveProgress(normalized)) {
      deviceProgressByKey[deviceKey] = normalized;
    }
  });

  return {
    deviceProgressByKey,
    project: projectEntity
      ? {
          ...normalizeProjectDoc(projectEntity, scope),
          deviceCount: Object.keys(deviceProgressByKey).length,
          storageMode: "datastore",
        }
      : null,
    storageMode: "datastore",
  };
}

async function mergeProjectSnapshotInDatastore(scope, projectInput, snapshotInput) {
  const datastore = getDatastore();
  if (!datastore) {
    throw datastoreInitError || new Error("Datastore unavailable.");
  }

  const projectKey = datastoreProjectKey(datastore, scope);
  const progressQuery = datastore.createQuery(DATASTORE_PROGRESS_KIND).hasAncestor(projectKey);
  const [[projectEntity], [progressEntities]] = await Promise.all([
    datastore.get(projectKey),
    datastore.runQuery(progressQuery),
  ]);

  const currentMeta = projectEntity ? normalizeProjectDoc(projectEntity, scope) : null;
  const nextMeta = normalizeProjectDoc(
    {
      ...(currentMeta || {}),
      ...normalizeProjectMeta(scope, projectInput),
    },
    scope,
    currentMeta || undefined
  );

  const existingProgress = new Map();
  progressEntities.forEach((entity) => {
    const deviceKey = deviceKeyFromDatastoreEntity(entity);
    if (!deviceKey) {
      return;
    }
    existingProgress.set(deviceKey, normalizeDeviceProgress(entity));
  });

  const nextProgressByKey = {};
  existingProgress.forEach((value, deviceKey) => {
    if (value && hasActiveProgress(value)) {
      nextProgressByKey[deviceKey] = value;
    }
  });

  const saves = [];
  const deletes = [];

  Object.keys(snapshotInput || {}).forEach((deviceKey) => {
    const incoming = normalizeDeviceProgress(snapshotInput[deviceKey]);
    if (!incoming) {
      return;
    }
    const currentValue = existingProgress.get(deviceKey);
    if (!currentValue || incoming.updatedAt >= currentValue.updatedAt) {
      const key = datastoreProgressKey(datastore, scope, deviceKey);
      if (hasActiveProgress(incoming)) {
        saves.push({ key, data: incoming });
        nextProgressByKey[deviceKey] = incoming;
      } else {
        deletes.push(key);
        delete nextProgressByKey[deviceKey];
      }
    }
  });

  const latestDeviceUpdate = Object.values(nextProgressByKey).reduce(
    (max, value) => Math.max(max, normalizeDeviceProgress(value)?.updatedAt || 0),
    0
  );
  const updatedAt = Math.max(currentMeta?.updatedAt || 0, latestDeviceUpdate, nowMs());

  saves.push({
    key: projectKey,
    data: {
      ...nextMeta,
      createdAt: currentMeta?.createdAt || nowMs(),
      deviceCount: Object.keys(nextProgressByKey).length,
      updatedAt,
    },
  });

  if (saves.length > 0) {
    await datastore.save(saves);
  }
  if (deletes.length > 0) {
    await datastore.delete(deletes);
  }

  return {
    deviceProgressByKey: nextProgressByKey,
    project: {
      ...nextMeta,
      createdAt: currentMeta?.createdAt || nowMs(),
      deviceCount: Object.keys(nextProgressByKey).length,
      storageMode: "datastore",
      updatedAt,
    },
    storageMode: "datastore",
  };
}

async function mergeDeviceInDatastore(scope, projectInput, deviceKey, progressInput) {
  return mergeProjectSnapshotInDatastore(scope, projectInput, {
    [deviceKey]: progressInput,
  });
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

  return snapshot.docs.map((doc) => ({
    ...normalizeProjectDoc(doc.data(), doc.id),
    storageMode: "firestore",
  }));
}

async function getProjectFromFirestore(scope) {
  const db = getFirestore();
  if (!db) {
    throw firestoreInitError || new Error("Firestore unavailable.");
  }

  const projectRef = db.collection(FIRESTORE_COLLECTION).doc(scope);
  const [projectSnap, progressSnap] = await Promise.all([
    projectRef.get(),
    projectRef.collection("deviceProgress").get(),
  ]);

  const deviceProgressByKey = {};
  progressSnap.docs.forEach((doc) => {
    const normalized = normalizeDeviceProgress(doc.data());
    if (normalized && hasActiveProgress(normalized)) {
      deviceProgressByKey[doc.id] = normalized;
    }
  });

  return {
    deviceProgressByKey,
    project: projectSnap.exists
      ? {
          ...normalizeProjectDoc(projectSnap.data(), scope),
          deviceCount: Object.keys(deviceProgressByKey).length,
          storageMode: "firestore",
        }
      : null,
    storageMode: "firestore",
  };
}

async function mergeProjectSnapshotInFirestore(scope, projectInput, snapshotInput) {
  const db = getFirestore();
  if (!db) {
    throw firestoreInitError || new Error("Firestore unavailable.");
  }

  const projectRef = db.collection(FIRESTORE_COLLECTION).doc(scope);
  const [projectSnap, progressSnap] = await Promise.all([
    projectRef.get(),
    projectRef.collection("deviceProgress").get(),
  ]);

  const currentMeta = projectSnap.exists ? normalizeProjectDoc(projectSnap.data(), scope) : null;
  const nextMeta = normalizeProjectDoc(
    {
      ...(currentMeta || {}),
      ...normalizeProjectMeta(scope, projectInput),
    },
    scope,
    currentMeta || undefined
  );

  const existingProgress = new Map();
  progressSnap.docs.forEach((doc) => {
    existingProgress.set(doc.id, normalizeDeviceProgress(doc.data()));
  });

  const batch = db.batch();
  const nextProgressByKey = {};

  existingProgress.forEach((value, deviceKey) => {
    if (value && hasActiveProgress(value)) {
      nextProgressByKey[deviceKey] = value;
    }
  });

  Object.keys(snapshotInput || {}).forEach((deviceKey) => {
    const incoming = normalizeDeviceProgress(snapshotInput[deviceKey]);
    if (!incoming) {
      return;
    }
    const currentValue = existingProgress.get(deviceKey);
    if (!currentValue || incoming.updatedAt >= currentValue.updatedAt) {
      const deviceRef = projectRef.collection("deviceProgress").doc(deviceKey);
      if (hasActiveProgress(incoming)) {
        batch.set(deviceRef, incoming, { merge: true });
        nextProgressByKey[deviceKey] = incoming;
      } else {
        batch.delete(deviceRef);
        delete nextProgressByKey[deviceKey];
      }
    }
  });

  const latestDeviceUpdate = Object.values(nextProgressByKey).reduce(
    (max, value) => Math.max(max, normalizeDeviceProgress(value)?.updatedAt || 0),
    0
  );

  batch.set(
    projectRef,
    {
      ...nextMeta,
      createdAt: currentMeta?.createdAt || nowMs(),
      deviceCount: Object.keys(nextProgressByKey).length,
      updatedAt: Math.max(currentMeta?.updatedAt || 0, latestDeviceUpdate, nowMs()),
    },
    { merge: true }
  );

  await batch.commit();
  return {
    deviceProgressByKey: nextProgressByKey,
    project: {
      ...nextMeta,
      createdAt: currentMeta?.createdAt || nowMs(),
      deviceCount: Object.keys(nextProgressByKey).length,
      storageMode: "firestore",
      updatedAt: Math.max(currentMeta?.updatedAt || 0, latestDeviceUpdate, nowMs()),
    },
    storageMode: "firestore",
  };
}

async function mergeDeviceInFirestore(scope, projectInput, deviceKey, progressInput) {
  return mergeProjectSnapshotInFirestore(scope, projectInput, {
    [deviceKey]: progressInput,
  });
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

async function mergeProjectSnapshot(scope, projectInput, snapshotInput) {
  const backend = getConfiguredBackend();
  if (backend === "datastore") {
    return mergeProjectSnapshotInDatastore(scope, projectInput, snapshotInput);
  }
  if (backend === "firestore") {
    return mergeProjectSnapshotInFirestore(scope, projectInput, snapshotInput);
  }
  return mergeProjectSnapshotInFile(scope, projectInput, snapshotInput);
}

async function mergeDevice(scope, projectInput, deviceKey, progressInput) {
  const backend = getConfiguredBackend();
  if (backend === "datastore") {
    return mergeDeviceInDatastore(scope, projectInput, deviceKey, progressInput);
  }
  if (backend === "firestore") {
    return mergeDeviceInFirestore(scope, projectInput, deviceKey, progressInput);
  }
  return mergeDeviceInFile(scope, projectInput, deviceKey, progressInput);
}

export function createOperationalProgressMiddleware() {
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

      if (segments.length < 3) {
        json(response, 404, { ok: false, error: "Not found." });
        return;
      }

      const scope = segments[2];

      if (request.method === "GET" && segments.length === 3) {
        const project = await getProject(scope);
        json(response, 200, { ok: true, ...project });
        return;
      }

      if (request.method === "PUT" && segments.length === 3) {
        const body = await readRequestBody(request);
        const merged = await mergeProjectSnapshot(
          scope,
          body?.project,
          body?.deviceProgressByKey && typeof body.deviceProgressByKey === "object"
            ? body.deviceProgressByKey
            : {}
        );
        json(response, 200, { ok: true, ...merged });
        return;
      }

      if (
        request.method === "PUT" &&
        segments.length === 5 &&
        segments[3] === "devices"
      ) {
        const deviceKey = segments[4];
        const body = await readRequestBody(request);
        const merged = await mergeDevice(scope, body?.project, deviceKey, body?.progress);
        json(response, 200, {
          ok: true,
          project: merged.project,
          storageMode: merged.storageMode,
        });
        return;
      }

      json(response, 404, { ok: false, error: "Not found." });
    } catch (error) {
      console.error("[operational-progress-api]", error);
      json(response, 500, {
        error: error instanceof Error ? error.message : "Unexpected operational progress error.",
        ok: false,
      });
    }
  };
}
