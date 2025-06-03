/**
 * Settings tab for the Custom Comments plugin.
 *
 * This class creates the settings UI in Obsidian's settings panel, allowing users to customize their comment template.
 *
 * @class CommentFormatSettingTab
 * @extends PluginSettingTab
 */
import { App, PluginSettingTab, Setting } from "obsidian";
import CommentFormatPlugin from "./main";

export class CommentFormatSettingTab extends PluginSettingTab {
    plugin: CommentFormatPlugin;

    constructor(app: App, plugin: CommentFormatPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        new Setting(containerEl)
            .setName("Comment Format")
            .setDesc("Use {cursor} wherever you want the cursor to go (e.g. '%% {cursor} %%' or '<!-- {cursor} -->').")
            .addTextArea(text =>
                text
                    .setValue(this.plugin.settings.template)
                    .onChange(async (value) => {
                        this.plugin.settings.template = value || "%% {cursor} %%";
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Word-only toggle mode")
            .setDesc("If enabled, toggling will un/comment the word at the cursor's location rather than inserting a comment at the cursor position.")
            .addToggle(toggle =>
                toggle
                    .setValue(!!this.plugin.settings.wordOnlyMode)
                    .onChange(async (value) => {
                        this.plugin.settings.wordOnlyMode = value;
                        await this.plugin.saveSettings();
                    })
            );
    }
}
