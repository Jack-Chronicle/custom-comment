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
import { StateField, StateEffect } from '@codemirror/state';
// @ts-ignore
import { RangeSetBuilder } from '@codemirror/state';

// DEV logging utility: only logs if __DEV__ is true (set by esbuild)
declare const __DEV__: boolean;
function logDev(...args: any[]) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
        // eslint-disable-next-line no-console
        console.log('[CustomComment DEV]', ...args);
    }
}

// Default styles for fallback removal
const defaultStyles = [
    { start: "%%", end: "%%" },
    { start: "<!--", end: "-->" },
    { start: "//", end: "" },
];

export default class CommentFormatPlugin extends Plugin {
    /**
     * Plugin settings, loaded on initialization.
     */
    settings!: CommentFormatSettings & { wordOnlyMode?: boolean };
    private _markerCommandIds: string[] = [];

    async onload() {
        await this.loadSettings();
        this.addSettingTab(new CommentFormatSettingTab(this.app, this));

        // Register the reload marker commands command
        this.addCommand({
            id: "reload-marker-commands",
            name: "Reload Marker Commands",
            callback: () => this.registerMarkerCommands(true)
        });

        // Register all marker commands (main + enabled additional marker sets)
        this.registerMarkerCommands();
        // Post processor removed as requested.
    }

    /**
     * Register all marker commands (main + enabled additional marker sets). If force is true, re-registers all.
     */
    registerMarkerCommands(force = false) {
        // Remove previously registered marker commands if force is true
        if (force && this._markerCommandIds) {
            // Do NOT remove commands dynamically; just clear our tracking array
            this._markerCommandIds = [];
        }
        this._markerCommandIds = [];

        // Main command: always present, always visible, always named 'Toggle Comment: (%%|%%)'
        const mainTemplate = this.settings.template ?? "%% {cursor} %%";
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

        // Only register marker commands for marker sets that exist and are enabled
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
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
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
    }

    insertComment(editor: Editor) {
        const template = this.settings.template;
        const cursorIndex = template.indexOf("{cursor}");

        if (cursorIndex === -1) {
            // Fallback: insert template and move cursor to start
            editor.replaceSelection(template);
            return;
        }

        // Remove {cursor} and track where it was
        const before = template.slice(0, cursorIndex);
        const after = template.slice(cursorIndex + "{cursor}".length);

        const from = editor.getCursor();
        editor.replaceSelection(before + after);

        // Calculate the new cursor position
        const lines = before.split("\n");
        const cursorLineOffset = lines.length - 1;
        const cursorChOffset = lines[lines.length - 1].length;

        editor.setCursor({
            line: from.line + cursorLineOffset,
            ch: (cursorLineOffset ? 0 : from.ch) + cursorChOffset
        });
    }

