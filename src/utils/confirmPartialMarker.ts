// Confirm a partial marker match in a line
export function confirmPartialMarker({
    line,
    marker,
    partialIdx,
    isStart,
    otherMarker,
    uniqueMarkers = true
}: {
    line: string,
    marker: string,
    partialIdx: number,
    isStart: boolean,
    otherMarker: string,
    uniqueMarkers?: boolean
}) {
    const len = marker.length;
    let fullIdx = -1;
    for (let i = Math.max(0, partialIdx - len + 1); i <= partialIdx; i++) {
        if (line.slice(i, i + len) === marker) {
            fullIdx = i;
            break;
        }
    }
    if (fullIdx === -1) {
        for (let i = partialIdx; i <= Math.min(line.length - len, partialIdx + len - 1); i++) {
            if (line.slice(i, i + len) === marker) {
                fullIdx = i;
                break;
            }
        }
    }
    if (fullIdx === -1) return { confirmed: false };
    if (isStart) {
        let nextEnd = line.indexOf(otherMarker, fullIdx + len);
        if (nextEnd === -1) return { confirmed: false };
        if (uniqueMarkers) {
            let nextStart = line.indexOf(marker, fullIdx + len);
            if (nextStart !== -1 && nextStart < nextEnd) return { confirmed: false };
        }
        return { confirmed: true, startIdx: fullIdx, endIdx: nextEnd };
    } else {
        let prevStart = line.lastIndexOf(otherMarker, fullIdx - 1);
        if (prevStart === -1) return { confirmed: false };
        if (uniqueMarkers) {
            let prevEnd = line.lastIndexOf(marker, fullIdx - 1);
            if (prevEnd !== -1 && prevEnd > prevStart) return { confirmed: false };
        }
        return { confirmed: true, startIdx: prevStart, endIdx: fullIdx };
    }
}
