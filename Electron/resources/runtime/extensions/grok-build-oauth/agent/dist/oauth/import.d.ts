export declare function importFromGlobalGrok(opts: {
    confirm: boolean;
    homedirOverride?: string;
}): Promise<{
    imported: boolean;
    reason?: string;
}>;
export declare function globalGrokAuthPath(homedirOverride?: string): string;
