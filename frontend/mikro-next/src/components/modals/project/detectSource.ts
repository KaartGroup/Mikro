/**
 * Project source detection for the Add-Project modal.
 *
 * The admin only pastes a URL — the modal derives whether it's a MapRoulette
 * challenge or a TM4 project so they never have to pick by hand. This must stay
 * in lock-step with the backend's `ProjectService.detect_source`, which uses
 * the same rule: any URL containing "maproulette" is MapRoulette, everything
 * else is treated as TM4. (`create_project` re-derives the source server-side
 * from the same URL, so a mismatch here would silently disagree with the row
 * that actually gets created.)
 */

type ProjectSource = "tm4" | "mr";

export function detectSource(url: string): ProjectSource {
  return url.toLowerCase().includes("maproulette") ? "mr" : "tm4";
}
