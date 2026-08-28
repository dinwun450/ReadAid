"use client";

import { CopilotKit } from "@copilotkit/react-core/v2";

export function ReadAidProvider({ children }: { children: React.ReactNode }) {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="readaid">
      {children}
    </CopilotKit>
  );
}

