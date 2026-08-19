/**
 * Remove terminal control sequences and display-direction controls from untrusted single-line text.
 *
 * This function is only for presentation. Keep raw identities and payloads separate.
 */
export declare function sanitizeTerminalText(value: string): string;
