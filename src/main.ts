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

        // 3. Mode Decision
        const selection = editor.getSelection();
        const cursor = editor.getCursor();
        let from = editor.getCursor("from");
        let to = editor.getCursor("to");
        let line = editor.getLine(cursor.line);
        let text: string;
        let wordBounds: { start: number, end: number } | null = null;
        if (selection) {
            text = selection;
        } else {
            wordBounds = getWordBounds(line, cursor.ch);
            if (wordBounds && cursor.ch > wordBounds.start && cursor.ch < wordBounds.end) {
                text = line.slice(wordBounds.start, wordBounds.end);
                from = { line: cursor.line, ch: wordBounds.start };
                to = { line: cursor.line, ch: wordBounds.end };
            } else {
                text = '';
                from = { line: cursor.line, ch: cursor.ch };
                to = { line: cursor.line, ch: cursor.ch };
            }
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
        if (selection) {
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
                // Adjust selection
                let selFrom = { ...from };
                let selTo = { ...to };
                if (removedBeforeStart && selFrom.line === from.line) {
                    selFrom.ch = Math.max(0, selFrom.ch - removedBeforeStart);
                }
                if (removedBeforeEnd && selTo.line === to.line) {
                    selTo.ch = Math.max(selFrom.ch, selTo.ch - removedBeforeEnd);
                }
                logDev('Uncommented marker pair encompassing selection', { from, to, pairToRemove, removedBeforeStart, removedBeforeEnd, selFrom, selTo });
                editor.setSelection(selFrom, selTo);
                return;
            }
            // If no marker pair was found, wrap the selection in a comment and return
            if (selection) {
                const selText = editor.getRange(from, to);
                const commented = normStart + (selText ? ' ' : '') + selText + (selText ? ' ' : '') + normEnd;
                editor.replaceRange(commented, from, to);
                const startMarkerLen = normStart.length + (selText ? 1 : 0);
                const selFrom = { line: from.line, ch: from.ch + startMarkerLen };
                let selTo;
                if (from.line === to.line) {
                    selTo = { line: to.line, ch: to.ch + startMarkerLen };
                } else {
                    selTo = { line: to.line, ch: to.ch };
                }
                editor.setSelection(selFrom, selTo);
                logDev('Commented region (no marker pair found)', { from, to, commented });
                return;
            }
        } else {
            return;
        }

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