    /**
     * Toggle comment using a specific marker set, or the default template if none provided.
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
        if (markerSet) {
            markerStart = markerSet.start;
            markerEnd = markerSet.end;
        } else {
            const template = this.settings.template;
            const cursorIndex = template.indexOf("{cursor}");
            let before = template;
            let after = "";
            if (cursorIndex !== -1) {
                before = template.slice(0, cursorIndex);
                after = template.slice(cursorIndex + "{cursor}".length);
            }
            markerStart = before;
            markerEnd = after;
        }
        const selection = editor.getSelection();
        const cursor = editor.getCursor();
        let text: string;
        let from = editor.getCursor("from");
        let to = editor.getCursor("to");
        let wordBounds: { start: number, end: number } | null = null;
        let line = editor.getLine(cursor.line);
        // Helper to find word bounds at a given ch, ignoring punctuation
        function getWordBounds(line: string, ch: number): { start: number, end: number } | null {
            // Only match sequences of letters, numbers, or underscores (ignore punctuation)
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
        // Utility: Scan lines in a direction for a marker, stopping if the opposite marker is found first
        function scanForFirst(lines: string[], fromLine: number, fromCh: number, marker: string, opposite: string, direction: 'back' | 'forward'): { type: 'marker' | 'opposite' | null, pos: { line: number, ch: number } | null } {
            // Remove leading/trailing whitespace for marker matching
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
        // Main logic for comment detection
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
        // Log with 1-based line/ch for user clarity
        logDev('comment:', isComment, {
            start: commentStartPos ? { line: commentStartPos.line + 1, ch: commentStartPos.ch + 1 } : null,
            end: commentEndPos ? { line: commentEndPos.line + 1, ch: commentEndPos.ch + 1 } : null
        });
        // If isComment is true, remove the detected markers
        if (isComment && commentStartPos && commentEndPos) {
            // Remove start marker (match full marker, not trimmed)
            let startLine = allLines[commentStartPos.line];
            allLines[commentStartPos.line] = startLine.slice(0, commentStartPos.ch) + startLine.slice(commentStartPos.ch + markerStart.length);
            // Adjust end marker position if on same line as start
            let endLineIdx = commentEndPos.line;
            let endChIdx = commentEndPos.ch;
            if (commentStartPos.line === commentEndPos.line) {
                endChIdx -= markerStart.length;
            }
            // Remove end marker (match full marker, not trimmed)
            let endLine = allLines[endLineIdx];
            // Remove any single space immediately before the end marker (to avoid trailing space)
            let spaceAdjust = 0;
            if (endChIdx > 0 && endLine[endChIdx - 1] === ' ') {
                endChIdx--;
                spaceAdjust = 1;
            }
            allLines[endLineIdx] = endLine.slice(0, endChIdx) + endLine.slice(endChIdx + markerEnd.length);
            // Replace the affected lines in the editor
            const fromLine = Math.min(commentStartPos.line, commentEndPos.line);
            const toLine = Math.max(commentStartPos.line, commentEndPos.line);
            const newText = allLines.slice(fromLine, toLine + 1).join('\n');
            editor.replaceRange(newText, { line: fromLine, ch: 0 }, { line: toLine, ch: editor.getLine(toLine).length });
            // Adjust cursor position: keep it at the same logical place after removing start marker
            let newCursorLine = from.line;
            let newCursorCh = from.ch - markerStart.length;
            if (newCursorCh < 0) newCursorCh = 0;
            // If cursor would be outside the document, clamp to end
            const lastLine = allLines.length - 1;
            if (newCursorLine > lastLine) newCursorLine = lastLine;
            let lineLen = allLines[newCursorLine]?.length ?? 0;
            if (newCursorCh > lineLen) newCursorCh = lineLen;
            // If the calculated line/ch is outside the document, set to very end
            let clamped = clampCursorPos({ line: newCursorLine, ch: newCursorCh });
            editor.setCursor(clamped);
            return;
        }
        // Decide word or insert-at-cursor mode
        let useWord = false;
        wordBounds = getWordBounds(line, cursor.ch);
        if (selection) {
            useWord = false;
        } else if (wordBounds) {
            // Cursor is inside a word
            if (cursor.ch > wordBounds.start && cursor.ch < wordBounds.end) {
                // Always operate on the word if cursor is inside the word (not at boundary)
                useWord = true;
            } else if (this.settings.wordOnlyMode && (cursor.ch === wordBounds.start || cursor.ch === wordBounds.end)) {
                // Only operate on the word at boundary if wordOnlyMode is enabled
                useWord = true;
            } else {
                // At word boundary and wordOnlyMode is off: insert at cursor
                useWord = false;
            }
        }
        logDev('Mode:', selection ? 'selection' : useWord ? 'word' : 'insert', { selection, wordBounds, useWord });
        // Determine text and range
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
        // Remove block comment logic (findBlockCommentBounds) as it is not needed for the new comment detection
        // Check if selection or word/line is inside a comment (custom or default)
        // --- Removal takes priority ---
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
        // Remove the nearest comment markers before/after the word or selection
        function removeNearestMarkersFromWordOrSelection(text: string, start: string, end: string, selectionStart: number, selectionEnd: number): { result: string, newStart: number, newEnd: number } {
            // No-op: marker removal logic removed as requested
            return { result: text, newStart: selectionStart, newEnd: selectionEnd };
        }
        if (removalInside) {
            // No-op: skip marker removal entirely
            return;
        }
        // Check if text/word/selection is commented
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
        if (inside) {
            logDev('Removing exact comment markers', { usedStart, usedEnd, checkText });
            // Remove comment markers (exact, not trimmed)
            let uncommented = checkText;
            let removedStartLen = 0;
            if (usedStart && uncommented.startsWith(usedStart)) {
                removedStartLen = usedStart.length;
                uncommented = uncommented.slice(usedStart.length);
            }
            if (usedEnd && uncommented.endsWith(usedEnd)) {
                uncommented = uncommented.slice(0, -usedEnd.length);
            }
            if (selection) {
                editor.replaceSelection(uncommented);
                const selFrom = clampCursorPos(from);
                const selTo = clampCursorPos({ line: to.line, ch: to.ch - removedStartLen });
                editor.setSelection(selFrom, selTo);
            } else if (useWord && wordBounds) {
                editor.replaceRange(uncommented, { line: cursor.line, ch: wordBounds.start }, { line: cursor.line, ch: wordBounds.end });
                const newCh = Math.max(wordBounds.start, cursor.ch - removedStartLen);
                const clamped = clampCursorPos({ line: cursor.line, ch: newCh });
                editor.setCursor(clamped);
            } else {
                editor.replaceRange(uncommented, { line: cursor.line, ch: cursor.ch }, { line: cursor.line, ch: cursor.ch });
                const clamped = clampCursorPos({ line: cursor.line, ch: cursor.ch });
                editor.setCursor(clamped);
            }
        } else {
            logDev('Adding comment markers', { markerStart, markerEnd, text });
            // Add comment markers, preserving template spaces
            let commented = markerStart + text + markerEnd;
            if (selection) {
                editor.replaceSelection(commented);
                const startOffset = markerStart.length;
                const selFrom = clampCursorPos({ line: from.line, ch: from.ch + startOffset });
                const selTo = clampCursorPos({ line: to.line, ch: to.ch + startOffset });
                editor.setSelection(selFrom, selTo);
            } else if (useWord && wordBounds) {
                editor.replaceRange(commented, { line: cursor.line, ch: wordBounds.start }, { line: cursor.line, ch: wordBounds.end });
                const newCh = cursor.ch + markerStart.length;
                const clamped = clampCursorPos({ line: cursor.line, ch: newCh });
                editor.setCursor(clamped);
            } else {
                // Insert at cursor
                editor.replaceRange(commented, { line: cursor.line, ch: cursor.ch }, { line: cursor.line, ch: cursor.ch });
                const clamped = clampCursorPos({ line: cursor.line, ch: cursor.ch + markerStart.length });
                editor.setCursor(clamped);
            }
        }
        // After inserting, clamp cursor to end of document if needed
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
            // Remove markers from the line
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