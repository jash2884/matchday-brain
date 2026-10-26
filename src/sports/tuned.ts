import type { EloParams } from "../core/types.ts";
// Settings chosen by `node scripts/fit.ts <group>` on each sport's tuning
// window only (minimum log loss). Test seasons are never used for tuning.
export const TUNED: Record<"football" | "nfl" | "cricket" | "cricketTests", EloParams> = {
  football: { k: 20, home: 60, draws: { d0: 0.3, d1: 0.18 }, regress: 0.15, newcomer: -200, mov: "goals", scale: 700 },
  nfl: { k: 40, home: 48, draws: null, regress: 0.25, newcomer: 0, mov: "points", scale: 900 },
  cricket: { k: 56, home: 0, draws: null, regress: 0.15, newcomer: -300, mov: "none", scale: 400 },
  cricketTests: { k: 32, home: 0, draws: { d0: 0.22, d1: 0.15 }, regress: 0, newcomer: -300, mov: "none", scale: 400 },
};
