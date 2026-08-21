export declare function redactToken(token: string): string;
export declare function redactMessage(message: string, tokens: string[]): string;
export declare function redactObject<T>(value: T, tokens: string[]): T;
