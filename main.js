"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => CommentFormatPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian2 = require("obsidian");

// src/settingsData.ts
var DEFAULT_SETTINGS = {
  template: "%% {cursor} %%"
};

// src/settingsTab.ts
var import_obsidian = require("obsidian");
var CommentFormatSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new import_obsidian.Setting(containerEl).setName("Comment Format").setDesc("Use {cursor} wherever you want the cursor to go (e.g. '%% {cursor} %%' or '<!-- {cursor} -->').").addTextArea(
      (text) => text.setValue(this.plugin.settings.template).onChange(async (value) => {
        this.plugin.settings.template = value || "%% {cursor} %%";
        await this.plugin.saveSettings();
      })
    );
  }
};

// src/main.ts
var CommentFormatPlugin = class extends import_obsidian2.Plugin {
  async onload() {
    await this.loadSettings();
    this.addSettingTab(new CommentFormatSettingTab(this.app, this));
    this.addCommand({
      id: "insert-comment-template",
      name: "Insert Comment",
      editorCallback: (editor) => this.insertComment(editor)
    });
  }
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  insertComment(editor) {
    const template = this.settings.template;
    const cursorIndex = template.indexOf("{cursor}");
    if (cursorIndex === -1) {
      editor.replaceSelection(template);
      return;
    }
    const before = template.slice(0, cursorIndex);
    const after = template.slice(cursorIndex + "{cursor}".length);
    const from = editor.getCursor();
    editor.replaceSelection(before + after);
    const lines = before.split("\n");
    const cursorLineOffset = lines.length - 1;
    const cursorChOffset = lines[lines.length - 1].length;
    editor.setCursor({
      line: from.line + cursorLineOffset,
      ch: (cursorLineOffset ? 0 : from.ch) + cursorChOffset
    });
  }
};
