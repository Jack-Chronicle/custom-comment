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
    }
}
