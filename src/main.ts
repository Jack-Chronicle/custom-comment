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

import { normalize } from './utils/normalize';
import { findMarkerInText } from './utils/findMarkerInText';
import { confirmPartialMarker } from './utils/confirmPartialMarker';
import { searchMarkerInLine } from './utils/searchMarkerInLine';
import { isRegionCommented } from './utils/isRegionCommented';
import { detectFallback } from './utils/detectFallback';
import { getWordBounds } from './utils/getWordBounds';
import { getSelectionRange } from './utils/getSelectionRange';

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

        this.registerMarkerCommands();
        // Register mobile toolbar command for main toggle
        let toolbarTemplate = this.settings.template ?? "%% {cursor} %%";
        const toolbarCursorIndex = toolbarTemplate.indexOf("{cursor}");
        let toolbarBefore = "%%";
        let toolbarAfter = "%%";
        if (toolbarCursorIndex !== -1) {
            toolbarBefore = toolbarTemplate.slice(0, toolbarCursorIndex).trim() || "%%";
            toolbarAfter = toolbarTemplate.slice(toolbarCursorIndex + "{cursor}".length).trim() || "%%";
        }
        // Compose the label with spaces and a '|' for the cursor
        const toolbarLabel = `${toolbarBefore}${toolbarBefore ? ' ' : ''}|${toolbarAfter ? ' ' : ''}${toolbarAfter}`.trim();
        this.addCommand({
            id: "toggle-comment-toolbar",
            name: `Toggle comment: (${toolbarLabel})`,
            editorCallback: (editor: Editor) => this.toggleComment(editor),
            icon: "ampersands",
            mobileOnly: false
        });
    }

    /**
     * Registers all marker commands (main + enabled additional marker sets).
     */
    registerMarkerCommands() {
        // Remove all previously registered marker commands
        if (Array.isArray(this._markerCommandIds)) {
            for (const id of this._markerCommandIds) {
                this.removeCommand?.(id);
            }
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

        // Register additional marker commands if enabled
        if (Array.isArray(this.settings.additionalMarkers)) {
            this.settings.additionalMarkers.forEach((marker, i) => {
                const id = `toggle-comment-marker-set-${i + 1}`;
                if (marker && marker.registerCommand) {
                    // Always pass a normalized marker set to toggleComment
                    const normalizedMarker = {
                        start: marker.start?.trim() || "%%",
                        end: marker.end?.trim() || "%%"
                    };
                    this.addCommand({
                        id,
                        name: (() => {
                            const start = normalizedMarker.start;
                            const end = normalizedMarker.end;
                            return `Toggle marker ${i + 1}: (${start}|${end})`;
                        })(),
                        editorCallback: (editor: Editor) => this.toggleComment(editor, normalizedMarker)
                    });
                    this._markerCommandIds.push(id);
                } else {
                    // If command exists but should not, ensure it is removed
                    this.removeCommand?.(id);
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

        // 1. Marker Extraction and Normalization
        let markerStart: string, markerEnd: string;
        if (markerSet) {
            markerStart = markerSet.start.trim();
            markerEnd = markerSet.end.trim();
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
        }
        const normStart = normalize(markerStart);
        const normEnd = normalize(markerEnd);

        // 3.1 Marker Search in Selection
        // --- Advanced Partial Marker Detection ---
        // --- Helper: Search for marker in line in a direction ---

        // 2. Efficient Comment Detection
        // fallback style detection

        let wordOnlyMode = this.settings.wordOnlyMode;
        // 3. Mode Decision
        const { from, to, selection } = getSelectionRange(editor);
        const cursor = editor.getCursor();
        let line = editor.getLine(cursor.line);
        let text: string;
        let wordBounds: { start: number, end: number } | null = null;
        // --- Word-only mode for selections ---
        let adjustedFrom = { ...from };
        let adjustedTo = { ...to };
        if (wordOnlyMode && selection && from.line === to.line) {
            const selLine = editor.getLine(from.line);
            // Get word bounds at selection start
            const startWord = getWordBounds(selLine, from.ch);
            if (startWord && from.ch > startWord.start && from.ch < startWord.end) {
                adjustedFrom.ch = startWord.start;
            }
            // Get word bounds at selection end (exclusive)
            const endWord = getWordBounds(selLine, to.ch > 0 ? to.ch - 1 : to.ch);
            if (endWord && to.ch > endWord.start && to.ch < endWord.end) {
                adjustedTo.ch = endWord.end;
            }
            // If selection is entirely within a single word, both will be the same
        }
        if (selection) {
            text = selection;
        } else {
            wordBounds = getWordBounds(line, cursor.ch);
            // Only use word bounds if wordOnlyMode is enabled
            if (wordOnlyMode && wordBounds && cursor.ch >= wordBounds.start && cursor.ch <= wordBounds.end) {
                text = line.slice(wordBounds.start, wordBounds.end);
                from.line = cursor.line; from.ch = wordBounds.start;
                to.line = cursor.line; to.ch = wordBounds.end;
            } else {
                text = '';
                // from and to already set to cursor position
            }
        }

        // Calculate offset in word if cursor is at start, inside, or end of word and wordOnlyMode is enabled
        let offsetInWord = null;
        if (wordOnlyMode && !selection && wordBounds && cursor.ch >= wordBounds.start && cursor.ch <= wordBounds.end) {
            offsetInWord = cursor.ch - wordBounds.start;
        }

        // 4. Comment Region Detection
        let startIdx = -1, endIdx = -1;
        let region = '', regionIsComment = false;
        let usedStart = normStart, usedEnd = normEnd;
        let uniqueMarkers = Boolean(usedStart && usedEnd && usedStart !== usedEnd);
        // --- Detection Logging ---
        logDev('[Detection] selection:', selection);
        logDev('[Detection] text:', text);
        const foundStart = findMarkerInText(normStart, text);
        const foundEnd = findMarkerInText(normEnd, text);
        logDev('[Detection] foundStart:', foundStart);
        logDev('[Detection] foundEnd:', foundEnd);
        // Always run toggling logic, even for just a cursor
        // Find all start and end marker positions in the entire document
        const markerStarts = [];
        const markerEnds = [];
        const lineCount = editor.lineCount();
        for (let i = 0; i < lineCount; i++) {
            const lineText = editor.getLine(i);
            let idx = 0;
            while ((idx = lineText.indexOf(normStart, idx)) !== -1) {
                markerStarts.push({ line: i, ch: idx });
                idx += normStart.length;
            }
            idx = 0;
            while ((idx = lineText.indexOf(normEnd, idx)) !== -1) {
                markerEnds.push({ line: i, ch: idx });
                idx += normEnd.length;
            }
        }
        // Find the marker pair that encompasses the selection (fully or partially overlaps)
        let pairToRemove = null;
        // Use stack to ensure correct matching of start/end pairs
        const stack: { line: number, ch: number }[] = [];
        for (let i = 0, s = 0, e = 0; i < markerStarts.length + markerEnds.length;) {
            let nextStart = s < markerStarts.length ? markerStarts[s] : null;
            let nextEnd = e < markerEnds.length ? markerEnds[e] : null;
            let isStart = false;
            if (nextStart && (!nextEnd || nextStart.line < nextEnd.line || (nextStart.line === nextEnd.line && nextStart.ch < nextEnd.ch))) {
                stack.push(nextStart);
                s++;
                isStart = true;
            } else if (nextEnd) {
                if (stack.length > 0) {
                    const start = stack.pop();
                    if (start) { // Type guard for start
                        const end = nextEnd;
                        // Marker region
                        const markerRegionStart = { line: start.line, ch: start.ch };
                        const markerRegionEnd = { line: end.line, ch: end.ch + normEnd.length };
                        // Selection must be fully or partially within the marker region (overlap)
                        const selStart = from;
                        const selEnd = to;
                        const selectionWithinMarker =
                            (selStart.line < markerRegionEnd.line || (selStart.line === markerRegionEnd.line && selStart.ch < markerRegionEnd.ch)) &&
                            (selEnd.line > markerRegionStart.line || (selEnd.line === markerRegionStart.line && selEnd.ch > markerRegionStart.ch));
                        const selectionCompletelyBefore =
                            (selEnd.line < markerRegionStart.line) ||
                            (selEnd.line === markerRegionStart.line && selEnd.ch <= markerRegionStart.ch);
                        const selectionCompletelyAfter =
                            (selStart.line > markerRegionEnd.line) ||
                            (selStart.line === markerRegionEnd.line && selStart.ch >= markerRegionEnd.ch);
                        if (selectionWithinMarker && !selectionCompletelyBefore && !selectionCompletelyAfter) {
                            pairToRemove = { start, end };
                            break;
                        }
                    }
                }
                e++;
            } else {
                break;
            }
        }
        if (pairToRemove) {
            // Remove the marker pair in a single transaction so undo restores both
            const { start, end } = pairToRemove;
            let startSpace = 0;
            const startLineText = editor.getLine(start.line);
            if (startLineText[start.ch + normStart.length] === ' ') {
                startSpace = 1;
            }
            let endSpace = 0;
            const endLineText = editor.getLine(end.line);
            if (end.ch > 0 && endLineText[end.ch - 1] === ' ') {
                endSpace = 1;
            }
            // Count all marker removals before selection start/end on their lines
            let removedBeforeStart = 0;
            let removedBeforeEnd = 0;
            // Check start marker on selection start line
            if (start.line === from.line && start.ch < from.ch) {
                removedBeforeStart += normStart.length + startSpace;
            }
            // Check end marker on selection start line (rare, but possible)
            if (end.line === from.line && end.ch < from.ch) {
                removedBeforeStart += normEnd.length + endSpace;
            }
            // Check start marker on selection end line
            if (start.line === to.line && start.ch < to.ch) {
                removedBeforeEnd += normStart.length + startSpace;
            }
            // Check end marker on selection end line
            if (end.line === to.line && end.ch < to.ch) {
                removedBeforeEnd += normEnd.length + endSpace;
            }
            editor.transaction({
                changes: [
                    { from: { line: end.line, ch: end.ch - endSpace }, to: { line: end.line, ch: end.ch + normEnd.length }, text: '' },
                    { from: { line: start.line, ch: start.ch }, to: { line: start.line, ch: start.ch + normStart.length + startSpace }, text: '' }
                ]
            });
            // Adjust selection or cursor
            let selFrom = { ...from };
            let selTo = { ...to };
            if (removedBeforeStart && selFrom.line === from.line) {
                selFrom.ch = Math.max(0, selFrom.ch - removedBeforeStart);
            }
            if (removedBeforeEnd && selTo.line === to.line) {
                selTo.ch = Math.max(selFrom.ch, selTo.ch - removedBeforeEnd);
            }
            logDev('Uncommented marker pair encompassing selection', { from, to, pairToRemove, removedBeforeStart, removedBeforeEnd, selFrom, selTo });
            // If just a cursor or word under cursor, set cursor (no selection), else set selection
            if ((from.line === to.line && from.ch === to.ch) || (wordBounds && from.line === to.line && from.ch === wordBounds?.start && to.ch === wordBounds?.end)) {
                // Place cursor at original offset within the word/text, accounting for removed chars before cursor
                let cursorCh;
                if (offsetInWord !== null && wordBounds) {
                    // Place at same offset in word after uncommenting
                    cursorCh = wordBounds.start + offsetInWord - (removedBeforeStart || 0);
                } else {
                    cursorCh = from.ch - (removedBeforeStart || 0);
                }
                editor.setCursor({ line: from.line, ch: Math.max(0, cursorCh) });
            } else {
                editor.setSelection(selFrom, selTo);
            }
            return;
        }
        // If no marker pair was found, wrap the selection or cursor in a comment and return
        if (wordOnlyMode && selection) {
            // --- Word-only mode for selections ---
            // Find word bounds for selection start and end
            const startLine = editor.getLine(from.line);
            const endLine = editor.getLine(to.line);
            let wordStart = from.ch;
            let wordEnd = to.ch;
            // Only adjust if inside a word
            const startWord = getWordBounds(startLine, from.ch);
            if (startWord && from.ch > startWord.start && from.ch < startWord.end) {
                wordStart = startWord.start;
            }
            const endWord = getWordBounds(endLine, to.ch > 0 ? to.ch - 1 : to.ch);
            if (endWord && to.ch > endWord.start && to.ch < endWord.end) {
                wordEnd = endWord.end;
            }
            // If selection is across multiple lines, only adjust on first/last line
            const markerFrom = { line: from.line, ch: wordStart };
            const markerTo = { line: to.line, ch: wordEnd };
            // Insert end marker first (so it doesn't affect start offset)
            editor.replaceRange(' ' + normEnd, markerTo);
            editor.replaceRange(normStart + ' ', markerFrom);
            // Calculate how much the selection should be shifted
            const startMarkerLen = normStart.length + 1;
            // The selection should remain at the same offset within the word(s)
            // So, shift both from and to forward by startMarkerLen if they are after markerFrom
            let selFrom = { ...from };
            let selTo = { ...to };
            if (from.line === markerFrom.line && from.ch >= markerFrom.ch) {
                selFrom.ch += startMarkerLen;
            }
            if (to.line === markerFrom.line && to.ch >= markerFrom.ch) {
                selTo.ch += startMarkerLen;
            }
            editor.setSelection(selFrom, selTo);
            logDev('Commented region (word-only mode)', { from, to, markerFrom, markerTo });
            return;
        }
        // Use adjustedFrom/adjustedTo for word-only mode selection
        const selText = editor.getRange(adjustedFrom, adjustedTo);
        // Always add a space after start and before end, even for cursor only
        const commented = normStart + ' ' + selText + ' ' + normEnd;
        editor.replaceRange(commented, adjustedFrom, adjustedTo);
        const startMarkerLen = normStart.length + 1; // +1 for space after start
        if (!selection && (from.line === to.line && from.ch === to.ch) || (wordBounds && from.line === to.line && from.ch === wordBounds?.start && to.ch === wordBounds?.end)) {
            // Cursor only or word under cursor: place cursor at same offset in word as before
            let cursorCh;
            if (offsetInWord !== null) {
                cursorCh = from.ch + startMarkerLen + offsetInWord;
            } else {
                cursorCh = from.ch + startMarkerLen;
            }
            editor.setCursor({ line: from.line, ch: cursorCh });
        } else if (selection && wordOnlyMode && from.line === to.line) {
            // Selection in word-only mode: preserve selection's relative position
            const relStart = from.ch - adjustedFrom.ch;
            const relEnd = to.ch - adjustedFrom.ch;
            const selFrom = { line: from.line, ch: adjustedFrom.ch + startMarkerLen + relStart };
            const selTo = { line: to.line, ch: adjustedFrom.ch + startMarkerLen + relEnd };
            editor.setSelection(selFrom, selTo);
        } else {
            // Selection: select the commented region
            const selFrom = { line: adjustedFrom.line, ch: adjustedFrom.ch + startMarkerLen };
            let selTo;
            if (adjustedFrom.line === adjustedTo.line) {
                selTo = { line: adjustedTo.line, ch: adjustedTo.ch + startMarkerLen };
            } else {
                selTo = { line: adjustedTo.line, ch: adjustedTo.ch };
            }
            editor.setSelection(selFrom, selTo);
        }
        logDev('Commented region (no marker pair found)', { from, to, adjustedFrom, adjustedTo, commented });
        return;

        // 5. Toggle Logic
        if (regionIsComment) {
            let beforeRegion = line.slice(0, startIdx);
            let afterRegion = line.slice((usedEnd && endIdx !== -1 ? endIdx + usedEnd.length : line.length));
            let startMarkerExtra = 0;
            if (region.startsWith(' ')) {
                region = region.slice(1);
                startMarkerExtra = 1;
            }
            let endMarkerExtra = 0;
            if (region.endsWith(' ')) {
                region = region.slice(0, -1);
                endMarkerExtra = 1;
            }
            let newLine = beforeRegion + region + afterRegion;
            editor.setLine(cursor.line, newLine);
            if (selection) {
                let selFromCh = from.ch;
                let selToCh = to.ch;
                if (from.ch <= startIdx + usedStart.length + startMarkerExtra) {
                    selFromCh = startIdx;
                } else {
                    selFromCh = from.ch - usedStart.length + startMarkerExtra;
                }
                if (usedEnd && endIdx !== -1 && to.ch >= endIdx) {
                    selToCh = startIdx + region.length;
                } else {
                    selToCh = to.ch - usedStart.length + startMarkerExtra;
                }
                selFromCh = Math.max(0, selFromCh);
                selToCh = Math.max(selFromCh, selToCh);
                const selFrom = { line: cursor.line, ch: selFromCh };
                const selTo = { line: cursor.line, ch: selToCh };
                editor.setSelection(selFrom, selTo);
                logDev('Uncommented region', { from, to, region });
            } else {
                return;
            }
        } else {
            if (selection) {
                const selText = editor.getRange(from, to);
                const commented = usedStart + (selText ? ' ' : '') + selText + (selText ? ' ' : '') + usedEnd;
                editor.replaceRange(commented, from, to);
                const startMarkerLen = usedStart.length + (selText ? 1 : 0);
                const endMarkerLen = usedEnd.length + (selText ? 1 : 0);
                const selFrom = { line: from.line, ch: from.ch + startMarkerLen };
                let selTo;
                if (from.line === to.line) {
                    selTo = { line: to.line, ch: to.ch + startMarkerLen };
                } else {
                    selTo = { line: to.line, ch: to.ch };
                }
                editor.setSelection(selFrom, selTo);
                logDev('Commented region', { from, to, commented });
            } else {
                return;
            }
        }

        function clampCursorPos(pos: { line: number, ch: number }): { line: number, ch: number } {
            const allLines = editor.getValue().split('\n');
            let line = Math.max(0, Math.min(pos.line, allLines.length - 1));
            let ch = Math.max(0, Math.min(pos.ch, allLines[line]?.length ?? 0));
            return { line, ch };
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
            isInside = startIdx !== -1 && endIdx !== -1 && cursor.ch >= startIdx + markerStart.length && cursor.ch <= endIdx + markerEnd.length;
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