# Custom Comments

Lets you customize your comment syntax/formats in Obsidian.

## Features

> I'm putting comments in quotes as they don't really work as comments unless you use one of the methods supported by obsidian (HTML or Markdown)

- Insert custom comment templates anywhere in your notes.
- Define your own comment format using `{cursor}` as a placeholder for the cursor position.
  - Example templates:
    - `%% {cursor} %%`
    - `<!-- {cursor} -->`
- You can add additional sets if you want even more 'comment' markers
  - Each set has a toggle for adding commands for them
- A command for reloading the plugin if you have more than 9 additional sets of 'comment' markers

## Installation

### Manual Installation

1. Download the `main.js` and `manifest.json` files from the Releases page
2. Move the files to your Obsidian vault's `.obsidian/plugins/custom-comment` folder.
   1. You can open this up by going to your settings > community plugins page and clicking the little folder icon

### Community Plugins

- Currently Working on apporval
<!-- Open the Community Plugins tab in the settings and search for "Custom Comments" -->

## Usage

- Open Obsidian and enable the "Custom Comments" plugin in the community plugins settings.
- Go to the plugin settings to customize your comment template.
- Use the "Insert Comment" command (via command palette or hotkey) to insert your custom comment at the cursor position.

## Settings

- **Comment Format**: Set your desired comment template. Use `{cursor}` to indicate where the cursor should be placed after insertion.
- **Word-only Mode**: If enabled, toggling will comment/uncomment the word at the cursor instead of inserting the template at the cursor position.
- **Additional Marker Sets**: Add multiple custom marker sets (start/end pairs). Each set can be enabled/disabled for command registration.
  - A toggle for en/disabling the command for that set
  - Two input fields, one for the *start* and one for the *end* markers
- **Reload Marker Commands**: Command to reload marker commands in-place if you change marker sets (no plugin reload required).

## Development

- To watch for changes during development: `npm run dev`

## License

MIT

---

Author: [Jack Chronicle](https://github.com/Jack-Chronicle)