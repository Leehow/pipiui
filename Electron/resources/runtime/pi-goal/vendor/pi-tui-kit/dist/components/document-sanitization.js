import { stripVTControlCharacters } from "node:util";
export function sanitizeDocumentText(value) {
    const stripped = stripVTControlCharacters(String(value)).replace(/\r\n?/gu, "\n");
    return Array.from(stripped, (character) => {
        if (character === "\n" || character === "\t")
            return character;
        const codePoint = character.codePointAt(0) ?? 0;
        if (isBidiControl(codePoint))
            return "";
        return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f) ? " " : character;
    }).join("");
}
function isBidiControl(codePoint) {
    return (codePoint === 0x061c ||
        codePoint === 0x200e ||
        codePoint === 0x200f ||
        (codePoint >= 0x202a && codePoint <= 0x202e) ||
        (codePoint >= 0x2066 && codePoint <= 0x2069));
}
