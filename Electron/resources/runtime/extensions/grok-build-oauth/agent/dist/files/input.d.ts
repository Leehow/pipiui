import { type MaterializedInputFile, type SafeInputFile } from "./types.js";
export declare function materializedInputFilesOf(files: readonly (MaterializedInputFile | SafeInputFile)[] | undefined): MaterializedInputFile[];
/**
 * Append already-materialized `{type:"input_file", file_id}` parts onto the
 * Responses `input` array. Does not upload, does not read disk, and does not
 * rewrite hosted tools or structured-output fields.
 */
export declare function applyMaterializedInputFiles(payload: Record<string, unknown>, files: readonly (MaterializedInputFile | SafeInputFile)[] | undefined): Record<string, unknown>;
/** User-visible attachment footnote. Name + size only — never a path or file body. */
export declare function inputFileTranscriptNote(files: readonly SafeInputFile[]): string;
export declare function formatFileSize(bytes: number): string;
