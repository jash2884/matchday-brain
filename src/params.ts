import type { Params } from "./model.ts";
// Tuned by scripts/fit.ts on the 2024-25 season only (minimum log loss across
// all five leagues). Later seasons are never used for tuning.
export const PARAMS: Params = { k: 12, home: 40, draw0: 0.3, draw1: 0.18, regress: 0.2, promoted: -150 };
