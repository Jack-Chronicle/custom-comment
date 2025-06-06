/**
 * Settings interface and default values for the Custom Comments plugin.
 *
 * @interface CommentFormatSettings
 * @property {string} template - The comment template string, with `{cursor}` as the cursor placeholder.
 *
 * @constant DEFAULT_SETTINGS - Default settings for the plugin.
 */

export interface MarkerSet {
    start: string;
    end: string;
    registerCommand?: boolean;
}

export interface CommentFormatSettings {
    template: string;
    wordOnlyMode?: boolean;
    additionalMarkers?: Array<MarkerSet>;
}

export const DEFAULT_SETTINGS: CommentFormatSettings = {
    template: "%% {cursor} %%",
    wordOnlyMode: false,
    additionalMarkers: []
};
