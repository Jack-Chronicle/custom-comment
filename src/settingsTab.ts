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
            .addText(text =>
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

        // Additional marker sets UI
        containerEl.createEl('h3', { text: 'Additional Marker Sets' });
        const additionalMarkers = this.plugin.settings.additionalMarkers || [];
        additionalMarkers.forEach((marker, idx) => {
            const setting = new Setting(containerEl)
                .setName(`Marker Set ${idx + 1}`)
                // Add toggle for command registration
                .addToggle(toggle => toggle
                    .setValue(!!marker.registerCommand)
                    .onChange(async (value) => {
                        if (this.plugin.settings.additionalMarkers) {
                            this.plugin.settings.additionalMarkers[idx].registerCommand = value;
                            await this.plugin.saveSettings();
                            this.plugin.registerMarkerCommands(true); // Update commands in-place, do not reload plugin
                            this.display(); // Only refresh UI on toggle
                        }
                    })
                )
                .addText(text => text
                    .setPlaceholder('Start marker')
                    .setValue(marker.start)
                    .onChange(async (value) => {
                        if (this.plugin.settings.additionalMarkers) {
                            this.plugin.settings.additionalMarkers[idx].start = value;
                            await this.plugin.saveSettings();
                            // Do not call this.display() here to avoid focus loss
                        }
                    })
                )
                .addText(text => text
                    .setPlaceholder('End marker')
                    .setValue(marker.end)
                    .onChange(async (value) => {
                        if (this.plugin.settings.additionalMarkers) {
                            this.plugin.settings.additionalMarkers[idx].end = value;
                            await this.plugin.saveSettings();
                            // Do not call this.display() here to avoid focus loss
                        }
                    })
                )
                .addExtraButton(btn => btn
                    .setIcon('cross')
                    .setTooltip('Remove marker set')
                    .onClick(async () => {
                        if (this.plugin.settings.additionalMarkers) {
                            this.plugin.settings.additionalMarkers.splice(idx, 1);
                            await this.plugin.saveSettings();
                            this.display(); // Only refresh UI on remove
                        }
                    })
                );
        });
        new Setting(containerEl)
            .addButton(btn => btn
                .setButtonText('Add Marker Set')
                .setCta()
                .onClick(async () => {
                    if (!this.plugin.settings.additionalMarkers) this.plugin.settings.additionalMarkers = [];
                    this.plugin.settings.additionalMarkers.push({ start: '', end: '', registerCommand: false });
                    await this.plugin.saveSettings();
                    this.display(); // Only refresh UI on add
                })
            );
    }
}
