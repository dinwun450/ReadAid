import { NextResponse } from "next/server";
import { z } from "zod";
import { logInteraction } from "@/lib/clickhouse";
import { answerQuestion } from "@/lib/query";

export const runtime = "nodejs";

const inputSchema = z.object({
  documentId: z.string().min(3).max(120),
  question: z.string().trim().min(3).max(500),
  level: z.enum(["quick", "simple", "detailed"]).default("simple"),
});

export async function POST(request: Request) {
  try {
    const parsed = inputSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Enter a short question about the passage." }, { status: 400 });
    const answer = await answerQuestion(parsed.data.documentId, parsed.data.question, parsed.data.level);
    void logInteraction(parsed.data.documentId, "question_answered", { level: parsed.data.level, evidenceCount: answer.passages.length });
    return NextResponse.json({ answer });
  } catch {
    return NextResponse.json({ error: "I could not answer that right now. The passage and prepared example are still available." }, { status: 503 });
  }
}

