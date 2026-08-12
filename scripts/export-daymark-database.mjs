import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const endpoint = process.env.DAYMARK_SYNC_EXPORT_URL;
if (!endpoint) throw new Error("DAYMARK_SYNC_EXPORT_URL is required.");

const response = await fetch(endpoint, { headers: { Accept: "application/json" } });
if (!response.ok) throw new Error(`Daymark export failed (${response.status}).`);

const payload = await response.json();
if (!payload?.state || !Number.isInteger(Number(payload.revision))) {
  throw new Error("Daymark export returned an invalid workspace.");
}

const outputDirectory = resolve("data");
const jsonPath = resolve(outputDirectory, "daymark-workspace.json");
const sqlitePath = resolve(outputDirectory, "daymark.sqlite");
await mkdir(dirname(jsonPath), { recursive: true });

const exportDocument = {
  format: "daymark-workspace-database",
  formatVersion: 1,
  exportedAt: new Date().toISOString(),
  source: "android-authoritative-sync-workspace",
  revision: Number(payload.revision),
  updatedAt: payload.updatedAt ?? payload.state.updatedAt,
  state: payload.state,
};
await writeFile(jsonPath, `${JSON.stringify(exportDocument, null, 2)}\n`, "utf8");

const database = new DatabaseSync(sqlitePath);
try {
  database.exec(`
    PRAGMA journal_mode = DELETE;
    PRAGMA synchronous = FULL;
    DROP TABLE IF EXISTS workspace_snapshot;
    DROP TABLE IF EXISTS workspace_records;
    CREATE TABLE workspace_snapshot (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      format_version INTEGER NOT NULL,
      source TEXT NOT NULL,
      revision INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      exported_at TEXT NOT NULL,
      state_json TEXT NOT NULL
    );
    CREATE TABLE workspace_records (
      collection TEXT NOT NULL,
      record_id TEXT NOT NULL,
      updated_at TEXT,
      record_json TEXT NOT NULL,
      PRIMARY KEY (collection, record_id)
    );
  `);
  database
    .prepare(`
      INSERT INTO workspace_snapshot
        (id, format_version, source, revision, updated_at, exported_at, state_json)
      VALUES
        (1, ?1, ?2, ?3, ?4, ?5, ?6)
    `)
    .run(
      exportDocument.formatVersion,
      exportDocument.source,
      exportDocument.revision,
      exportDocument.updatedAt,
      exportDocument.exportedAt,
      JSON.stringify(exportDocument.state),
    );

  const insertRecord = database.prepare(`
    INSERT INTO workspace_records (collection, record_id, updated_at, record_json)
    VALUES (?1, ?2, ?3, ?4)
  `);
  const collections = [
    "projects",
    "sections",
    "labels",
    "filters",
    "tasks",
    "orderItems",
    "notes",
    "diaryEntries",
    "syncTombstones",
  ];
  database.exec("BEGIN IMMEDIATE");
  try {
    for (const collection of collections) {
      for (const [recordId, record] of Object.entries(exportDocument.state[collection] ?? {})) {
        insertRecord.run(
          collection,
          recordId,
          record?.updatedAt ?? record?.deletedAt ?? null,
          JSON.stringify(record),
        );
      }
    }
    insertRecord.run("preferences", "preferences", exportDocument.state.updatedAt, JSON.stringify(exportDocument.state.preferences));
    insertRecord.run("undoStack", "undoStack", exportDocument.state.updatedAt, JSON.stringify(exportDocument.state.undoStack));
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  database.exec("VACUUM");
} finally {
  database.close();
}

console.log(JSON.stringify({
  revision: exportDocument.revision,
  updatedAt: exportDocument.updatedAt,
  jsonPath,
  sqlitePath,
}));
