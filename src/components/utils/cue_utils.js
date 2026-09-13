import Cue from '../../models/Cue.js';
import ShowFile from '../../models/ShowFile.js';

/**
 * Get DCA Label
 * @param {ShowFile} show
 * @param {Cue} cue 
 * @param {Integer} dca_number 
 * @returns 
 */
const get_DCA_label = (show, cue, dca_number) => {


    let prefix = "dca";

    if (dca_number < 10) {
        prefix += "0";
    }
    
    const channels = cue[`${prefix}${dca_number}Channels`].replace(" ", "").split(",");
    const label = cue[`${prefix}${dca_number}Label`];
    
    if (label !== null && label !== "") {
        // Use specified label
        return label;
    }

    // Find default label
    if (channels.length === 0) {
        return "~";
    }

    const def_chan = parseInt(channels[0]);

    if (def_chan === NaN) {
        return "~";
    }

    for (const profile of show.profiles) {
        if (profile.channel === def_chan) {
            if (profile.label !== null) {
                return profile.label;
            }

            return profile.name;
        }
    }

    return "-"
}

export {get_DCA_label};