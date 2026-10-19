import type { CSSProperties } from "react";

export const MOTION = {
  enter: 520,
  exit: 360,
  reflow: 420,
  feedback: 240,
  progress: 440,
  ease: "cubic-bezier(.22,1,.36,1)",
} as const;

export const motionStyle = Object.fromEntries(
  Object.entries(MOTION).map(([name, value]) => [
    `--motion-${name}`,
    typeof value === "number" ? `${value}ms` : value,
  ]),
) as CSSProperties;

export const MOTION_PREFERENCE = "airbridge.motion.v1";
export function readMotionPaused(): boolean {
  try {
    return localStorage.getItem(MOTION_PREFERENCE) === "paused";
  } catch {
    return false;
  }
}

// Add the currently displayed translation before interrupting a layout move.
// Layout offsets stay unanimated; visual transforms never become layout state.
export function reflowDelta(
  previous: { x: number; y: number },
  next: { x: number; y: number },
  displayed: { x: number; y: number },
) {
  return {
    x: previous.x - next.x + displayed.x,
    y: previous.y - next.y + displayed.y,
  };
}
