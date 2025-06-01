export interface CommentFormatSettings {
    template: string;
}

export const DEFAULT_SETTINGS: CommentFormatSettings = {
    template: "%% {cursor} %%"
};
