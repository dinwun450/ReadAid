"use client";

import { CopilotChat, useAgent, useAgentContext, useFrontendTool } from "@copilotkit/react-core/v2";
import { z } from "zod";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AnswerResult, ReaderDocument, ReadingState } from "@/lib/contracts";
import { preparedDocument } from "@/lib/prepared";
import { KnowledgeGraph } from "@/components/knowledge-graph";
import { UploadPanel } from "@/components/upload-panel";

const preparedQuestion = "How does Marilyn's ambition affect Lydia?";

function initialReadingState(): ReadingState {
  return {
    documentId: preparedDocument.documentId,
    chapter: 1,
    activeNodeIds: [],
    activeEdgeIds: [],
    activePassageIds: [],
    explanation: "Ask a question to connect the passage, graph, and explanation.",
    explanationLevel: "simple",
    graphMode: "characters",
    sourceMode: "passage",
    narrationStatus: "idle",
  };
}

export function ReaderApp() {
  const [document, setDocument] = useState<ReaderDocument>(preparedDocument);
  const [reading, setReading] = useState<ReadingState>(initialReadingState);
  const [question, setQuestion] = useState(preparedQuestion);
  const [busy, setBusy] = useState(false);
  const [focus, setFocus] = useState(false);
  const [showEvidence, setShowEvidence] = useState(false);
  const [utilityTab, setUtilityTab] = useState<"chat" | "upload">("chat");
  const [fontSize, setFontSize] = useState(18);
  const [lineSpacing, setLineSpacing] = useState(1.7);
  const [evidenceKind, setEvidenceKind] = useState<AnswerResult["evidenceLabel"]>("Passage Evidence");
  const evidenceRef = useRef<HTMLElement>(null);
  const { agent, isReady } = useAgent({ agentId: "readaid" });

  useAgentContext({ description: "The synchronized ReadAid reading state", value: reading });
  useAgentContext({
    description: "Visible document graph and passage identifiers",
    value: {
      documentId: document.documentId,
      title: document.title,
      graph: document.graph,
      visiblePassageIds: document.passages.map((passage) => passage.id),
    },
  });

  useEffect(() => {
    if (isReady) agent.setState(reading);
  }, [agent, isReady, reading]);

  const applyAnswer = useCallback((answer: AnswerResult) => {
    setDocument((current) => {
      const passages = new Map(current.passages.map((passage) => [passage.id, passage]));
      const nodes = new Map(current.graph.nodes.map((node) => [node.id, node]));
      const edges = new Map(current.graph.edges.map((edge) => [edge.id, edge]));
      for (const passage of answer.passages) passages.set(passage.id, passage);
      for (const node of answer.graph.nodes) nodes.set(node.id, node);
      for (const edge of answer.graph.edges) edges.set(edge.id, edge);
      return {
        ...current,
        passages: [...passages.values()].sort((a, b) => a.page - b.page || a.id.localeCompare(b.id)),
        graph: {
          nodes: [...nodes.values()],
          edges: [...edges.values()],
          passageIds: [...new Set([...current.graph.passageIds, ...answer.graph.passageIds])],
        },
      };
    });
    const answerNodeIds = new Set(answer.graph.nodes.map((node) => node.id));
    const answerEdgeIds = new Set(answer.graph.edges.map((edge) => edge.id));
    setReading((current) => ({
      ...current,
      activeNodeIds: answer.graph.nodes.length ? [...answerNodeIds] : current.activeNodeIds,
      activeEdgeIds: answer.graph.edges.length ? [...answerEdgeIds] : current.activeEdgeIds,
      activePassageIds: answer.graph.passageIds.length ? answer.graph.passageIds : current.activePassageIds,
      explanation: answer.explanation,
      sourceMode: "passage",
    }));
    setFocus(false);
    setEvidenceKind(answer.evidenceLabel);
    setShowEvidence(true);
  }, []);

  const ask = useCallback(async (prompt: string, level = reading.explanationLevel, signal?: AbortSignal) => {
    setBusy(true);
    try {
      const response = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId: document.documentId, question: prompt, level }),
        signal,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "The question could not be answered.");
      applyAnswer(data.answer);
      return data.answer as AnswerResult;
    } finally {
      setBusy(false);
    }
  }, [applyAnswer, document.documentId, reading.explanationLevel]);

  useFrontendTool({
    name: "answerReadingQuestion",
    description: "Answer a question about the active ReadAid document using bounded graph and passage evidence, then synchronize highlights.",
    parameters: z.object({
      question: z.string().min(3).max(500),
      level: z.enum(["quick", "simple", "detailed"]).default("simple"),
    }),
    handler: async ({ question: toolQuestion, level }, { signal }) => ask(toolQuestion, level, signal),
    followUp: true,
  }, [ask]);

  async function loadPrepared() {
    setBusy(true);
    try {
      const response = await fetch("/api/documents/prepared", { method: "POST" });
      const data = await response.json();
      setDocument(data.document || preparedDocument);
      setReading(initialReadingState());
      setQuestion(preparedQuestion);
    } finally {
      setBusy(false);
    }
  }

  function loadDocument(next: ReaderDocument) {
    window.speechSynthesis?.cancel();
    setDocument(next);
    setReading({ ...initialReadingState(), documentId: next.documentId });
    setQuestion("");
    setUtilityTab("chat");
  }

  async function makeSimpler() {
    const nextLevel = reading.explanationLevel === "detailed" ? "simple" : "quick";
    setReading((current) => ({ ...current, explanationLevel: nextLevel }));
    if (question.trim()) await ask(question, nextLevel);
  }

  function toggleReadAloud() {
    if (!("speechSynthesis" in window)) {
      setReading((current) => ({ ...current, narrationStatus: "idle", explanation: `${current.explanation} Read aloud is not supported in this browser.` }));
      return;
    }
    if (reading.narrationStatus === "playing") {
      window.speechSynthesis.pause();
      setReading((current) => ({ ...current, narrationStatus: "paused" }));
      return;
    }
    if (reading.narrationStatus === "paused") {
      window.speechSynthesis.resume();
      setReading((current) => ({ ...current, narrationStatus: "playing" }));
      return;
    }
    const utterance = new SpeechSynthesisUtterance(reading.explanation);
    utterance.rate = 0.9;
    utterance.onend = () => setReading((current) => ({ ...current, narrationStatus: "idle" }));
    utterance.onerror = () => setReading((current) => ({ ...current, narrationStatus: "idle" }));
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
    setReading((current) => ({ ...current, narrationStatus: "playing" }));
  }

  const highlightedPassages = useMemo(() => new Set(reading.activePassageIds), [reading.activePassageIds]);
  const activeGraph = useMemo(() => ({
    nodes: document.graph.nodes,
    edges: document.graph.edges,
    passageIds: document.graph.passageIds,
  }), [document.graph]);

  const entityDetails = useMemo(() => {
    const activeNodes = document.graph.nodes.filter((node) => reading.activeNodeIds.includes(node.id));
    const selected = (activeNodes.length ? activeNodes : document.graph.nodes).slice(0, 3);
    return selected.map((node) => {
      const connections = document.graph.edges
        .filter((edge) => edge.source === node.id || edge.target === node.id)
        .slice(0, 3)
        .map((edge) => {
          const otherId = edge.source === node.id ? edge.target : edge.source;
          const other = document.graph.nodes.find((item) => item.id === otherId)?.label || "another idea";
          return `${edge.label} ${other}`;
        });
      return { ...node, connections };
    });
  }, [document.graph, reading.activeNodeIds]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#reader" aria-label="ReadAid home">
          <span className="brand-mark">R</span>
          <span>ReadAid<small>Stories, made clearer.</small></span>
        </a>
        <div className="document-meta" role="status">
          <span className={`status-dot ${document.status}`} />
          <span><strong>{document.title}</strong><small>{document.prepared ? "Prepared demonstration" : `Uploaded PDF - ${document.pageCount} pages`}</small></span>
        </div>
        <nav aria-label="Document actions">
          <button className="ghost-button" type="button" onClick={() => void loadPrepared()} disabled={busy}>Load prepared example</button>
          <label className="text-control">Text
            <button type="button" aria-label="Decrease text size" onClick={() => setFontSize((size) => Math.max(15, size - 1))}>A-</button>
            <button type="button" aria-label="Increase text size" onClick={() => setFontSize((size) => Math.min(24, size + 1))}>A+</button>
          </label>
        </nav>
      </header>

      <section className="reader-deck" aria-busy={busy}>
        <article id="reader" className="story-reader" style={{ "--reader-font-size": `${fontSize}px`, "--reader-line-height": lineSpacing } as React.CSSProperties}>
          <div className="deck-heading">
            <div><span className="eyebrow">Passage and evidence</span><h1>Read the story</h1></div>
            <label>Line spacing
              <select value={lineSpacing} onChange={(event) => setLineSpacing(Number(event.target.value))}>
                <option value={1.5}>Comfortable</option>
                <option value={1.7}>Relaxed</option>
                <option value={2}>Extra</option>
              </select>
            </label>
          </div>
          {document.notice && <p className="document-notice">{document.notice}</p>}
          <div className="passages story-scroll">
            {document.passages.map((passage) => (
              <section key={passage.id} className={`passage ${highlightedPassages.has(passage.id) ? "highlighted" : ""}`} aria-label={`Page ${passage.page}${highlightedPassages.has(passage.id) ? ", supporting evidence" : ""}`}>
                <span className="page-label">PAGE {passage.page}</span>
                <p>{passage.text}</p>
                {highlightedPassages.has(passage.id) && <span className="evidence-tag">Supporting passage - {passage.id}</span>}
              </section>
            ))}
          </div>
          {showEvidence && reading.activePassageIds.length > 0 && (
            <aside ref={evidenceRef} className="evidence-note">
              <span>{evidenceKind}</span>
              <p>{evidenceKind === "Inferred Interpretation" ? "Some graph links interpret the passage. Dashed edges mark those links." : "Highlighted sentences directly support the answer."}</p>
            </aside>
          )}
          <form className="question-dock" onSubmit={(event) => { event.preventDefault(); if (question.trim()) void ask(question); }}>
            <label className="visually-hidden" htmlFor="question">Ask about this passage</label>
            <textarea id="question" value={question} onChange={(event) => setQuestion(event.target.value)} rows={2} placeholder="Ask how a character, theme, or event connects..." />
            <button className="ask-button" disabled={busy || question.trim().length < 3}>Ask ReadAid <span aria-hidden="true">-&gt;</span></button>
            {document.prepared && <button className="suggestion" type="button" onClick={() => { setQuestion(preparedQuestion); void ask(preparedQuestion); }}>Try the demo question</button>}
          </form>
        </article>

        <aside className="utility-panel" aria-label="Chat and upload tools">
          <div className="utility-tabs" role="tablist" aria-label="Reader tools">
            <button type="button" role="tab" aria-selected={utilityTab === "chat"} className={utilityTab === "chat" ? "selected" : ""} onClick={() => setUtilityTab("chat")}>Chat</button>
            <button type="button" role="tab" aria-selected={utilityTab === "upload"} className={utilityTab === "upload" ? "selected" : ""} onClick={() => setUtilityTab("upload")}>Upload</button>
          </div>
          <div className={`utility-body ${utilityTab}-pane`} role="tabpanel">
            {utilityTab === "chat" ? <CopilotChat agentId="readaid" /> : <UploadPanel onLoaded={loadDocument} onBusy={setBusy} />}
          </div>
        </aside>
      </section>

      <section className="knowledge-workspace" aria-label="ReadAid knowledge workspace">
        <div className="graph-workspace-heading">
          <div><span className="eyebrow">Synchronized knowledge map</span><h2>See how the story connects</h2></div>
          <div className="graph-toolbar">
            <span className="live-badge">Live with passage</span>
            <div className="graph-tabs" role="group" aria-label="Graph view">
              <button className={reading.graphMode === "characters" ? "selected" : ""} onClick={() => setReading((state) => ({ ...state, graphMode: "characters" }))}>Characters</button>
              <button className={reading.graphMode === "themes" ? "selected" : ""} onClick={() => setReading((state) => ({ ...state, graphMode: "themes" }))}>Themes</button>
            </div>
          </div>
        </div>

        <div className="graph-layout">
          <div className="graph-column">
            <KnowledgeGraph graph={activeGraph} activeNodeIds={reading.activeNodeIds} activeEdgeIds={reading.activeEdgeIds} focus={focus} />
            <div className="graph-actions">
              <button type="button" onClick={() => setFocus((value) => !value)}>{focus ? "Show all connections" : "Focus graph"}</button>
              <button type="button" onClick={() => { setFocus(false); setReading((state) => ({ ...state, activeNodeIds: [], activeEdgeIds: [], activePassageIds: [] })); }}>Reset graph</button>
            </div>
          </div>

          <aside className="insight-column">
            <section className="answer-card">
              <span className="eyebrow">Passage meaning</span>
              <div className="level-picker" role="group" aria-label="Explanation level">
                {(["quick", "simple", "detailed"] as const).map((level) => (
                  <button key={level} className={reading.explanationLevel === level ? "selected" : ""} onClick={() => setReading((state) => ({ ...state, explanationLevel: level }))}>{level}</button>
                ))}
              </div>
              <p className="explanation" aria-live="polite">{busy ? "Finding the clearest evidence..." : reading.explanation}</p>
              <div className="answer-controls">
                <button type="button" className="primary-button" onClick={() => void makeSimpler()} disabled={busy}>Make simpler</button>
                <button type="button" className="secondary-button" onClick={() => { setShowEvidence((value) => !value); window.document.getElementById("reader")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>{showEvidence ? "Hide evidence" : "Show evidence"}</button>
                <button type="button" className="secondary-button" onClick={toggleReadAloud}>{reading.narrationStatus === "playing" ? "Pause" : reading.narrationStatus === "paused" ? "Resume" : "Read aloud"}</button>
              </div>
            </section>

            <div className="entity-stack" aria-label="Highlighted graph details">
              {entityDetails.map((node) => (
                <article key={node.id} className={`entity-card ${node.type} ${reading.activeNodeIds.includes(node.id) ? "active" : ""}`}>
                  <span>{node.type}</span>
                  <h3>{node.label}</h3>
                  <p>{node.description || "A supported idea from the uploaded passage."}</p>
                  {node.connections.length > 0 && <small>{node.connections.join(" - ")}</small>}
                </article>
              ))}
            </div>
          </aside>
        </div>
      </section>

      <footer><span>ReadAid</span><p>Evidence first. Clear language. No judgment.</p><small>Text-based PDFs only - no OCR</small></footer>
    </main>
  );
}
