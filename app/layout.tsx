import type { Metadata } from "next";
import "./globals.css";
import "@xyflow/react/dist/style.css";
import "@copilotkit/react-core/v2/styles.css";

export const metadata: Metadata = {
  title: "ReadAid — understand the story",
  description: "Accessible reading support with evidence and a synchronized knowledge graph.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

