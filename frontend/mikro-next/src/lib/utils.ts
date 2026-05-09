import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Utility function to merge Tailwind CSS classes.
 * Combines clsx for conditional classes with tailwind-merge
 * to properly handle Tailwind class conflicts.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Display-friendly role label. Always uses `roleLabel` from types so
 * UI never shows a bare "Admin" — admin tiers must be explicit
 * ("Org Admin", "Team Admin", "Super Admin") per F3 decision 6.
 *
 * Kept as a thin wrapper for backward compatibility with the many
 * existing call sites that import `displayRole`.
 */
import { roleLabel } from "@/types";

export function displayRole(role: string): string {
  return roleLabel(role);
}

/**
 * A formatted value that carries whether it came from real data or a fallback.
 * Use with the <Val> component to visually distinguish placeholders.
 */
export type FormattedValue = {
  text: string;
  isPlaceholder: boolean;
};

/**
 * Format a number with thousand separators (e.g., 1234 → "1,234").
 * Returns a FormattedValue — isPlaceholder is true when the input was null/undefined/NaN.
 */
export function formatNumber(value: number | null | undefined): FormattedValue {
  if (value == null || isNaN(value)) {
    return { text: "0", isPlaceholder: true };
  }
  return { text: value.toLocaleString("en-US"), isPlaceholder: false };
}

/**
 * Format a number as USD currency (e.g., 1234.5 → "$1,234.50").
 * Returns a FormattedValue — isPlaceholder is true when the input was null/undefined.
 */
export function formatCurrency(amount: number | null | undefined): FormattedValue {
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount ?? 0);

  return {
    text: formatted,
    isPlaceholder: amount == null,
  };
}

/**
 * Format a string value with a fallback for null/undefined/blank.
 * Returns a FormattedValue — isPlaceholder is true when the fallback is used.
 */
export function formatString(
  value: string | null | undefined,
  fallback: string = "\u2014"
): FormattedValue {
  if (!value || !value.trim()) {
    return { text: fallback, isPlaceholder: true };
  }
  return { text: value, isPlaceholder: false };
}

/**
 * Build the canonical TM4 project URL from a project ID.
 * Always returns `https://tasks.kaart.com/projects/{id}` regardless
 * of whatever URL string might be stored in the database.
 */
export function getTM4ProjectUrl(projectId: number | string): string {
  return `https://tasks.kaart.com/projects/${projectId}`;
}

/**
 * Build the external URL for a project based on its source platform.
 * TM4 projects link to tasks.kaart.com, MR projects link to maproulette.org.
 */
export function getProjectExternalUrl(
  projectId: number | string,
  source?: string
): string {
  if (source === "mr") {
    return `https://maproulette.org/browse/challenges/${projectId}`;
  }
  return `https://tasks.kaart.com/projects/${projectId}`;
}
