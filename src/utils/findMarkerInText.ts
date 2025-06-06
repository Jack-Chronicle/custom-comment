// Find a marker in a text, return index and match info
export function findMarkerInText(marker: string, text: string) {
    let idx = text.indexOf(marker);
    if (idx !== -1) return { idx, full: true };
    // Try partials (from length-1 down to 1)
    for (let len = marker.length - 1; len > 0; len--) {
        if (text.includes(marker.slice(0, len))) return { idx: text.indexOf(marker.slice(0, len)), full: false, partial: marker.slice(0, len) };
        if (text.includes(marker.slice(-len))) return { idx: text.indexOf(marker.slice(-len)), full: false, partial: marker.slice(-len) };
    }
    return { idx: -1, full: false };
}
