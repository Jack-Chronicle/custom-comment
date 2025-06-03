/**
 * Main entry point for the Custom Comments Obsidian plugin.
 *
 * This plugin allows users to insert customizable comment templates into their notes.
 * Users can define their own comment format using `{cursor}` as a placeholder for the cursor position.
 *
 * @packageDocumentation
 */
import { Plugin, Editor } from "obsidian";
import { CommentFormatSettings, DEFAULT_SETTINGS } from "./settingsData";
import { CommentFormatSettingTab } from "./settingsTab";

// @ts-ignore
import { EditorView, Decoration, WidgetType } from '@codemirror/view';
// @ts-ignore
import { StateField, StateEffect, RangeSetBuilder } from '@codemirror/state';

// DEV logging utility: only logs if __DEV__ is true (set by esbuild)
declare const __DEV__: boolean;
function logDev(...args: any[]) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
        // eslint-disable-next-line no-console
        console.log('[CustomComment DEV]', ...args);
    }
}

// Default fallback comment styles for removal
const defaultStyles = [
    { start: "%%", end: "%%" },
    { start: "<!--", end: "-->" },
    { start: "//", end: "" },
];

/**
 * Main plugin class for Custom Comments.
 * Handles command registration, settings, and comment toggling logic.
 */
export default class CommentFormatPlugin extends Plugin {
    /**
     * Plugin settings, loaded on initialization.
     */
    settings!: CommentFormatSettings & { wordOnlyMode?: boolean };
    private _markerCommandIds: string[] = [];
    private _cleanupGuard: boolean = false;

    /**
     * Called when the plugin is loaded. Registers commands and settings tab.
     */
    async onload() {
        logDev('Plugin loading...');
        await this.loadSettings();
        this.addSettingTab(new CommentFormatSettingTab(this.app, this));

        // Register reload marker commands command
        this.addCommand({
            id: "reload-marker-commands",
            name: "Reload Marker Commands",
            callback: () => this.registerMarkerCommands(true)
        });

        this.registerMarkerCommands();
        // Removed: auto-cleanup event registration
    }

    /**
     * Registers all marker commands (main + enabled additional marker sets). If force is true, re-registers all.
     */
    registerMarkerCommands(force = false) {
        if (force && this._markerCommandIds) {
            this._markerCommandIds = [];
        }
        this._markerCommandIds = [];

        // Register main toggle command
        let mainTemplate = this.settings.template ?? "%% {cursor} %%";
        const cursorIndex = mainTemplate.indexOf("{cursor}");
        let before = "%%";
        let after = "%%";
        if (cursorIndex !== -1) {
            before = mainTemplate.slice(0, cursorIndex).trim() || "%%";
            after = mainTemplate.slice(cursorIndex + "{cursor}".length).trim() || "%%";
        }
        const mainId = "toggle-comment-template";
        this.addCommand({
            id: mainId,
            name: `Toggle Comment: (${before}|${after})`,
            editorCallback: (editor: Editor) => this.toggleComment(editor)
        });
        this._markerCommandIds.push(mainId);

        // Register additional marker commands if enabled
        if (Array.isArray(this.settings.additionalMarkers)) {
            this.settings.additionalMarkers.forEach((marker, i) => {
                if (marker && marker.registerCommand) {
                    const id = `toggle-comment-marker-set-${i + 1}`;
                    this.addCommand({
                        id,
                        name: (() => {
                            const start = marker.start?.trim() || "%%";
                            const end = marker.end?.trim() || "%%";
                            return `Toggle Marker ${i + 1}: (${start}|${end})`;
                        })(),
                        checkCallback: (checking: boolean, editor?: Editor) => {
                            if (!checking && editor) this.toggleComment(editor, marker);
                            return true;
                        }
                    });
                    this._markerCommandIds.push(id);
                }
            });
        }
        logDev('Marker commands registered:', this._markerCommandIds);
    }

