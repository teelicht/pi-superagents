/**
 * Backward-compatible shared utility export surface.
 *
 * Responsibilities:
 * - preserve legacy imports from `src/shared/utils.ts`
 * - re-export focused message, tool, and concurrency helpers from their owners
 *
 * Important dependencies/side effects:
 * - imports implementation modules only for re-export
 * - performs no I/O and has no side effects
 */

// fallow-ignore-next-line unused-export
export { mapConcurrent } from "../execution/parallel-utils.ts";
// fallow-ignore-next-line unused-export
export { detectSubagentError, extractTextFromContent, getDisplayItems, getFinalOutput, getSingleResultOutput } from "./message-utils.ts";
// fallow-ignore-next-line unused-export
export { extractToolArgsPreview } from "./tool-utils.ts";
