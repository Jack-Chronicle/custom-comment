// Utility: Normalize a marker string (collapse whitespace, trim)
export function normalize(str: string): string {
    return str.replace(/\s+/g, ' ').trim();
}
