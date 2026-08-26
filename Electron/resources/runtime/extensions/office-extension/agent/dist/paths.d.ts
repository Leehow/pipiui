export type PathRejectReason = "empty" | "control_chars" | "home_expansion" | "url_shape" | "traversal" | "absolute_outside" | "symlink_escape" | "not_a_file" | "is_directory" | "unsupported_extension" | "missing_parent" | "toctou";
export declare class PathValidationError extends Error {
    readonly code: "path_rejected";
    readonly reason: PathRejectReason;
    readonly input: string;
    constructor(reason: PathRejectReason, input: string, message: string);
}
export type ValidatedPath = {
    input: string;
    absolute: string;
    extension: string;
    mustExist: boolean;
    requireOfficeExtension: boolean;
};
export type ValidatePathOptions = {
    mustExist: boolean;
    requireOfficeExtension?: boolean;
};
export declare function containedBy(root: string, target: string): boolean;
export declare function validateDocumentPath(input: string, projectRoot: string, options: ValidatePathOptions): Promise<ValidatedPath>;
export declare function recheckValidatedPath(previous: ValidatedPath, projectRoot: string): Promise<ValidatedPath>;
