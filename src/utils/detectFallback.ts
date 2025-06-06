import { normalize } from './normalize';
import { isRegionCommented } from './isRegionCommented';

const defaultStyles = [
    { start: "%%", end: "%%" },
    { start: "<!--", end: "-->" },
    { start: "//", end: "" },
];

// Fallback style detection for comments
export function detectFallback(text: string) {
    for (const style of defaultStyles) {
        const s = normalize(style.start);
        const e = normalize(style.end);
        if (isRegionCommented(text, s, e)) {
            return { found: true, markerStart: style.start, markerEnd: style.end };
        }
    }
    return { found: false };
}
