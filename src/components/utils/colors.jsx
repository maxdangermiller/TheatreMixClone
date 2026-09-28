const BACKGROUND_COLOR = "#2a2a2a";
const HEADER_COLOR = "#444444";
const DEFAULT_ROW_COLOR = "#000000";
const RED_HIGHLIGHT_COLOR = "#703a3c";
const YELLOW_HIGHLIGHT_COLOR = "#846c37";
const GREEN_HIGHLIGHT_COLOR = "#506d43";
const BLUE_HIGHLIGHT_COLOR = "#40536a";
const PURPLE_HIGHLIGHT_COLOR = "#664d77";
const TEXT_COLOR = "#ffffff";
const ACTIVE_CUE_COLOR = "#626198";
const BORDER_COLOR = "#111111";

const get_cue_color = (index) => {
    switch(index) {
        case 0:
            return DEFAULT_ROW_COLOR;
        case 1:
            return RED_HIGHLIGHT_COLOR;
        case 2: 
            return YELLOW_HIGHLIGHT_COLOR;
        case 3:
            return GREEN_HIGHLIGHT_COLOR;
        case 4:
            return BLUE_HIGHLIGHT_COLOR;
        case 5:
            return PURPLE_HIGHLIGHT_COLOR;
        default:
            return DEFAULT_ROW_COLOR
    }
}

export { 
    BACKGROUND_COLOR, HEADER_COLOR,
    DEFAULT_ROW_COLOR, RED_HIGHLIGHT_COLOR,
    YELLOW_HIGHLIGHT_COLOR, GREEN_HIGHLIGHT_COLOR,
    BLUE_HIGHLIGHT_COLOR, PURPLE_HIGHLIGHT_COLOR, 
    TEXT_COLOR, ACTIVE_CUE_COLOR, BORDER_COLOR,
    get_cue_color
}