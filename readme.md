# Custom Comments

Lets you customize your comment syntax/formats in Obsidian.

## Features

- Insert custom comment templates anywhere in your notes.
- Define your own comment format using `{cursor}` as a placeholder for the cursor position.
- Example templates:
  - `%% {cursor} %%`
  - `<!-- {cursor} -->`

## Installation

1. Clone or download this repository.
2. Run `npm install` to install dependencies.
3. Build the plugin: `npm run build`
4. Copy `main.js`, `manifest.json` to your Obsidian vault's `.obsidian/plugins/custom-comment` folder.

## Usage

- Open Obsidian and enable the "Custom Comments" plugin in the community plugins settings.
- Go to the plugin settings to customize your comment template.
- Use the "Insert Comment" command (via command palette or hotkey) to insert your custom comment at the cursor position.

## Settings

- **Comment Format**: Set your desired comment template. Use `{cursor}` to indicate where the cursor should be placed after insertion.

## Development

- To watch for changes during development: `npm run dev`

## License

MIT

---

Author: [Jack Chronicle](https://github.com/Jack-Chronicle)