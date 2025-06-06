import { Editor } from "obsidian";

/**
 * Returns the selection range from the editor, or treats the cursor as a zero-width selection if no selection exists.
 * @param editor Obsidian editor instance
 * @returns { from, to, selection }
 */
export function getSelectionRange(editor: Editor) {
    const selection = editor.getSelection();
    if (selection) {
        return {
            from: editor.getCursor("from"),
            to: editor.getCursor("to"),
            selection,
        };
    } else {
        const cursor = editor.getCursor();
        return {
            from: { line: cursor.line, ch: cursor.ch },
            to: { line: cursor.line, ch: cursor.ch },
            selection: '',
        };
    }
}
