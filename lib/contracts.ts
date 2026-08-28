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

export type Passage = {
  id: string;
  chapter: number;
  page: number;
  text: string;
};

export type ReadingState = {
  documentId: string;
  chapter: number;
  activeNodeIds: string[];
  activeEdgeIds: string[];
  activePassageIds: string[];
  explanation: string;
  explanationLevel: "quick" | "simple" | "detailed";
  graphMode: "characters" | "themes" | "timeline";
  sourceMode: "passage" | "web";
  narrationStatus: "idle" | "playing" | "paused";
};

export type ReaderDocument = {
  documentId: string;
  title: string;
  status: "uploaded" | "extracting" | "analyzing" | "ready" | "failed";
  pageCount: number;
  prepared: boolean;
  passages: Passage[];
  graph: GraphResult;
  notice?: string;
};

export type AnswerResult = {
  explanation: string;
  detailedExplanation: string;
  evidenceLabel: "Passage Evidence" | "Inferred Interpretation";
  graph: GraphResult;
  passages: Passage[];
};

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
export const MAX_PROCESS_PAGES = 40;
export const MAX_SCAN_PAGES = 80;
