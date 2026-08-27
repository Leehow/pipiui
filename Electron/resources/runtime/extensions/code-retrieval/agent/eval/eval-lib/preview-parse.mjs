/**
 * Pure preview-block parser for INDEPENDENTLY measuring code_search /
 * code_nav / repo_map results in the evaluator (third-review remediation).
 *
 * A rendered preview block under a ref line ("R12 path:l-l …") contains:
 * - numbered source lines ("  12| code") — normalized into `srcLines`; and
 * - indented renderer note lines such as "  … lines 17–22 not shown;
 *   read_spans R12 for the full span" — part of the COMPLETE rendered block.
 *
 * Summing only numbered lines would under-measure the block and silently
 * delegate those tokens to the renderer's self-reported footer. Both kinds are
 * therefore captured into `text`, which is exactly the surface token counting
 * must cover. Keeping the parser pure lets node:test pin the measurement
 * without any compiled runtime.
 */

export const normalizeLine = (line) => line.replace(/^\s*\d+\|/, "").replace(/^\s+/, "");

export function parsePreviewBlocks(contentText) {
  const blocks = new Map(); // ref → {text, srcLines}
  let currentRef;
  for (const raw of String(contentText ?? "").split("\n")) {
    const refMatch = raw.match(/^(R\d+)\s+\S+/);
    if (refMatch) {
      currentRef = refMatch[1];
      blocks.set(currentRef, { text: "", srcLines: [] });
      continue;
    }
    if (/^\s*\d+\|/.test(raw) && currentRef) {
      const block = blocks.get(currentRef);
      block.srcLines.push(normalizeLine(raw));
      block.text += `${raw}\n`;
    } else if (/^\s/.test(raw) && currentRef && blocks.get(currentRef)?.srcLines.length) {
      // Indented non-numbered line INSIDE an open preview block: renderer
      // truncation/continuation notes count toward independently measured
      // tokens because the renderer bills them too.
      blocks.get(currentRef).text += `${raw}\n`;
    } else if (raw.trim() && !raw.startsWith(" ") && currentRef && blocks.get(currentRef)?.srcLines.length) {
      currentRef = undefined; // next non-preview content ends the block
    }
  }
  for (const [, b] of blocks) b.text = b.text.trimEnd();
  return blocks;
}
