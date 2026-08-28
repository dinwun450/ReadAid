import { ReadAidProvider } from "@/components/read-aid-provider";
import { ReaderApp } from "@/components/reader-app";

export default function Home() {
  return (
    <ReadAidProvider>
      <ReaderApp />
    </ReadAidProvider>
  );
}
