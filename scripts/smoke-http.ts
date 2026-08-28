import { makeTextPdf } from "../test/pdf-fixture";

const base = process.env.READAID_BASE_URL || "http://localhost:3000";
const pdfText = (text: string) => new TextDecoder("latin1").decode(makeTextPdf(text));

async function json(path: string, init?: RequestInit) {
  const response = await fetch(`${base}${path}`, init);
  const body = await response.json();
  return { response, body };
}

async function main() {
  const page = await fetch(base);
  const html = await page.text();
  if (!page.ok || !["Understand the story", "Make simpler", "Show evidence", "Read aloud", "Read graph as text"].every((text) => html.includes(text))) throw new Error("Rendered page is missing a required reader control.");
  console.log("Rendered page: required reader and accessibility controls are present.");

  const copilotInfo = await fetch(`${base}/api/copilotkit/info`);
  if (!copilotInfo.ok) throw new Error(`CopilotKit runtime info failed with status ${copilotInfo.status}.`);
  console.log("CopilotKit runtime: AG-UI agent endpoint is available.");

  const prepared = await json("/api/documents/prepared", { method: "POST" });
  if (!prepared.response.ok || prepared.body.document?.status !== "ready") throw new Error("Prepared document did not load.");
  console.log("Prepared example: ready.");

  const answer = await json("/api/query", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ documentId: prepared.body.document.documentId, question: "How does Marilyn’s ambition affect Lydia?", level: "simple" }) });
  const labels = answer.body.answer?.graph?.nodes?.map((node: { label: string }) => node.label) || [];
  if (!answer.response.ok || !["Marilyn", "Lydia", "Family Expectations"].every((label) => labels.includes(label)) || answer.body.answer.graph.edges.length < 2 || answer.body.answer.passages.length < 1) throw new Error("Prepared answer did not synchronize required evidence.");
  console.log("Prepared question: required nodes, edges, and passages returned.");

  const invalidForm = new FormData();
  invalidForm.append("file", new File(["hello"], "notes.txt", { type: "text/plain" }));
  const invalid = await json("/api/upload", { method: "POST", body: invalidForm });
  if (invalid.response.status !== 415) throw new Error("Invalid file type was not rejected.");
  console.log("Invalid file: rejected before parsing.");

  const oversizedForm = new FormData();
  oversizedForm.append("file", new File([new Uint8Array(15 * 1024 * 1024 + 1)], "large.pdf", { type: "application/pdf" }));
  const oversized = await json("/api/upload", { method: "POST", body: oversizedForm });
  if (oversized.response.status !== 413) throw new Error("Oversized PDF was not rejected.");
  console.log("Oversized PDF: rejected before parsing.");

  const blankForm = new FormData();
  blankForm.append("file", new File([pdfText("")], "blank.pdf", { type: "application/pdf" }));
  const blank = await json("/api/upload", { method: "POST", body: blankForm });
  if (blank.response.status !== 422 || blank.body.code !== "NO_READABLE_TEXT") throw new Error("Blank PDF did not produce the no-readable-text error.");
  console.log("No-readable-text PDF: accessible scanned-PDF guidance returned.");

  const validForm = new FormData();
  validForm.append("file", new File([pdfText("Marilyn and Lydia talk about family expectations. Marilyn wants Lydia to plan a successful future in science, and Lydia feels pressure from her mother.")], "readaid-smoke.pdf", { type: "application/pdf" }));
  const upload = await json("/api/upload", { method: "POST", body: validForm });
  if (!upload.response.ok || upload.body.document?.status !== "ready" || upload.body.document?.passages?.[0]?.page !== 1 || !upload.body.document?.graph?.nodes?.length) throw new Error(`Valid PDF upload failed with status ${upload.response.status} (${upload.body.code || "unknown"}: ${upload.body.error || "no message"}).`);
  console.log("Valid PDF: ready in PostgreSQL with page-numbered ClickHouse passages and graph records.");

  const status = await json(`/api/documents/${encodeURIComponent(upload.body.document.documentId)}/status`);
  if (!status.response.ok || status.body.status !== "ready") throw new Error("Uploaded document status did not reach ready.");
  console.log("Uploaded document status endpoint: ready.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "HTTP smoke test failed.");
  process.exitCode = 1;
});
