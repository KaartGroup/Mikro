"use client";

import dynamic from "next/dynamic";

const TranscribeWorkerClient = dynamic(
  () => import("./TranscribeWorkerClient"),
  { ssr: false },
);

export default function TranscribeWorkerPage() {
  return <TranscribeWorkerClient />;
}
