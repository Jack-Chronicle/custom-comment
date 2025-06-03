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
        function normalize(str: string) {
            return str.replace(/\s+/g, ' ').trim();
        }
        const normStart = normalize(markerStart);
        const normEnd = normalize(markerEnd);

        // 2. Efficient Comment Detection
        function isRegionCommented(text: string, start: string, end: string) {
            const trimmed = text.trim();
            if (start && end) {
                return trimmed.startsWith(start) && trimmed.endsWith(end);
            } else if (start) {
                return trimmed.startsWith(start);
            }
            return false;
        }
        // fallback style detection
        function detectFallback(text: string) {
            for (const style of defaultStyles) {
                const s = normalize(style.start);
                const e = normalize(style.end);
                if (isRegionCommented(text, s, e)) {
                    return { found: true, markerStart: style.start, markerEnd: style.end };
                }
            }
            return { found: false };
        }

        // 3. Mode Decision
        const selection = editor.getSelection();
        const cursor = editor.getCursor();
        let from = editor.getCursor("from");
        let to = editor.getCursor("to");
        let line = editor.getLine(cursor.line);
        let text: string;
        let wordBounds: { start: number, end: number } | null = null;
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

        // 3.1 Marker Search in Selection
        function findMarkerInText(marker: string, text: string) {
            let idx = text.indexOf(marker);
            if (idx !== -1) return { idx, full: true };
            // Try partials (from length-1 down to 1)
            for (let len = marker.length - 1; len > 0; len--) {
                if (text.includes(marker.slice(0, len))) return { idx: text.indexOf(marker.slice(0, len)), full: false };
                if (text.includes(marker.slice(-len))) return { idx: text.indexOf(marker.slice(-len)), full: false };
            }
            return { idx: -1, full: false };
        }

        // 3.2 Marker Search in Document
        function searchMarkerInLine(marker: string, startIdx: number, direction: 'back' | 'forward') {
            if (!marker) return -1;
            if (direction === 'back') {
                for (let i = startIdx; i >= 0; i--) {
                    if (line.slice(i, i + marker.length) === marker) return i;
                }
            } else {
                for (let i = startIdx; i <= line.length - marker.length; i++) {
                    if (line.slice(i, i + marker.length) === marker) return i;
                }
            }
            return -1;
        }

        // 4. Comment Region Detection
        let startIdx = -1, endIdx = -1;
        let region = '', regionIsComment = false;
        let usedStart = normStart, usedEnd = normEnd;
        if (selection) {
            // Marker search in selection
            const foundStart = findMarkerInText(normStart, text);
            const foundEnd = findMarkerInText(normEnd, text);
            if (foundStart.full && foundEnd.full) {
                // Full marker in selection: search back for start, forward for end
                startIdx = searchMarkerInLine(normStart, from.ch, 'back');
                endIdx = searchMarkerInLine(normEnd, to.ch, 'forward');
            } else if (foundStart.idx !== -1) {
                // Partial start: search back for start
                startIdx = searchMarkerInLine(normStart, from.ch, 'back');
                endIdx = searchMarkerInLine(normEnd, to.ch, 'forward');
            } else if (foundEnd.idx !== -1) {
                // Partial end: search forward for end
                startIdx = searchMarkerInLine(normStart, from.ch, 'back');
                endIdx = searchMarkerInLine(normEnd, to.ch, 'forward');
            } else {
                // No marker: search back from end for start, forward from start for end
                startIdx = searchMarkerInLine(normStart, to.ch, 'back');
                endIdx = searchMarkerInLine(normEnd, from.ch, 'forward');
            }
        } else if (wordBounds) {
            // Use word boundary as selection
            startIdx = searchMarkerInLine(normStart, wordBounds.start, 'back');
            endIdx = searchMarkerInLine(normEnd, wordBounds.end, 'forward');
        } else {
            // Cursor
            startIdx = searchMarkerInLine(normStart, cursor.ch, 'back');
            endIdx = searchMarkerInLine(normEnd, cursor.ch, 'forward');
        }
        if (startIdx !== -1 && (usedEnd ? endIdx !== -1 && startIdx < endIdx : true)) {
            // Extract region
            const regionStart = startIdx + normStart.length;
            const regionEnd = usedEnd && endIdx !== -1 ? endIdx : line.length;
            region = line.slice(regionStart, regionEnd);
            if (isRegionCommented(line.slice(startIdx, (usedEnd && endIdx !== -1 ? endIdx + normEnd.length : line.length)), normStart, normEnd)) {
                regionIsComment = true;
            }
        } else {
            // Try fallback styles
            const fallback = detectFallback(line);
            if (fallback.found) {
                usedStart = fallback.markerStart ? normalize(fallback.markerStart) : '';
                usedEnd = fallback.markerEnd ? normalize(fallback.markerEnd) : '';
                startIdx = searchMarkerInLine(usedStart, cursor.ch, 'back');
                endIdx = searchMarkerInLine(usedEnd, cursor.ch, 'forward');
                if (startIdx !== -1 && (usedEnd ? endIdx !== -1 && startIdx < endIdx : true)) {
                    const regionStart = startIdx + usedStart.length;
                    const regionEnd = usedEnd && endIdx !== -1 ? endIdx : line.length;
                    region = line.slice(regionStart, regionEnd);
                    if (isRegionCommented(line.slice(startIdx, (usedEnd && endIdx !== -1 ? endIdx + usedEnd.length : line.length)), usedStart, usedEnd)) {
                        regionIsComment = true;
                    }
                }
            }
        }

        // 5. Toggle Logic
        if (regionIsComment) {
            // Remove markers, and also remove spaces that were added with the markers
            let beforeRegion = line.slice(0, startIdx);
            let afterRegion = line.slice((usedEnd && endIdx !== -1 ? endIdx + usedEnd.length : line.length));
            // Remove a single space after the start marker if present
            if (region.startsWith(' ')) region = region.slice(1);
            // Remove a single space before the end marker if present
            if (region.endsWith(' ')) region = region.slice(0, -1);
            let newLine = beforeRegion + region + afterRegion;
            editor.setLine(cursor.line, newLine);
            // 6. Cursor Management (restore relative position)
            let removedBefore = 0;
            if (selection) {
                const unclamped = beforeRegion.length;
                const selFrom = { line: cursor.line, ch: unclamped };
                const selTo = { line: cursor.line, ch: unclamped + region.length };
                editor.setSelection(selFrom, selTo);
            } else if (wordBounds) {
                const unclamped = beforeRegion.length;
                editor.setCursor({ line: cursor.line, ch: unclamped });
            } else {
                // Cursor: restore relative position
                // Calculate how many chars were removed before the original cursor
                removedBefore = (cursor.ch > startIdx ? Math.min(cursor.ch, startIdx + usedStart.length) - startIdx : 0) + usedStart.length;
                let newCh = cursor.ch - removedBefore;
                if (newCh < beforeRegion.length) newCh = beforeRegion.length;
                editor.setCursor({ line: cursor.line, ch: newCh });
            }
            logDev('Uncommented region', { from, to, region });
        } else {
            // Insert markers, preserve whitespace inside selection/word
            let innerText = text;
            if (!selection && !wordBounds && !text.trim()) innerText = '';
            let commented: string;
            let newLine;
            if (selection) {
                commented = usedStart + (innerText ? ' ' : '') + innerText + (innerText ? ' ' : '') + usedEnd;
                newLine = line.slice(0, from.ch) + commented + line.slice(to.ch);
                editor.setLine(cursor.line, newLine);
                const selFrom = { line: cursor.line, ch: from.ch + usedStart.length + (innerText ? 1 : 0) };
                const selTo = { line: cursor.line, ch: from.ch + usedStart.length + (innerText ? 1 : 0) + innerText.length };
                editor.setSelection(selFrom, selTo);
            } else if (wordBounds && this.settings.wordOnlyMode) {
                // Word only mode: treat word as selection (add spaces around word)
                commented = usedStart + ' ' + line.slice(wordBounds.start, wordBounds.end) + ' ' + usedEnd;
                newLine = line.slice(0, wordBounds.start) + commented + line.slice(wordBounds.end);
                editor.setLine(cursor.line, newLine);
                // Select the word inside the comment
                const selFrom = { line: cursor.line, ch: wordBounds.start + usedStart.length + 1 };
                const selTo = { line: cursor.line, ch: wordBounds.start + usedStart.length + 1 + (wordBounds.end - wordBounds.start) };
                editor.setSelection(selFrom, selTo);
            } else if (wordBounds) {
                // Not word only mode: treat as cursor insert (no spaces around word)
                commented = usedStart + '  ' + usedEnd;
                newLine = line.slice(0, cursor.ch) + commented + line.slice(cursor.ch);
                editor.setLine(cursor.line, newLine);
                // Place cursor between the two spaces
                editor.setCursor({ line: cursor.line, ch: cursor.ch + usedStart.length + 1 });
            } else {
                commented = usedStart + '  ' + usedEnd;
                newLine = line.slice(0, cursor.ch) + commented + line.slice(cursor.ch);
                editor.setLine(cursor.line, newLine);
                // Place cursor between the two spaces
                editor.setCursor({ line: cursor.line, ch: cursor.ch + usedStart.length + 1 });
            }
            logDev('Commented region', { from, to, commented });
        }
        // 6. Clamp cursor to valid position
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