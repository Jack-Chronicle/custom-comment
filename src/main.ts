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

export default class CommentFormatPlugin extends Plugin {
    /**
     * Plugin settings, loaded on initialization.
     */
    settings!: CommentFormatSettings;

    async onload() {
        await this.loadSettings();
        this.addSettingTab(new CommentFormatSettingTab(this.app, this));

        this.addCommand({
            id: "toggle-comment-template",
            name: "Toggle Comment",
            editorCallback: (editor: Editor) => this.toggleComment(editor)
        });
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
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

    toggleComment(editor: Editor) {
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

        // Default comment styles to check
        const defaultStyles = [
            { start: "%%", end: "%%" },
            { start: "<!--", end: "-->" },
            { start: "//", end: "" },
        ];

        const selection = editor.getSelection();
        const cursor = editor.getCursor();
        let text: string;
        let from = editor.getCursor("from");
        let to = editor.getCursor("to");
        let wordBounds: { start: number, end: number } | null = null;
        let line = editor.getLine(cursor.line);

        // Helper to find word bounds at a given ch
        function getWordBounds(line: string, ch: number): { start: number, end: number } | null {
            const regex = /\w+/g;
            let match;
            while ((match = regex.exec(line)) !== null) {
                if (ch >= match.index && ch <= match.index + match[0].length) {
                    return { start: match.index, end: match.index + match[0].length };
                }
            }
            return null;
        }

        // Helper to check if a string is commented with given markers
        function isTextCommented(str: string, start: string, end: string) {
            if (!start) return false;
            if (end) {
                return str.trim().startsWith(start) && str.trim().endsWith(end);
            } else {
                return str.trim().startsWith(start);
            }
        }
        // Helper to check if cursor is inside a comment
        function isCursorInsideComment(line: string, cursorCh: number, start: string, end: string) {
            const startIdx = line.indexOf(start);
            const endIdx = end ? line.lastIndexOf(end) : -1;
            if (start && end) {
                return startIdx !== -1 && endIdx !== -1 && cursorCh >= startIdx + start.length && cursorCh <= endIdx;
            } else if (start) {
                return startIdx !== -1 && cursorCh >= startIdx + start.length;
            }
            return false;
        }

        // If selection, operate as before
        if (selection) {
            text = selection;
        } else {
            // No selection: check if cursor is inside a word
            wordBounds = getWordBounds(line, cursor.ch);
            if (wordBounds) {
                text = line.slice(wordBounds.start, wordBounds.end);
                from = { line: cursor.line, ch: wordBounds.start };
                to = { line: cursor.line, ch: wordBounds.end };
            } else {
                text = line;
                from = { line: cursor.line, ch: 0 };
                to = { line: cursor.line, ch: line.length };
            }
        }

        // Check if selection or word/line is inside a comment (custom or default)
        let usedStart = markerStart;
        let usedEnd = markerEnd;
        let inside = false;
        if (markerStart && isTextCommented(text, markerStart, markerEnd)) {
            inside = true;
        } else {
            for (const style of defaultStyles) {
                if (style.start && isTextCommented(text, style.start, style.end)) {
                    usedStart = style.start;
                    usedEnd = style.end;
                    inside = true;
                    break;
                }
            }
        }

        if (inside) {
            // Remove comment markers
            let uncommented = text;
            let removedStartLen = 0;
            if (usedStart) {
                const re = new RegExp(`^\\s*${usedStart.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}`);
                const match = uncommented.match(re);
                if (match) {
                    removedStartLen = match[0].length;
                }
                uncommented = uncommented.replace(re, "");
            }
            if (usedEnd) {
                const re = new RegExp(`${usedEnd.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\s*$`);
                uncommented = uncommented.replace(re, "");
            }
            uncommented = uncommented.trim();
            if (selection) {
                editor.replaceSelection(uncommented);
                editor.setSelection(from, { line: to.line, ch: to.ch - removedStartLen });
            } else if (wordBounds) {
                editor.replaceRange(uncommented, { line: cursor.line, ch: wordBounds.start }, { line: cursor.line, ch: wordBounds.end });
                const newCh = Math.max(wordBounds.start, cursor.ch - removedStartLen);
                editor.setCursor({ line: cursor.line, ch: newCh });
            } else {
                editor.setLine(cursor.line, uncommented);
                const newCh = Math.max(0, cursor.ch - removedStartLen);
                editor.setCursor({ line: cursor.line, ch: newCh });
            }
        } else {
            // Add comment markers, preserving template spaces
            let commented = before + text + after;
            if (selection) {
                editor.replaceSelection(commented);
                const startOffset = before.length;
                editor.setSelection(
                    { line: from.line, ch: from.ch + startOffset },
                    { line: to.line, ch: to.ch + startOffset }
                );
            } else if (wordBounds) {
                editor.replaceRange(commented, { line: cursor.line, ch: wordBounds.start }, { line: cursor.line, ch: wordBounds.end });
                const newCh = cursor.ch + before.length;
                editor.setCursor({ line: cursor.line, ch: newCh });
            } else {
                editor.setLine(cursor.line, commented);
                editor.setCursor({ line: cursor.line, ch: cursor.ch + before.length });
            }
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