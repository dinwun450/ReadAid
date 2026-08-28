// @vitest-environment node
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { extractGraph, extractPdf, ReadablePdfError, selectContentPages } from "@/lib/extraction";
import { documentIdFor, stableId } from "@/lib/ids";
import { preparedAnswer, preparedDocument } from "@/lib/prepared";
import { buildMarilynLydiaAnswer } from "@/lib/demo-answer";
import { assertEvidenceBoundGraph, buildVerifiedGraph, getVerifiedProfile, getVerifiedProfileFromMetadata, VERIFIED_DEMO_DOCUMENT_ID } from "@/lib/verified-profile";
import { makeTextPdf } from "./pdf-fixture";

describe("deterministic identifiers", () => {
  it("returns stable, namespaced IDs", () => {
    expect(stableId("passage", "doc", 1, "hello")).toBe(stableId("passage", "doc", 1, "hello"));
    expect(documentIdFor(new TextEncoder().encode("same"))).toMatch(/^doc_[a-f0-9]{24}$/);
  });
});

describe("prepared demonstration", () => {
  it("highlights every required entity, edge, and passage", () => {
    const answer = preparedAnswer("simple");
    expect(answer.graph.nodes.map((node) => node.label)).toEqual(expect.arrayContaining(["Marilyn", "Lydia", "Family Expectations"]));
    expect(answer.graph.edges.length).toBeGreaterThanOrEqual(2);
    expect(answer.graph.passageIds.length).toBeGreaterThan(0);
    expect(answer.passages.every((passage) => answer.graph.passageIds.includes(passage.id))).toBe(true);
    expect(answer.explanation).toContain("The passages show");
    expect(answer.explanation).toContain("The graph supports this");
    expect(answer.explanation).not.toContain("support these connections:");
    const detailed = preparedAnswer("detailed");
    expect(detailed.explanation).toContain("The passages show");
    expect(detailed.explanation).toContain("The graph supports this reading");
    expect(preparedDocument.prepared).toBe(true);
  });
});

describe("PDF extraction", () => {
  it("extracts page-numbered text from a valid PDF", async () => {
    const bytes = makeTextPdf("Marilyn wants Lydia to succeed in science and plan her future carefully.");
    const result = await extractPdf(bytes, documentIdFor(bytes));
    expect(result.pageCount).toBe(1);
    expect(result.passages[0]).toMatchObject({ page: 1, chapter: 1 });
    expect(result.passages[0].text).toContain("Marilyn");
  });

  it("returns a scanned-PDF style message when no text is readable", async () => {
    const bytes = makeTextPdf("");
    await expect(extractPdf(bytes, documentIdFor(bytes))).rejects.toMatchObject({ code: "NO_READABLE_TEXT" } satisfies Partial<ReadablePdfError>);
  });

  it("skips front matter and selects no more than the first two chapters", () => {
    const pages = [
      { page: 1, text: "THE STORY\nA Novel by Example Author" },
      { page: 2, text: "Copyright 2026. All rights reserved. ISBN 123456789." },
      { page: 3, text: "Preface\nThis preface explains how the book came to be. It gives background before the story begins." },
      { page: 4, text: "Contents\nChapter One ........ 6\nChapter Two ........ 9\nChapter Three ........ 14" },
      { page: 5, text: "Characters\nMarilyn — Lydia's mother\nLydia — Marilyn's daughter\nJames — Lydia's father\nNath — Lydia's brother" },
      { page: 6, text: "Chapter One\nMarilyn opened the letter. Lydia watched her mother carefully. The morning suddenly felt different." },
      { page: 7, text: "The conversation continued. Marilyn described the future she imagined. Lydia stayed quiet and listened." },
      { page: 9, text: "Chapter Two\nLydia thought about the plans. She wondered whether they belonged to her or to Marilyn." },
      { page: 14, text: "Chapter Three\nJames arrived home and found the house quiet." },
    ];
    const selected = selectContentPages(pages);
    expect(selected.map((page) => page.page)).toEqual([6, 7, 9]);
    expect(selected.map((page) => page.chapter)).toEqual([1, 1, 2]);
  });
});

describe("structured graph extraction", () => {
  it("uses only supplied passage text and preserves evidence IDs", () => {
    const graph = extractGraph("doc_test", [{ id: "passage_1", chapter: 1, page: 4, text: "Marilyn and Lydia talked about family expectations and the future." }]);
    expect(graph.nodes.some((node) => node.label === "Marilyn")).toBe(true);
    expect(graph.edges.every((edge) => edge.passageId === "passage_1")).toBe(true);
  });

  it("never promotes pronouns to character nodes", () => {
    const graph = extractGraph("doc_pronouns", [{
      id: "passage_1",
      chapter: 1,
      page: 1,
      text: "Marilyn spoke to Lydia. She described the future. Lydia listened because she wanted her mother to be happy.",
    }]);
    expect(graph.nodes.map((node) => node.label)).toEqual(expect.arrayContaining(["Marilyn", "Lydia"]));
    expect(graph.nodes.some((node) => ["She", "He", "They"].includes(node.label))).toBe(false);
  });
});

