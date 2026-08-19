const ESC = 0x1b;
const BEL = 0x07;
const CSI = 0x9b;
const ST = 0x9c;
const OSC = 0x9d;
const DCS = 0x90;
const PM = 0x9e;
const APC = 0x9f;
/**
 * Remove terminal control sequences and display-direction controls from untrusted single-line text.
 *
 * This function is only for presentation. Keep raw identities and payloads separate.
 */
export function sanitizeTerminalText(value) {
    let output = "";
    for (let index = 0; index < value.length;) {
        const codePoint = value.codePointAt(index) ?? 0;
        const length = codePoint > 0xffff ? 2 : 1;
        if (codePoint === ESC) {
            index = skipEscSequence(value, index);
            continue;
        }
        if (codePoint === CSI) {
            index = skipCsi(value, index + length);
            continue;
        }
        if (codePoint === OSC || codePoint === DCS || codePoint === PM || codePoint === APC) {
            index = skipStringSequence(value, index + length, codePoint === OSC);
            continue;
        }
        if (isLineSeparator(codePoint)) {
            output += " ";
            index += length;
            continue;
        }
        if (isControl(codePoint) || isBidiControl(codePoint)) {
            index += length;
            continue;
        }
        output += String.fromCodePoint(codePoint);
        index += length;
    }
    return output;
}
function skipEscSequence(value, start) {
    const introducer = value.charCodeAt(start + 1);
    if (introducer === 0x5b)
        return skipCsi(value, start + 2);
    if (introducer === 0x5d)
        return skipStringSequence(value, start + 2, true);
    if (introducer === 0x50 || introducer === 0x5e || introducer === 0x5f) {
        return skipStringSequence(value, start + 2, false);
    }
    return skipGenericEscSequence(value, start);
}
function skipGenericEscSequence(value, start) {
    let index = start + 1;
    while (index < value.length) {
        const code = value.charCodeAt(index);
        if (code < 0x20 || code > 0x2f)
            break;
        index += 1;
    }
    const final = value.charCodeAt(index);
    return final >= 0x30 && final <= 0x7e ? index + 1 : start + 1;
}
function skipCsi(value, start) {
    for (let index = start; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (code >= 0x40 && code <= 0x7e)
            return index + 1;
    }
    return value.length;
}
function skipStringSequence(value, start, bellTerminates) {
    for (let index = start; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (bellTerminates && code === BEL)
            return index + 1;
        if (code === ST)
            return index + 1;
        if (code === ESC && value.charCodeAt(index + 1) === 0x5c)
            return index + 2;
    }
    return value.length;
}
function isLineSeparator(codePoint) {
    return (codePoint === 0x09 ||
        codePoint === 0x0a ||
        codePoint === 0x0d ||
        codePoint === 0x85 ||
        codePoint === 0x2028 ||
        codePoint === 0x2029);
}
function isControl(codePoint) {
    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
}
function isBidiControl(codePoint) {
    return (codePoint === 0x061c ||
        codePoint === 0x200e ||
        codePoint === 0x200f ||
        (codePoint >= 0x202a && codePoint <= 0x202e) ||
        (codePoint >= 0x2066 && codePoint <= 0x2069));
}