    /**
     * Loads plugin settings from disk.
     */
    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
        logDev('Settings loaded:', this.settings);
    }

    /**
     * Saves plugin settings to disk.
     */
    async saveSettings() {
        await this.saveData(this.settings);
        logDev('Settings saved:', this.settings);
    }

    /**
     * Reloads the plugin (disable, then enable) using the Obsidian API.
     * Can be called from settings UI to refresh commands after marker set changes.
     */
    async reloadPlugin() {
        // @ts-ignore
        await this.app.plugins.disablePlugin(this.manifest.id);
        // @ts-ignore
        await this.app.plugins.enablePlugin(this.manifest.id);
        logDev('Plugin reloaded');
    }

    /**
     * Inserts a comment at the current cursor position using the template.
     */
    insertComment(editor: Editor) {
        let template = this.settings.template;
        let cursorIndex = template.indexOf("{cursor}");
        if (cursorIndex === -1) {
            editor.replaceSelection(template);
            logDev('Inserted template (no cursor placeholder)');
            return;
        }
        let before = template.slice(0, cursorIndex).trim();
        let after = template.slice(cursorIndex + "{cursor}".length).trim();
        const commentText = `${before} ${after}`.replace(/\s+/g, ' ').trim();
        const from = editor.getCursor();
        editor.replaceSelection(`${before}  ${after}`.replace(/\s+/g, ' ').replace(' ', ' {cursor} '));
        const lines = before.split("\n");
        const cursorLineOffset = lines.length - 1;
        const cursorChOffset = lines[lines.length - 1].length + 1;
        editor.setCursor({
            line: from.line + cursorLineOffset,
            ch: (cursorLineOffset ? 0 : from.ch) + cursorChOffset
        });
        logDev('Inserted comment at cursor');
    }

    /**
     * Toggles comment using a specific marker set, or the default template if none provided.
     * Handles selection, word, and cursor modes robustly.
     * @param editor Obsidian editor
     * @param markerSet Optional marker set { start: string; end: string }
     */
    toggleComment(editor: Editor, markerSet?: { start: string; end: string }) {
        logDev('toggleComment called', { selection: editor.getSelection(), cursor: editor.getCursor(), markerSet });
        // --- Clamp helper ---
        function clampCursorPos(pos: { line: number, ch: number }): { line: number, ch: number } {
            const allLines = editor.getValue().split('\n');
            let line = Math.max(0, Math.min(pos.line, allLines.length - 1));
            let ch = Math.max(0, Math.min(pos.ch, allLines[line]?.length ?? 0));
            return { line, ch };
        }
        let markerStart: string, markerEnd: string;
        let markerStartNormalized: string, markerEndNormalized: string;
        if (markerSet) {
            markerStart = markerSet.start.trim();
            markerEnd = markerSet.end.trim();
            markerStartNormalized = markerSet.start.endsWith(' ')? markerSet.start : markerSet.start + ' ';
            markerEndNormalized = markerSet.end.startsWith(' ')? markerSet.end : ' ' + markerSet.end;
        } else {
            const template = this.settings.template;
            const cursorIndex = template.indexOf("{cursor}");
            let before = template;
            let after = "";
            if (cursorIndex !== -1) {
                before = template.slice(0, cursorIndex);
                after = template.slice(cursorIndex + "{cursor}".length);
            }
            markerStart = before.trim();
            markerEnd = after.trim();
            markerStartNormalized = markerStart + (markerStart && !markerStart.endsWith(' ')? ' ' : '');
            markerEndNormalized = (markerEnd && !markerEnd.startsWith(' ')? ' ' : '') + markerEnd;
        }
        const selection = editor.getSelection();
        const cursor = editor.getCursor();
        let text: string;
        let from = editor.getCursor("from");
        let to = editor.getCursor("to");
        let wordBounds: { start: number, end: number } | null = null;
        let line = editor.getLine(cursor.line);
        function getWordBounds(line: string, ch: number): { start: number, end: number } | null {
            const regex = /[\p{L}\p{N}_]+/gu;
            let match;
            while ((match = regex.exec(line)) !== null) {
                if (ch >= match.index && ch <= match.index + match[0].length) {
                    return { start: match.index, end: match.index + match[0].length };
                }
            }
            return null;
        }
        function isTextCommentedExact(str: string, start: string, end: string) {
            if (!start) return false;
            if (end) {
                return str.startsWith(start) && str.endsWith(end);
            } else {
                return str.startsWith(start);
            }
        }
        function scanForFirst(lines: string[], fromLine: number, fromCh: number, marker: string, opposite: string, direction: 'back' | 'forward'): { type: 'marker' | 'opposite' | null, pos: { line: number, ch: number } | null } {
            const markerTrim = marker.trim();
            const oppositeTrim = opposite.trim();
            if (direction === 'back') {
                for (let l = fromLine; l >= 0; l--) {
                    let line = lines[l];
                    let searchStart = l === fromLine ? fromCh : line.length;
                    for (let idx = searchStart - 1; idx >= 0; idx--) {
                        if (line.substr(idx, markerTrim.length) === markerTrim) return { type: 'marker', pos: { line: l, ch: idx } };
                        if (line.substr(idx, oppositeTrim.length) === oppositeTrim) return { type: 'opposite', pos: { line: l, ch: idx } };
                    }
                }
            } else {
                for (let l = fromLine; l < lines.length; l++) {
                    let line = lines[l];
                    let searchStart = l === fromLine ? fromCh : 0;
                    for (let idx = searchStart; idx <= line.length - Math.min(markerTrim.length, oppositeTrim.length); idx++) {
                        if (line.substr(idx, markerTrim.length) === markerTrim) return { type: 'marker', pos: { line: l, ch: idx } };
                        if (line.substr(idx, oppositeTrim.length) === oppositeTrim) return { type: 'opposite', pos: { line: l, ch: idx } };
                    }
                }
            }
            return { type: null, pos: null };
        }
        let isComment = false;
        let commentStartPos: { line: number, ch: number } | null = null;
        let commentEndPos: { line: number, ch: number } | null = null;
        const allLines = editor.getValue().split('\n');
        if (markerStart && markerEnd) {
            let beforeType, afterType;
            if (selection) {
                const before = scanForFirst(allLines, from.line, from.ch, markerStart, markerEnd, 'back');
                const after = scanForFirst(allLines, to.line, to.ch, markerEnd, markerStart, 'forward');
                beforeType = before.type;
                afterType = after.type;
                if (beforeType === 'marker') commentStartPos = before.pos;
                if (afterType === 'marker') commentEndPos = after.pos;
            } else {
                const before = scanForFirst(allLines, cursor.line, cursor.ch, markerStart, markerEnd, 'back');
                const after = scanForFirst(allLines, cursor.line, cursor.ch, markerEnd, markerStart, 'forward');
                beforeType = before.type;
                afterType = after.type;
                if (beforeType === 'marker') commentStartPos = before.pos;
                if (afterType === 'marker') commentEndPos = after.pos;
            }
            if (beforeType === 'marker' && afterType === 'marker') {
                isComment = true;
            } else if (beforeType === 'opposite' && afterType === 'opposite') {
                isComment = false;
            } else {
                isComment = false;
            }
        }
        logDev('comment:', isComment, {
            start: commentStartPos ? { line: commentStartPos.line + 1, ch: commentStartPos.ch + 1 } : null,
            end: commentEndPos ? { line: commentEndPos.line + 1, ch: commentEndPos.ch + 1 } : null
        });

        if (selection && markerStart && markerEnd) {
            const lineText = editor.getLine(from.line);
            const selectionText = selection;
            let foundStart = false, foundEnd = false;
            let startIdx = selectionText.indexOf(markerStart);
            let endIdx = selectionText.indexOf(markerEnd);
            function containsPartOfMarker(sel: string, marker: string): boolean {
                if (!marker) return false;
                for (let i = 1; i <= marker.length; i++) {
                    if (sel.includes(marker.slice(0, i)) || sel.includes(marker.slice(-i))) return true;
                }
                return false;
            }
            if (!foundStart && containsPartOfMarker(selectionText, markerStart)) {
                const left = lineText.slice(Math.max(0, from.ch - markerStart.length), from.ch + selectionText.length);
                if (left.includes(markerStart)) {
                    foundStart = true;
                    startIdx = left.indexOf(markerStart) - (from.ch - Math.max(0, from.ch - markerStart.length));
                }
            }
            if (!foundEnd && containsPartOfMarker(selectionText, markerEnd)) {
                const right = lineText.slice(from.ch, Math.min(lineText.length, to.ch + markerEnd.length));
                if (right.includes(markerEnd)) {
                    foundEnd = true;
                    endIdx = right.indexOf(markerEnd);
                }
            }
            if (selectionText.includes(markerStart)) {
                foundStart = true;
                startIdx = selectionText.indexOf(markerStart);
            }
            if (selectionText.includes(markerEnd)) {
                foundEnd = true;
                endIdx = selectionText.indexOf(markerEnd);
            }
            if (markerStart === markerEnd && markerStart.length > 0 && (foundStart || foundEnd)) {
                const before = scanForFirst(allLines, from.line, from.ch, markerStart, '', 'back');
                const after = scanForFirst(allLines, to.line, to.ch, markerEnd, '', 'forward');
                if (before.type === 'marker') commentStartPos = before.pos;
                if (after.type === 'marker') commentEndPos = after.pos;
                if (commentStartPos && commentEndPos) isComment = true;
            } else if (foundStart && !foundEnd) {
                let searchLine = from.line;
                let searchCh = lineText.indexOf(markerStart, from.ch);
                if (searchCh === -1) searchCh = from.ch;
                let found = false;
                for (let l = searchLine; l < allLines.length; l++) {
                    let line = allLines[l];
                    let start = (l === searchLine) ? searchCh + markerStart.length : 0;
                    for (let idx = start; idx <= line.length - markerEnd.length; idx++) {
                        if (line.substr(idx, markerEnd.length) === markerEnd) {
                            commentStartPos = { line: searchLine, ch: searchCh };
                            commentEndPos = { line: l, ch: idx };
                            isComment = true;
                            found = true;
                            break;
                        }
                        if (line.substr(idx, markerStart.length) === markerStart && (l !== searchLine || idx !== searchCh)) {
                            logDev('Stopped search for end marker: found another start marker first', { from: { line: searchLine, ch: searchCh }, at: { line: l, ch: idx } });
                            found = true;
                            break;
                        }
                    }
                    if (found) break;
                }
            } else if (foundEnd && !foundStart) {
                let searchLine = to.line;
                let searchCh = lineText.indexOf(markerEnd, from.ch);
                if (searchCh === -1) searchCh = to.ch;
                let found = false;
                for (let l = searchLine; l >= 0; l--) {
                    let line = allLines[l];
                    let end = (l === searchLine) ? searchCh - 1 : line.length - 1;
                    for (let idx = end; idx >= 0; idx--) {
                        if (line.substr(idx, markerStart.length) === markerStart) {
                            commentStartPos = { line: l, ch: idx };
                            commentEndPos = { line: searchLine, ch: searchCh };
                            isComment = true;
                            found = true;
                            break;
                        }
                        if (line.substr(idx, markerEnd.length) === markerEnd && (l !== searchLine || idx !== searchCh)) {
                            logDev('Stopped search for start marker: found another end marker first', { from: { line: searchLine, ch: searchCh }, at: { line: l, ch: idx } });
                            found = true;
                            break;
                        }
                    }
                    if (found) break;
                }
            }
            const atStartBoundary = from.ch <= markerStart.length && lineText.slice(0, markerStart.length).startsWith(markerStart);
            const atEndBoundary = to.ch >= lineText.length - markerEnd.length && lineText.slice(-markerEnd.length).endsWith(markerEnd);
            if (!atStartBoundary && !atEndBoundary) {
                return;
            }
        }

        if (selection && markerStart && markerEnd) {
            const lineText = editor.getLine(from.line);
            const selectionText = selection;
            let foundStart = false, foundEnd = false;
            let startIdx = selectionText.indexOf(markerStart);
            let endIdx = selectionText.indexOf(markerEnd);
            function containsPartOfMarker(sel: string, marker: string): boolean {
                if (!marker) return false;
                for (let i = 1; i <= marker.length; i++) {
                    if (sel.includes(marker.slice(0, i)) || sel.includes(marker.slice(-i))) return true;
                }
                return false;
            }
            if (!foundStart && containsPartOfMarker(selectionText, markerStart)) {
                const left = lineText.slice(Math.max(0, from.ch - markerStart.length), from.ch + selectionText.length);
                if (left.includes(markerStart)) {
                    foundStart = true;
                    startIdx = left.indexOf(markerStart) - (from.ch - Math.max(0, from.ch - markerStart.length));
                }
            }
            if (!foundEnd && containsPartOfMarker(selectionText, markerEnd)) {
                const right = lineText.slice(from.ch, Math.min(lineText.length, to.ch + markerEnd.length));
                if (right.includes(markerEnd)) {
                    foundEnd = true;
                    endIdx = right.indexOf(markerEnd);
                }
            }
            if (selectionText.includes(markerStart)) {
                foundStart = true;
                startIdx = selectionText.indexOf(markerStart);
            }
            if (selectionText.includes(markerEnd)) {
                foundEnd = true;
                endIdx = selectionText.indexOf(markerEnd);
            }
            if (markerStart === markerEnd && markerStart.length > 0 && (foundStart || foundEnd)) {
                const before = scanForFirst(allLines, from.line, from.ch, markerStart, '', 'back');
                const after = scanForFirst(allLines, to.line, to.ch, markerEnd, '', 'forward');
                if (before.type === 'marker') commentStartPos = before.pos;
                if (after.type === 'marker') commentEndPos = after.pos;
                if (commentStartPos && commentEndPos) isComment = true;
            } else if (foundStart) {
                const after = scanForFirst(allLines, to.line, to.ch, markerEnd, markerStart, 'forward');
                if (after.type === 'marker') commentEndPos = after.pos;
                const startLineIdx = from.line;
                const startChIdx = lineText.indexOf(markerStart, from.ch);
                if (startChIdx !== -1) commentStartPos = { line: startLineIdx, ch: startChIdx };
                if (commentStartPos && commentEndPos) isComment = true;
            } else if (foundEnd) {
                const before = scanForFirst(allLines, from.line, from.ch, markerStart, markerEnd, 'back');
                if (before.type === 'marker') commentStartPos = before.pos;
                const endLineIdx = to.line;
                const endChIdx = lineText.indexOf(markerEnd, from.ch);
                if (endChIdx !== -1) commentEndPos = { line: endLineIdx, ch: endChIdx };
                if (commentStartPos && commentEndPos) isComment = true;
            }
        }

        if (isComment && commentStartPos && commentEndPos) {
            let startLine = allLines[commentStartPos.line];
            const startMarkerWithSpace = markerStart + ' ';
            allLines[commentStartPos.line] = startLine.slice(0, commentStartPos.ch) + startLine.slice(commentStartPos.ch + startMarkerWithSpace.length);
            let endLineIdx = commentEndPos.line;
            let endChIdx = commentEndPos.ch;
            if (commentStartPos.line === commentEndPos.line) {
                endChIdx -= startMarkerWithSpace.length;
                let updatedLine = allLines[endLineIdx];
                const endMarkerWithSpace = ' ' + markerEnd;
                endChIdx = updatedLine.indexOf(endMarkerWithSpace, endChIdx);
                if (endChIdx === -1) {
                    endChIdx = updatedLine.indexOf(markerEnd, endChIdx);
                    if (endChIdx > 0 && updatedLine[endChIdx - 1] === ' ') {
                        endChIdx = endChIdx - 1;
                    }
                }
                if (endChIdx === -1) {
                    return;
                }
                allLines[endLineIdx] = updatedLine.slice(0, endChIdx) + updatedLine.slice(endChIdx + endMarkerWithSpace.length);
            } else {
                let endLine = allLines[endLineIdx];
                const endMarkerWithSpace = ' ' + markerEnd;
                allLines[endLineIdx] = endLine.slice(0, endChIdx) + endLine.slice(endChIdx + endMarkerWithSpace.length);
            }
            const fromLine = Math.min(commentStartPos.line, commentEndPos.line);
            const toLine = Math.max(commentStartPos.line, commentEndPos.line);
            const newText = allLines.slice(fromLine, toLine + 1).join('\n');
            editor.replaceRange(newText, { line: fromLine, ch: 0 }, { line: toLine, ch: editor.getLine(toLine).length });
            let newCursorLine = from.line;
            let newCursorCh = from.ch - startMarkerWithSpace.length;
            if (newCursorCh < 0) newCursorCh = 0;
            const lastLine = allLines.length - 1;
            if (newCursorLine > lastLine) newCursorLine = lastLine;
            let lineLen = allLines[newCursorLine]?.length ?? 0;
            if (newCursorCh > lineLen) newCursorCh = lineLen;
            let clamped = clampCursorPos({ line: newCursorLine, ch: newCursorCh });
            editor.setCursor(clamped);
            return;
        }

        let useWord = false;
        wordBounds = getWordBounds(line, cursor.ch);
        if (selection) {
            useWord = false;
        } else if (wordBounds) {
            if (cursor.ch > wordBounds.start && cursor.ch < wordBounds.end) {
                useWord = true;
            } else if (this.settings.wordOnlyMode && (cursor.ch === wordBounds.start || cursor.ch === wordBounds.end)) {
                useWord = true;
            } else {
                useWord = false;
            }
        }
        logDev('Mode:', selection ? 'selection' : useWord ? 'word' : 'insert', { selection, wordBounds, useWord });
        if (selection) {
            text = selection;
        } else if (useWord && wordBounds) {
            text = line.slice(wordBounds.start, wordBounds.end);
            from = { line: cursor.line, ch: wordBounds.start };
            to = { line: cursor.line, ch: wordBounds.end };
        } else {
            text = '';
            from = { line: cursor.line, ch: cursor.ch };
            to = { line: cursor.line, ch: cursor.ch };
        }
        let removalUsedStart = markerStart;
        let removalUsedEnd = markerEnd;
        let removalInside = false;
        let removalCheckText = text;
        if (selection) {
            if (removalUsedStart && removalUsedEnd && selection.startsWith(removalUsedStart) && selection.endsWith(removalUsedEnd)) {
                removalInside = true;
                removalCheckText = selection;
            } else {
                for (const style of defaultStyles) {
                    if (style.start && style.end && selection.startsWith(style.start) && selection.endsWith(style.end)) {
                        removalUsedStart = style.start;
                        removalUsedEnd = style.end;
                        removalInside = true;
                        removalCheckText = selection;
                        break;
                    }
                }
            }
            if (!removalInside) {
                const lineStart = editor.getLine(from.line);
                const lineEnd = editor.getLine(to.line);
                if (removalUsedStart && removalUsedEnd && lineStart.startsWith(removalUsedStart) && lineEnd.endsWith(removalUsedEnd)) {
                    removalInside = true;
                    removalCheckText = editor.getRange({ line: from.line, ch: 0 }, { line: to.line, ch: editor.getLine(to.line).length });
                } else {
                    for (const style of defaultStyles) {
                        if (style.start && style.end && lineStart.startsWith(style.start) && lineEnd.endsWith(style.end)) {
                            removalUsedStart = style.start;
                            removalUsedEnd = style.end;
                            removalInside = true;
                            removalCheckText = editor.getRange({ line: from.line, ch: 0 }, { line: to.line, ch: editor.getLine(to.line).length });
                            break;
                        }
                    }
                }
            }
        } else if (useWord && wordBounds) {
            if (removalUsedStart && removalUsedEnd && line.startsWith(removalUsedStart) && line.endsWith(removalUsedEnd)) {
                removalInside = true;
                removalCheckText = line;
            } else {
                for (const style of defaultStyles) {
                    if (style.start && style.end && line.startsWith(style.start) && line.endsWith(style.end)) {
                        removalUsedStart = style.start;
                        removalUsedEnd = style.end;
                        removalInside = true;
                        removalCheckText = line;
                        break;
                    }
                }
            }
            if (!removalInside && removalUsedStart && removalUsedEnd && text.startsWith(removalUsedStart) && text.endsWith(removalUsedEnd)) {
                removalInside = true;
                removalCheckText = text;
            } else if (!removalInside) {
                for (const style of defaultStyles) {
                    if (style.start && style.end && text.startsWith(style.start) && text.endsWith(style.end)) {
                        removalUsedStart = style.start;
                        removalUsedEnd = style.end;
                        removalInside = true;
                        removalCheckText = text;
                        break;
                    }
                }
            }
        } else {
            if (removalUsedStart && removalUsedEnd && line.startsWith(removalUsedStart) && line.endsWith(removalUsedEnd)) {
                removalInside = true;
                removalCheckText = line;
            } else {
                for (const style of defaultStyles) {
                    if (style.start && style.end && line.startsWith(style.start) && line.endsWith(style.end)) {
                        removalUsedStart = style.start;
                        removalUsedEnd = style.end;
                        removalInside = true;
                        removalCheckText = line;
                        break;
                    }
                }
            }
        }
        function removeNearestMarkersFromWordOrSelection(text: string, start: string, end: string, selectionStart: number, selectionEnd: number): { result: string, newStart: number, newEnd: number } {
            return { result: text, newStart: selectionStart, newEnd: selectionEnd };
        }
        if (removalInside) {
            if (selection && removalUsedStart && removalCheckText === removalUsedStart) {
                const lineText = editor.getLine(from.line);
                const startIdx = lineText.indexOf(removalUsedStart);
                const endIdx = removalUsedEnd ? lineText.indexOf(removalUsedEnd, startIdx + removalUsedStart.length) : -1;
                if (endIdx !== -1) {
                    const between = lineText.slice(startIdx + removalUsedStart.length, endIdx);
                    if (/^\s*$/.test(between)) {
                        logDev('Deleting end marker after deleting start marker', { line: from.line, startIdx, endIdx, removalUsedStart, removalUsedEnd });
                        const before = lineText.slice(0, startIdx);
                        const after = lineText.slice(endIdx + removalUsedEnd.length);
                        editor.setLine(from.line, before + after);
                        editor.setCursor({ line: from.line, ch: startIdx });
                        return;
                    }
                }
            }
            return;
        }
        let usedStart = markerStart;
        let usedEnd = markerEnd;
        let inside = false;
        let checkText = text;
        if (selection) {
            checkText = text;
        } else if (useWord && wordBounds) {
            checkText = line.slice(wordBounds.start, wordBounds.end);
        } else {
            checkText = text;
        }
        if (usedStart && isTextCommentedExact(checkText, usedStart, usedEnd)) {
            inside = true;
        } else {
            for (const style of defaultStyles) {
                if (style.start && isTextCommentedExact(checkText, style.start, style.end)) {
                    usedStart = style.start;
                    usedEnd = style.end;
                    inside = true;
                    break;
                }
            }
        }
        function buildCommented(text: string) {
            return markerStart + ' ' + text + ' ' + markerEnd;
        }
        function stripCommented(str: string) {
            const start = markerStart + ' ';
            const end = ' ' + markerEnd;
            if (str.startsWith(start) && str.endsWith(end)) {
                return str.slice(start.length, str.length - end.length);
            }
            if (str.startsWith(markerStart) && str.endsWith(markerEnd)) {
                return str.slice(markerStart.length, str.length - markerEnd.length).trim();
            }
            return null;
        }
        let uncommented = null;
        if (selection) {
            uncommented = stripCommented(text);
            if (uncommented !== null) inside = true;
        } else if (useWord && wordBounds) {
            const wordText = line.slice(wordBounds.start, wordBounds.end);
            uncommented = stripCommented(wordText);
            if (uncommented !== null) inside = true;
        } else {
            uncommented = stripCommented(text);
            if (uncommented !== null) inside = true;
        }
        if (inside) {
            const safeUncommented = uncommented !== null ? uncommented : text;
            if (selection) {
                editor.replaceSelection(safeUncommented);
                const selFrom = clampCursorPos(from);
                const selTo = clampCursorPos({ line: to.line, ch: from.ch + safeUncommented.length });
                editor.setSelection(selFrom, selTo);
            } else if (useWord && wordBounds) {
                editor.replaceRange(safeUncommented, { line: cursor.line, ch: wordBounds.start }, { line: cursor.line, ch: wordBounds.end });
                const newCh = wordBounds.start + safeUncommented.length;
                const clamped = clampCursorPos({ line: cursor.line, ch: newCh });
                editor.setCursor(clamped);
            } else {
                editor.replaceRange(safeUncommented, { line: cursor.line, ch: cursor.ch }, { line: cursor.line, ch: cursor.ch });
                const clamped = clampCursorPos({ line: cursor.line, ch: cursor.ch });
                editor.setCursor(clamped);
            }
        } else {
            let trimmedText = text.trim();
            let commented: string;
            if (!selection && !trimmedText) {
                commented = markerStart + '  ' + markerEnd;
            } else {
                commented = buildCommented(trimmedText);
            }
            if (!selection && !trimmedText) {
                editor.replaceRange(commented, { line: cursor.line, ch: cursor.ch }, { line: cursor.line, ch: cursor.ch });
                const cursorPos = cursor.ch + (markerStart + ' ').length;
                const clamped = clampCursorPos({ line: cursor.line, ch: cursorPos });
                editor.setCursor(clamped);
            } else if (selection) {
                editor.replaceSelection(commented);
                const startOffset = (markerStart + ' ').length;
                const selFrom = clampCursorPos({ line: from.line, ch: from.ch + startOffset });
                const selTo = clampCursorPos({ line: to.line, ch: from.ch + startOffset + trimmedText.length });
                editor.setSelection(selFrom, selTo);
            } else if (useWord && wordBounds) {
                editor.replaceRange(commented, { line: cursor.line, ch: wordBounds.start }, { line: cursor.line, ch: wordBounds.end });
                const newCh = wordBounds.start + (markerStart + ' ').length;
                const clamped = clampCursorPos({ line: cursor.line, ch: newCh });
                editor.setCursor(clamped);
            } else {
                editor.replaceRange(commented, { line: cursor.line, ch: cursor.ch }, { line: cursor.line, ch: cursor.ch });
                const clamped = clampCursorPos({ line: cursor.line, ch: cursor.ch + (markerStart + ' ').length });
                editor.setCursor(clamped);
            }
        }
        const finalCursor = clampCursorPos(editor.getCursor());
        if (finalCursor.line !== editor.getCursor().line || finalCursor.ch !== editor.getCursor().ch) {
            editor.setCursor(finalCursor);
        }
    }

    /**
     * Toggles the comment if the cursor is within a comment marked by the custom markers.
     * If the cursor/selection is inside a comment, removes the markers. Otherwise, does nothing.
     */
    toggleCommentAtCursor(editor: Editor) {
        const template = this.settings.template;
        const cursorIndex = template.indexOf("{cursor}");
        let before = template;
        let after = "";
        if (cursorIndex !== -1) {
            before = template.slice(0, cursorIndex);
            after = template.slice(cursorIndex + "{cursor}".length);
        }
        const markerStart = before.trim();
        const markerEnd = after.trim();

        const cursor = editor.getCursor();
        let line = editor.getLine(cursor.line);
        let startIdx = line.indexOf(markerStart);
        let endIdx = markerEnd ? line.lastIndexOf(markerEnd) : -1;
        let isInside = false;
        if (markerStart && markerEnd) {
            isInside = startIdx !== -1 && endIdx !== -1 && cursor.ch >= startIdx + markerStart.length && cursor.ch <= endIdx;
        } else if (markerStart) {
            isInside = startIdx !== -1 && cursor.ch >= startIdx + markerStart.length;
        }
        if (isInside) {
            let uncommented = line;
            if (markerStart) {
                uncommented = uncommented.replace(markerStart, "");
            }
            if (markerEnd) {
                uncommented = uncommented.replace(markerEnd, "");
            }
            uncommented = uncommented.trim();
            editor.setLine(cursor.line, uncommented);
        }
    }
}