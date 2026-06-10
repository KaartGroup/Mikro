import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { ROUTES, AUTH_ROUTES } from "../routes";

// src/lib/__tests__/ → up two levels → src/ → then app/
const appDir = resolve(__dirname, "../../app");

function pageFiles(route: string): string[] {
  if (route === "/") return [resolve(appDir, "page.tsx")];
  const seg = route.slice(1); // strip leading /
  return [
    resolve(appDir, "(authenticated)", seg, "page.tsx"),
    resolve(appDir, seg, "page.tsx"),
  ];
}

const appRoutes = Object.entries(ROUTES).filter(
  ([, route]) => !(AUTH_ROUTES as readonly string[]).includes(route),
);

describe("ROUTES", () => {
  it.each(appRoutes)("ROUTES.%s (%s) has a page.tsx", (key, route) => {
    expect(
      pageFiles(route).some(existsSync),
      `ROUTES.${key} = "${route}" — no page.tsx found`,
    ).toBe(true);
  });
});
