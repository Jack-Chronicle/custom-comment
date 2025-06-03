/**
 * Settings interface and default values for the Custom Comments plugin.
 *
 * @interface CommentFormatSettings
 * @property {string} template - The comment template string, with `{cursor}` as the cursor placeholder.
 *
 * @constant DEFAULT_SETTINGS - Default settings for the plugin.
 */

export interface CommentFormatSettings {
    template: string;
    wordOnlyMode?: boolean;
}

export const DEFAULT_SETTINGS: CommentFormatSettings = {
    template: "%% {cursor} %%",
    wordOnlyMode: false
};
