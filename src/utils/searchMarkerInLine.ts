// Search for marker in a line in a direction
export function searchMarkerInLine(line: string, marker: string, fromIdx: number, direction: 'back' | 'forward'): number {
    if (direction === 'back') {
        return line.lastIndexOf(marker, fromIdx);
    } else {
        return line.indexOf(marker, fromIdx);
    }
}
