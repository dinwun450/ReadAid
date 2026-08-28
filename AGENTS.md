# ReadAid Hackathon Instructions

## Goal

Build a reliable ReadAid MVP that helps people with reading difficulties understand passages through simple explanations, evidence, and synchronized knowledge-graph highlighting.

The hard submission deadline is 5:00 PM PDT. Prioritize a complete demonstration over broad functionality.

## Required Demo

The prepared question is:

> How does Marilyn’s ambition affect Lydia?

The result must:

- Explain the answer in simple language.
- Highlight Marilyn, Lydia, and Family Expectations.
- Highlight the relevant graph edges.
- Highlight the supporting passage.
- Provide Make Simpler, Show Evidence, and Read Aloud controls.

## PDF Upload

PDF upload is part of the required MVP.

The application must allow the user to upload one text-based PDF and process
its readable text into passages, characters, themes, relationships, and
supporting evidence.

### Upload Flow

1. The user selects or drops a PDF.
2. The server validates the file.
3. The server extracts text page by page.
4. PostgreSQL stores document metadata and processing status.
5. ClickHouse Cloud stores passages and extracted graph records.
6. PuppyGraph exposes the resulting characters, themes, and relationships.
7. The application opens the processed document in the reader.
8. The user can query it through CopilotKit.

### Upload Restrictions

- Accept PDF files only.
- Support one uploaded PDF at a time.
- Limit files to 15 MB.
- Validate MIME type, extension, and PDF file signature.
- Reject empty, corrupted, encrypted, or password-protected files gracefully.
- Support text-based PDFs only.
- Do not implement OCR during the hackathon.
- Do not implement arbitrary URL ingestion.
- Do not store the raw PDF permanently unless the existing architecture
  already provides safe object storage.
- Delete temporary files or buffers after processing.
- Never send the complete PDF text to the browser.
- Never expose local file paths.
- Never log extracted book text or credentials.

### Server Processing

PDF parsing must run in a server-side Node.js environment, not in a client
component or Edge runtime.

The upload endpoint must:

- accept multipart form data;
- validate the file before parsing;
- create a PostgreSQL document record;
- update document status through uploaded, extracting, ready, or failed;
- extract text with page-number metadata;
- divide text into manageable passages;
- generate deterministic passage IDs;
- store passages in ClickHouse Cloud;
- return document metadata and processing status;
- return useful, accessible error messages.

Use the existing package manager and choose the smallest PDF parsing dependency
compatible with the repository and current Node.js runtime. Consult current
package documentation before adding a dependency.

### Extraction Scope

For the hackathon:

- Process no more than the first two detected chapters by default.
- If chapter detection is unreliable, process a bounded page range.
- Preserve page numbers for evidence.
- Use short overlapping chunks only when required.
- Do not attempt complex layout reconstruction.
- Do not process images, handwriting, tables, or scanned pages with OCR.
- If little or no text is extracted, explain that the PDF may be scanned.

### Document Status

Use these statuses:

```text
uploaded
extracting
analyzing
ready
failed
```

## Update the scope restrictions

Replace the previous PDF-related restrictions with:

## Scope Restrictions

Do not add during the hackathon:

- Authentication
- OCR or scanned-document recognition
- Arbitrary website ingestion
- Multiple simultaneous PDF uploads
- Permanent raw-PDF storage
- Advanced document-layout reconstruction
- Multiple-book library management
- Teacher dashboards
- CDC or Kafka
- Medical assessments
- Unrestricted natural-language-to-Cypher
- Elaborate graph physics
- Broad architectural refactors

A single text-based PDF upload is required.

Use the prepared deterministic document when a live PDF cannot be processed
during the demonstration.

### PDF Upload Completion Criteria

- A user can select or drag and drop one PDF.
- Invalid and oversized files are rejected before parsing.
- A text-based PDF is parsed server-side.
- Page numbers are preserved.
- PostgreSQL records the document and its status.
- ClickHouse Cloud receives extracted passages.
- Character and theme records are generated or seeded.
- The uploaded document opens in the reading interface.
- Its graph uses the same normalized GraphResult contract.
- The raw PDF is not exposed to the browser after upload.
- Temporary data is removed after processing.
- A scanned PDF produces a helpful no-readable-text message.
- The prepared example remains available as a fallback.

## Technology Stack

- Next.js
- TypeScript
- CopilotKit
- AG-UI
- React Flow
- PostgreSQL
- ClickHouse Cloud
- PuppyGraph
- You.com for optional external context

## Architecture

### PostgreSQL

Use PostgreSQL for:

- Documents
- Reading sessions
- Accessibility preferences
- Current chapter and reading position

### ClickHouse Cloud

Use ClickHouse Cloud for:

- Passages
- Characters
- Themes
- Character relationships
- Character-to-theme connections
- Interaction events

### PuppyGraph

Use PuppyGraph to:

- Expose ClickHouse tables as a graph
- Run bounded, read-only Cypher queries
- Retrieve character, theme, relationship, and evidence identifiers

Never allow unrestricted AI-generated Cypher.

### CopilotKit and AG-UI

Use CopilotKit for:

- Chat
- Tool invocation
- Accessible explanations
- Generative interface components

Use AG-UI shared state to synchronize:

- Active character nodes
- Active theme nodes
- Active edges
- Active passages
- Explanation level
- Read-aloud state

### React Flow

Use React Flow to render:

- Circular character nodes
- Circular theme nodes
- Short relationship labels
- Solid edges for explicit relationships
- Dashed edges for inferred relationships

Show no more than five nodes in Focus mode.

## Graph Contract

Normalize graph-query results to:

```ts
export type GraphNode = {
  id: string;
  label: string;
  type: "character" | "theme" | "event";
  description?: string;
};

export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  label: string;
  passageId?: string;
  confidence?: number;
  inferred?: boolean;
};

export type GraphResult = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  passageIds: string[];
};

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
