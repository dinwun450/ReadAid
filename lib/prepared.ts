import type { AnswerResult, ReaderDocument } from "@/lib/contracts";
import { buildMarilynLydiaAnswer } from "@/lib/demo-answer";

export const PREPARED_DOCUMENT_ID = "doc_prepared_everything_i_never_told_you";

const IDs = {
  marilyn: `${PREPARED_DOCUMENT_ID}:character:marilyn`,
  lydia: `${PREPARED_DOCUMENT_ID}:character:lydia`,
  james: `${PREPARED_DOCUMENT_ID}:character:james`,
  expectations: `${PREPARED_DOCUMENT_ID}:theme:family_expectations`,
  ambition: `${PREPARED_DOCUMENT_ID}:theme:gender_and_ambition`,
  pressure: `${PREPARED_DOCUMENT_ID}:edge:marilyn_lydia_pressure`,
  projects: `${PREPARED_DOCUMENT_ID}:edge:marilyn_expectations`,
  carries: `${PREPARED_DOCUMENT_ID}:edge:lydia_expectations`,
};

export const preparedDocument: ReaderDocument = {
  documentId: PREPARED_DOCUMENT_ID,
  title: "Everything I Never Told You - prepared paraphrase",
  status: "ready",
  pageCount: 2,
  prepared: true,
  notice: "Prepared paraphrases are active as a fallback. Upload the verified novel PDF to use real, page-numbered evidence.",
  passages: [
    {
      id: `${PREPARED_DOCUMENT_ID}:chapter:1:page:1:passage:1`,
      chapter: 1,
      page: 1,
      text: "Marilyn wanted Lydia to have the chances she had once wanted for herself. She filled Lydia's days with science books and careful plans for the future. Lydia learned that her mother's happiness seemed tied to those plans, so she tried to become the daughter Marilyn imagined.",
    },
    {
      id: `${PREPARED_DOCUMENT_ID}:chapter:1:page:2:passage:1`,
      chapter: 1,
      page: 2,
      text: "James carried his own hopes for the children. Between their parents' wishes, Lydia felt responsible for keeping the family steady, even when the expectations did not match what she wanted.",
    },
  ],
  graph: {
    nodes: [
      { id: IDs.marilyn, label: "Marilyn", type: "character", description: "Lydia's mother, who wants Lydia to achieve the future she lost." },
      { id: IDs.lydia, label: "Lydia", type: "character", description: "A daughter trying to carry her parents' hopes." },
      { id: IDs.james, label: "James", type: "character", description: "Lydia's father, who has expectations of his own." },
      { id: IDs.expectations, label: "Family Expectations", type: "theme", description: "Pressure created by a family's hopes for a child." },
      { id: IDs.ambition, label: "Gender & Ambition", type: "theme", description: "How limited choices shape Marilyn's ambitions for Lydia." },
    ],
    edges: [
      { id: IDs.pressure, source: IDs.marilyn, target: IDs.lydia, label: "pressures", passageId: `${PREPARED_DOCUMENT_ID}:chapter:1:page:1:passage:1`, confidence: 0.98, inferred: false },
      { id: IDs.projects, source: IDs.marilyn, target: IDs.expectations, label: "projects hopes", passageId: `${PREPARED_DOCUMENT_ID}:chapter:1:page:1:passage:1`, confidence: 0.94, inferred: true },
      { id: IDs.carries, source: IDs.lydia, target: IDs.expectations, label: "carries", passageId: `${PREPARED_DOCUMENT_ID}:chapter:1:page:2:passage:1`, confidence: 0.96, inferred: false },
      { id: `${PREPARED_DOCUMENT_ID}:edge:marilyn_ambition`, source: IDs.marilyn, target: IDs.ambition, label: "seeks", passageId: `${PREPARED_DOCUMENT_ID}:chapter:1:page:1:passage:1`, confidence: 0.92, inferred: true },
    ],
    passageIds: [
      `${PREPARED_DOCUMENT_ID}:chapter:1:page:1:passage:1`,
      `${PREPARED_DOCUMENT_ID}:chapter:1:page:2:passage:1`,
    ],
  },
};

export function preparedAnswer(level: "quick" | "simple" | "detailed" = "simple"): AnswerResult {
  return buildMarilynLydiaAnswer(preparedDocument.graph, preparedDocument.passages, level);
}