const verifiedDemoPdf = new URL("../Everything I Never Told You_ A - Celeste Ng.pdf", import.meta.url);

describe.skipIf(!existsSync(verifiedDemoPdf))("verified uploaded demo PDF", () => {
  it("uses real page-numbered evidence and mirrors the prepared graph contract", async () => {
    const bytes = new Uint8Array(readFileSync(verifiedDemoPdf));
    const profile = getVerifiedProfile(bytes);
    expect(profile).toBeDefined();
    expect(getVerifiedProfileFromMetadata({ Title: "Everything I Never Told You: A Novel", Author: "Celeste Ng" }, 215)).toEqual(profile);
    expect(documentIdFor(bytes)).toBe(VERIFIED_DEMO_DOCUMENT_ID);

    const result = await extractPdf(bytes, VERIFIED_DEMO_DOCUMENT_ID, {
      evidencePages: profile?.evidencePages,
      chapterStarts: profile?.chapterStarts,
    });
    const pages = new Set(result.passages.map((passage) => passage.page));
    expect(result.pageCount).toBe(215);
    expect(result.firstContentPage).toBe(7);
    expect(pages.has(6)).toBe(false);
    expect([7, 24, 101, 108, 117, 118, 127].every((page) => pages.has(page))).toBe(true);

    const repeatBytes = new Uint8Array(readFileSync(verifiedDemoPdf));
    const repeat = await extractPdf(repeatBytes, VERIFIED_DEMO_DOCUMENT_ID, {
      evidencePages: profile?.evidencePages,
      chapterStarts: profile?.chapterStarts,
    });
    expect(repeat.passages.map((passage) => passage.id)).toEqual(result.passages.map((passage) => passage.id));

    const graph = buildVerifiedGraph(VERIFIED_DEMO_DOCUMENT_ID, result.passages);
    expect(() => assertEvidenceBoundGraph(graph, result.passages, profile?.requiredNodeLabels)).not.toThrow();
    expect(graph.nodes.map((node) => node.label)).toEqual(expect.arrayContaining(["Marilyn", "Lydia", "Family Expectations"]));
    expect(graph.edges.every((edge) => result.passages.some((passage) => passage.id === edge.passageId))).toBe(true);

    const answer = buildMarilynLydiaAnswer(graph, result.passages, "simple");
    expect(answer.graph.nodes.map((node) => node.label)).toEqual(expect.arrayContaining(["Marilyn", "Lydia", "Family Expectations"]));
    expect(answer.graph.edges).toHaveLength(3);
    expect(answer.passages.length).toBeGreaterThanOrEqual(2);
    expect(answer.passages.every((passage) => [101, 108, 117, 118].includes(passage.page))).toBe(true);
  }, 20_000);

  it("ignores stale pronoun nodes and duplicate relationship rows in the demo answer", () => {
    const marilyn = preparedDocument.graph.nodes.find((node) => node.label === "Marilyn");
    const lydia = preparedDocument.graph.nodes.find((node) => node.label === "Lydia");
    expect(marilyn && lydia).toBeTruthy();
    const contaminated = {
      ...preparedDocument.graph,
      nodes: [...preparedDocument.graph.nodes, { id: "stale_she", label: "She", type: "character" as const }],
      edges: [
        ...preparedDocument.graph.edges,
        { id: "stale_marilyn_she", source: marilyn!.id, target: "stale_she", label: "appears with", passageId: preparedDocument.passages[0].id, confidence: 1, inferred: false },
        { id: "stale_lydia_she", source: lydia!.id, target: "stale_she", label: "appears with", passageId: preparedDocument.passages[0].id, confidence: 1, inferred: false },
        { id: "stale_marilyn_lydia", source: marilyn!.id, target: lydia!.id, label: "appears with", passageId: preparedDocument.passages[0].id, confidence: 1, inferred: false },
      ],
    };
    const answer = buildMarilynLydiaAnswer(contaminated, preparedDocument.passages, "simple");
    expect(answer.graph.nodes.map((node) => node.label)).toEqual(["Marilyn", "Lydia", "Family Expectations"]);
    expect(answer.graph.edges).toHaveLength(3);
    expect(answer.graph.edges.some((edge) => edge.label === "appears with")).toBe(false);
    expect(answer.explanation).not.toContain("She");
  });
});
