// Get word bounds in a line at a given character position
export function getWordBounds(line: string, ch: number): { start: number, end: number } | null {
    const regex = /[\p{L}\p{N}_]+/gu;
    let match;
    while ((match = regex.exec(line)) !== null) {
        if (ch >= match.index && ch <= match.index + match[0].length) {
            return { start: match.index, end: match.index + match[0].length };
        }
    }
    return null;
}
