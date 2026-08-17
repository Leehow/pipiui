/** Apply a live stream delta or replace, keeping displayed text capped while tracking uncapped length. */
export function applyCappedStreamText(
	part: { text: string; charCount?: number },
	delta: string,
	cap: number,
	replaceText?: string,
): void {
	if (typeof replaceText === "string") {
		part.charCount = replaceText.length;
		part.text = replaceText.slice(0, cap);
		return;
	}
	if (delta) {
		part.charCount = (part.charCount ?? part.text.length) + delta.length;
		if (part.text.length < cap) {
			part.text = (part.text + delta).slice(0, cap);
		}
	}
}
