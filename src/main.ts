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
            id: "insert-comment-template",
            name: "Insert Comment",
            editorCallback: (editor: Editor) => this.insertComment(editor)
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
}
