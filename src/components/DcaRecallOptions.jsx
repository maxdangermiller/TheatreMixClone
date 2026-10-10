import React from 'react';

import { BOX_STYLE, BOX_TITLE_STYLE } from './MuteGroupButtons.jsx';

// Console Setup → DCA Recall: how DCA levels are recalled when cues change.

const OPTION_STYLE = {
    display: "flex",
    gap: "10px",
    alignItems: "flex-start",
    cursor: "pointer",
};

const NOTE_STYLE = {fontSize: 12, opacity: 0.7, marginTop: "2px"};

const OPTIONS = [
    {
        key: 'levelsFollowPeople',
        label: "Levels follow people",
        note: "When someone moves to a different DCA, it comes up at the level their old DCA was at. Off: a DCA only moves when a level is set for the cue.",
    },
    {
        key: 'restoreOnBack',
        label: "Back restores DCAs",
        note: "Going Back into a cue puts its DCA faders and mutes back as they were when you left it. Off: Back fires the cue like Go.",
    },
];

/**
 * @param {{values: {levelsFollowPeople: boolean, restoreOnBack: boolean} | null, onChange: Function}} props
 */
const DcaRecallOptions = ({values, onChange}) => (
    <div style={BOX_STYLE}>
        <div style={BOX_TITLE_STYLE}>DCA Recall</div>

        <div style={{display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px"}}>
            {OPTIONS.map(({key, label, note}) => (
                <label key={key} style={OPTION_STYLE}>
                    <input
                        type="checkbox"
                        checked={values?.[key] ?? true}
                        disabled={values === null}
                        onChange={(e) => onChange({...values, [key]: e.target.checked})}
                        style={{marginTop: "3px"}}
                    />
                    <span>
                        <div style={{fontSize: 13, fontWeight: 600}}>{label}</div>
                        <div style={NOTE_STYLE}>{note}</div>
                    </span>
                </label>
            ))}
        </div>
    </div>
);

export default DcaRecallOptions;
