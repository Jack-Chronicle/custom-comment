// Check if a region is commented with given start/end markers
export function isRegionCommented(text: string, start: string, end: string) {
    const trimmed = text.trim();
    if (start && end) {
        return trimmed.startsWith(start) && trimmed.endsWith(end);
    } else if (start) {
        return trimmed.startsWith(start);
    }
    return false;
}
