"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import type { TranscriptionSegment } from "@/lib/transcribe";
import {
  downloadTranscriptPdf,
  downloadTranscriptTxt,
} from "@/lib/transcribeExports";

interface Props {
  segments: TranscriptionSegment[];
  fullText: string;
  displayName: string;
}

export default function ExportButtons({
  segments,
  fullText,
  displayName,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(fullText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePdf = async () => {
    try {
      setPdfBusy(true);
      await downloadTranscriptPdf(segments, fullText, displayName);
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        flexWrap: "wrap",
        justifyContent: "flex-end",
      }}
    >
      <Button
        variant="outline"
        onClick={() => downloadTranscriptTxt(segments, fullText, displayName)}
        style={{ fontSize: 13 }}
      >
        Download .txt
      </Button>
      <Button
        variant="outline"
        onClick={handlePdf}
        disabled={pdfBusy}
        style={{ fontSize: 13 }}
      >
        {pdfBusy ? "Generating…" : "Download .pdf"}
      </Button>
      <Button
        onClick={handleCopy}
        style={{
          backgroundColor: copied ? "#16a34a" : "#ff6b35",
          color: "#fff",
        }}
      >
        {copied ? "Copied!" : "Copy to Clipboard"}
      </Button>
    </div>
  );
}
