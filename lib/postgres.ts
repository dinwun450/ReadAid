import "server-only";
import { Pool } from "pg";

type DocumentStatus = "uploaded" | "extracting" | "analyzing" | "ready" | "failed";

let pool: Pool | undefined;
let initialized: Promise<void> | undefined;

function getPool(): Pool {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured.");
  pool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
  return pool;
}

export async function ensurePostgresSchema(): Promise<void> {
  initialized ??= getPool().query(`
    CREATE TABLE IF NOT EXISTS documents (
      document_id TEXT PRIMARY KEY,
      original_filename TEXT NOT NULL,
      display_title TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_size BIGINT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('uploaded','extracting','analyzing','ready','failed')),
      page_count INTEGER NOT NULL DEFAULT 0,
      processed_page_count INTEGER NOT NULL DEFAULT 0,
      error_code TEXT,
      error_message TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS reading_sessions (
      session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      document_id TEXT NOT NULL REFERENCES documents(document_id),
      current_chapter INTEGER NOT NULL DEFAULT 1,
      reading_position TEXT,
      accessibility_preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `).then(() => undefined);
  return initialized;
}

export async function upsertDocument(input: {
  documentId: string; originalFilename: string; displayTitle: string; mimeType: string; fileSize: number;
}): Promise<void> {
  await ensurePostgresSchema();
  await getPool().query(
    `INSERT INTO documents (document_id, original_filename, display_title, mime_type, file_size, status)
     VALUES ($1,$2,$3,$4,$5,'uploaded')
     ON CONFLICT (document_id) DO UPDATE SET original_filename=EXCLUDED.original_filename,
       display_title=EXCLUDED.display_title, mime_type=EXCLUDED.mime_type, file_size=EXCLUDED.file_size,
       status='uploaded', error_code=NULL, error_message=NULL, updated_at=NOW()`,
    [input.documentId, input.originalFilename, input.displayTitle, input.mimeType, input.fileSize],
  );
}

export async function setDocumentStatus(
  documentId: string,
  status: DocumentStatus,
  details: { pageCount?: number; processedPageCount?: number; errorCode?: string; errorMessage?: string } = {},
): Promise<void> {
  await ensurePostgresSchema();
  await getPool().query(
    `UPDATE documents SET status=$2, page_count=COALESCE($3,page_count),
      processed_page_count=COALESCE($4,processed_page_count), error_code=$5, error_message=$6, updated_at=NOW()
      WHERE document_id=$1`,
    [documentId, status, details.pageCount ?? null, details.processedPageCount ?? null, details.errorCode ?? null, details.errorMessage ?? null],
  );
}

export async function getDocument(documentId: string) {
  await ensurePostgresSchema();
  const result = await getPool().query(
    `SELECT document_id, display_title, status, page_count, processed_page_count, error_code, error_message, created_at, updated_at
     FROM documents WHERE document_id=$1 LIMIT 1`,
    [documentId],
  );
  return result.rows[0] as Record<string, unknown> | undefined;
}

export async function checkPostgres(): Promise<void> {
  await getPool().query("SELECT 1");
}

export async function closePostgres(): Promise<void> {
  if (pool) await pool.end();
  pool = undefined;
  initialized = undefined;
}
