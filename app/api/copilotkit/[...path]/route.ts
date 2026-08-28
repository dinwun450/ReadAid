import { BuiltInAgent, CopilotRuntime, createCopilotRuntimeHandler } from "@copilotkit/runtime/v2";

export const runtime = "nodejs";

const copilotRuntime = new CopilotRuntime({
  agents: {
    readaid: new BuiltInAgent({
      model: "openai/gpt-4o-mini",
      maxSteps: 3,
      temperature: 0.1,
      prompt: "You are ReadAid, an accessible reading assistant. Use the answerReadingQuestion frontend tool for questions about the active passage. Base answers only on returned passage evidence. Use short sentences and clearly label inference. Never generate Cypher.",
    }),
  },
});

const handler = createCopilotRuntimeHandler({ runtime: copilotRuntime, basePath: "/api/copilotkit" });

export { handler as GET, handler as POST };

