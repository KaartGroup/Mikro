"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import {
  downloadAiResultPdf,
  downloadAiResultTxt,
} from "@/lib/transcribeExports";

type Preset = "summary" | "actions" | "participants" | "decisions" | "custom";

interface PresetDef {
  id: Preset;
  label: string;
  emoji: string;
}

const PRESETS: PresetDef[] = [
  { id: "summary", label: "Summarize", emoji: "📝" },
  { id: "actions", label: "Action Items", emoji: "✅" },
  { id: "participants", label: "Participants", emoji: "👥" },
  { id: "decisions", label: "Decisions", emoji: "🎯" },
  { id: "custom", label: "Custom Prompt", emoji: "💬" },
];

interface AiResult {
  preset: Preset;
  label: string;
  content: string;
  inputTokens: number;
  outputTokens: number;
  timestamp: number;
}

interface Props {
  /** jobId in the transcription_jobs table. Required for AI calls. */
  jobId: string;
  /** Display name used in the filename for AI result exports. */
  displayName: string;
  /** If false, panel renders nothing. Useful while transcription still in flight. */
  enabled?: boolean;
}

export default function AiActions({
  jobId,
  displayName,
  enabled = true,
}: Props) {
  const [activePreset, setActivePreset] = useState<Preset | null>(null);
  const [customPrompt, setCustomPrompt] = useState("");
  const [loading, setLoading] = useState<Preset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<AiResult[]>([]);
  const [copiedResultIdx, setCopiedResultIdx] = useState<number | null>(null);

  if (!enabled) return null;

  const runPreset = async (preset: Preset) => {
    if (loading) return;
    if (preset === "custom" && customPrompt.trim().length < 3) {
      setError("Custom prompt must be at least 3 characters.");
      return;
    }
    setLoading(preset);
    setError(null);
    try {
      const res = await fetch("/backend/transcribe/ai", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId,
          preset,
          prompt: preset === "custom" ? customPrompt.trim() : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.status !== 200) {
        throw new Error(data.message || data.error || "AI request failed");
      }
      const def = PRESETS.find((p) => p.id === preset)!;
      const label =
        preset === "custom"
          ? `Custom: ${customPrompt.trim().slice(0, 40)}${customPrompt.trim().length > 40 ? "…" : ""}`
          : def.label;
      setResults((prev) =>
        [
          {
            preset,
            label,
            content: data.result || "",
            inputTokens: data.tokens?.input || 0,
            outputTokens: data.tokens?.output || 0,
            timestamp: Date.now(),
          },
          ...prev,
        ].slice(0, 5),
      ); // keep 5 most recent
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(null);
    }
  };

  const copyResult = async (idx: number) => {
    const r = results[idx];
    if (!r) return;
    await navigator.clipboard.writeText(r.content);
    setCopiedResultIdx(idx);
    setTimeout(() => setCopiedResultIdx(null), 2000);
  };

  const buttonStyle = (
    active: boolean,
    busy: boolean,
  ): React.CSSProperties => ({
    padding: "8px 14px",
    fontSize: 13,
    opacity: busy ? 0.6 : 1,
    cursor: busy ? "not-allowed" : "pointer",
    backgroundColor: active ? "#004e89" : "#fff",
    color: active ? "#fff" : "#333",
    border: "1px solid " + (active ? "#004e89" : "#d1d5db"),
  });

  return (
    <div style={{ marginTop: 20, marginBottom: 20 }}>
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: "#555",
          marginBottom: 10,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span>AI Actions</span>
        <span style={{ fontSize: 11, color: "#999", fontWeight: 400 }}>
          powered by Claude Haiku — results are not saved
        </span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {PRESETS.map((p) => {
          const busy = loading !== null;
          const isActive = activePreset === p.id;
          const isLoadingThis = loading === p.id;
          return (
            <button
              key={p.id}
              onClick={() => {
                if (busy) return;
                if (p.id === "custom") {
                  setActivePreset(isActive ? null : "custom");
                } else {
                  setActivePreset(p.id);
                  runPreset(p.id);
                }
              }}
              disabled={busy}
              style={buttonStyle(isActive, busy)}
            >
              {isLoadingThis ? "…running" : `${p.emoji} ${p.label}`}
            </button>
          );
        })}
      </div>

      {activePreset === "custom" && (
        <div
          style={{
            marginTop: 12,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <textarea
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            placeholder="Ask something about this transcript… e.g. 'What were the biggest concerns raised?' or 'Draft an email summary for the team'."
            disabled={loading !== null}
            rows={3}
            style={{
              width: "100%",
              padding: 10,
              borderRadius: 8,
              border: "1px solid #d1d5db",
              fontSize: 13,
              fontFamily: "inherit",
              resize: "vertical",
            }}
          />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button
              variant="outline"
              onClick={() => {
                setActivePreset(null);
                setCustomPrompt("");
              }}
              disabled={loading !== null}
              style={{ fontSize: 12 }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => runPreset("custom")}
              disabled={loading !== null || customPrompt.trim().length < 3}
              style={{
                fontSize: 12,
                backgroundColor: "#004e89",
                color: "#fff",
              }}
            >
              {loading === "custom" ? "Running..." : "Run"}
            </Button>
          </div>
        </div>
      )}

      {error && (
        <div
          style={{
            marginTop: 12,
            padding: "10px 14px",
            borderRadius: 8,
            backgroundColor: "#fef2f2",
            border: "1px solid #fca5a5",
            color: "#dc2626",
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {results.map((r, idx) => (
        <div
          key={r.timestamp}
          style={{
            marginTop: 16,
            padding: 16,
            borderRadius: 10,
            border: "1px solid #e5e7eb",
            backgroundColor: "#fafafa",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 10,
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, color: "#333" }}>
              {r.label}
              <span
                style={{
                  marginLeft: 10,
                  fontSize: 11,
                  color: "#999",
                  fontWeight: 400,
                }}
              >
                {r.inputTokens.toLocaleString()} in /{" "}
                {r.outputTokens.toLocaleString()} out tokens
              </span>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <Button
                variant="outline"
                onClick={() => copyResult(idx)}
                style={{
                  fontSize: 11,
                  padding: "4px 10px",
                  backgroundColor:
                    copiedResultIdx === idx ? "#16a34a" : undefined,
                  color: copiedResultIdx === idx ? "#fff" : undefined,
                  borderColor: copiedResultIdx === idx ? "#16a34a" : undefined,
                }}
              >
                {copiedResultIdx === idx ? "Copied" : "Copy"}
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  downloadAiResultTxt(r.content, r.label, displayName)
                }
                style={{ fontSize: 11, padding: "4px 10px" }}
              >
                .txt
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  downloadAiResultPdf(r.content, r.label, displayName)
                }
                style={{ fontSize: 11, padding: "4px 10px" }}
              >
                .pdf
              </Button>
            </div>
          </div>
          <div
            style={{
              fontSize: 14,
              lineHeight: 1.6,
              whiteSpace: "pre-wrap",
              fontFamily: "inherit",
              color: "#333",
            }}
          >
            {r.content}
          </div>
        </div>
      ))}
    </div>
  );
}
