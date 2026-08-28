# ReadAid

ReadAid is a focused hackathon MVP for readers who benefit from plain-language explanations, visible evidence, and a synchronized knowledge graph. It supports one text-based PDF at a time and keeps a deterministic prepared example available for the demo question:

> How does Marilyn’s ambition affect Lydia?

The prepared answer highlights Marilyn, Lydia, Family Expectations, the relevant graph edges, and supporting passage IDs at the same time.

## Architecture

The Next.js Node server coordinates every data service. Browser code never connects to databases.

```text
PDF / question
      │
      ▼
Next.js Node routes ── PostgreSQL (documents, status, sessions, preferences)
      │
      ├─────────────── ClickHouse Cloud (passages, graph records, events)
      │
      └─────────────── PuppyGraph (bounded, static, read-only Cypher)
      │
      ▼
CopilotKit + AG-UI shared state ── React Flow + passage highlights
```

All records share deterministic document, passage, node, and edge IDs. PostgreSQL and ClickHouse do not communicate directly. Upload retries are safe because IDs derive from file content and canonical record data.

## Setup

Requirements: Node.js 22.3+ or the compatible Node 20 range, npm, Docker, and the existing service credentials.

1. Copy `.env.example` to `.env` and provide the existing values. Never prefix database credentials with `NEXT_PUBLIC_`.
2. Start the existing services with `docker compose up -d`. Do not remove their volumes.
3. Install and run:

   ```bash
   npm install
   npm run infra:check
   npm run dev
   ```

If `npm run graph:check` reports that PuppyGraph has no active labels, review and run `npm run graph:configure`. The command inspects metadata first and refuses to replace any non-empty graph. It builds the catalog payload in memory, so ClickHouse credentials are never written to a schema file or printed.

The host-run Next.js process uses `DATABASE_URL` and `PUPPYGRAPH_BOLT_URI`; addresses are never hardcoded. `CLICKHOUSE_DATABASE` is optional and defaults to `default`.

## PDF behavior

- Accepts exactly one `.pdf` with MIME type `application/pdf`, a valid `%PDF-` signature, and size at most 15 MB.
- Parses on the server in the Node runtime with `pdf-parse` and destroys the parser in `finally`.
- Scans opening pages in 20-page batches, up to an 80-page safety cap, stopping once the third chapter is detected. It skips likely title, copyright, preface, contents, and character-list pages and stores at most 40 pages from the first two chapters.
- Recognizes the prepared novel PDF by SHA-256, or by its matching title, author, and 215-page layout when only PDF metadata changed. That verified path extracts a small set of vetted, real page-numbered evidence windows in addition to the default chapter window, then validates the required Marilyn, Lydia, and Family Expectations graph before marking the document ready.
- Re-uploading a document replaces that document's ClickHouse passages and graph rows before inserting the validated result, preventing stale character or relationship records from leaking into a new answer.
- Preserves page numbers and creates short deterministic passages.
- Does not implement OCR, image extraction, URL ingestion, layout reconstruction, or permanent raw-PDF storage.
- Returns a helpful scanned-PDF message if little or no text is readable.
- Never returns the complete extracted document, local paths, stack traces, or credentials to the browser.

Status moves through `uploaded → extracting → analyzing → ready`; any safe failure moves to `failed` with a short code and message.

## Demo

1. Open the app and choose **Load prepared example**.
2. Select **Try the demo question** or submit “How does Marilyn’s ambition affect Lydia?”
3. Verify Marilyn, Lydia, Family Expectations, their edges, and the evidence passages highlight together.
4. Use **Make simpler**, **Show evidence**, **Read aloud**, **Focus graph**, and **Read graph as text**.
5. Upload a small text-based PDF to show the live ingestion path.
6. The CopilotKit panel can call `answerReadingQuestion`; AG-UI state synchronizes its result with the reader and graph.

## Verification

```bash
npm run typecheck
npm run lint
npm run test
npm run build
# with `npm run dev` running:
npm run smoke:http
```

`infra:check` performs PostgreSQL and ClickHouse `SELECT 1` checks plus one bounded PuppyGraph read. It reports names/status only, never values.

## Fallbacks and limitations

- If live document services fail, the clearly labeled prepared example stays usable in the browser and the core demo remains deterministic.
- PuppyGraph is attempted first for document graph traversal. The same normalized `GraphResult` can be read from ClickHouse when graph exposure is briefly unavailable.
- Generic uploaded-document extraction is deliberately lightweight and evidence-bound; it recognizes frequent proper names and supported keyword themes without claiming literary certainty. The hash-verified demo PDF uses a deterministic evidence profile, while the prepared fallback is explicitly labeled as paraphrase.
- Read Aloud uses the browser Speech Synthesis API and fails with a plain-language message when unavailable.
- External web context is intentionally omitted so outside material cannot overwrite passage evidence.
- There is no authentication, multiple-book library, OCR, teacher dashboard, medical assessment, unrestricted Cypher, CDC, or Kafka.
