import { football } from "./football.ts";
import { nfl } from "./nfl.ts";
import { cricket } from "./cricket.ts";
import type { SportAdapter } from "./adapter.ts";
export const SPORTS: SportAdapter[] = [football, cricket, nfl];
