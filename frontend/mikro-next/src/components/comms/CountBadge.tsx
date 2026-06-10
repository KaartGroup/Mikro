"use client";

import { CSSProperties } from "react";

// Shared red unread-count badge. Caps display at "99+". Used on the
// header icons (absolute-positioned upper right) AND in the messenger
// conversation list (inline next to the row label). The `position`
// prop picks between the two layouts.

interface CountBadgeProps {
  count: number;
  position?: "absolute-top-right" | "inline";
}

const baseStyle: CSSProperties = {
  minWidth: 18,
  height: 18,
  padding: "0 5px",
  borderRadius: 9,
  background: "#dc2626",
  color: "#fff",
  fontSize: 10,
  fontWeight: 700,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

export function CountBadge({ count, position = "inline" }: CountBadgeProps) {
  if (count <= 0) return null;
  const style: CSSProperties =
    position === "absolute-top-right"
      ? { ...baseStyle, position: "absolute", top: 2, right: 2 }
      : baseStyle;
  return <span style={style}>{count > 99 ? "99+" : count}</span>;
}
