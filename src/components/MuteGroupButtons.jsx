import React from 'react';

import { TEXT_COLOR } from './utils/colors.jsx';

// StudioLive Console Setup: which mute group buttons act as Go / Back.
// Laid out like TheatreMix's "Mute Group Buttons" tab (a grid of buttons with a
// dropdown each), with StudioLive extras: the console's names for the groups,
// a warning when a group has channels in it, and a live flash when it's pressed.

const BOX_STYLE = {
    flex: "none",
    border: "1px solid rgb(130, 135, 144)",
    borderRadius: "4px",
    padding: "14px 14px 12px",
    position: "relative",
};

const BOX_TITLE_STYLE = {
    position: "absolute",
    top: "-9px",
    left: "12px",
    padding: "0 6px",
    backgroundColor: "rgb(50, 50, 50)",
    fontSize: 13,
    fontWeight: 600,
};

const GRID_STYLE = {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: "10px",
};

const CELL_STYLE = {
    border: "1px solid rgb(30, 30, 30)",
    borderRadius: "4px",
    backgroundColor: "rgb(60, 60, 60)",
    padding: "8px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "5px",
    textAlign: "center",
    transition: "background-color 0.4s, border-color 0.4s",
};

const SELECT_STYLE = {
    width: "100%",
    fontSize: 13,
    padding: "2px",
    color: TEXT_COLOR,
    backgroundColor: "rgb(30, 30, 30)",
    border: "1px solid rgb(130, 135, 144)",
    borderRadius: "3px",
};

const NOTE_STYLE = {fontSize: 11, lineHeight: 1.3, minHeight: "2.6em"};

// Flash colors: green = fired an action, blue = pressed but not mapped
const FLASH_FIRED = "rgb(40, 120, 40)";
const FLASH_PRESSED = "rgb(30, 70, 140)";

/**
 * @typedef {Object} MuteGroupButtonsProps
 * @property {Object | null} setup - from consoleSetupApi.get()
 * @property {Object<number, number>} pending - mute group -> action being edited
 * @property {Function} onChange - called with the new pending map
 * @property {Object<number, {fired: boolean, at: number}>} flashes - recent presses
 */

/**
 * @param {MuteGroupButtonsProps} props
 */
const MuteGroupButtons = ({setup, pending, onChange, flashes}) => {
    const enabled = setup?.hasShow ?? false;

    /**
     * Pick an action for a mute group. Each action can only be on one button
     * (TheatreMix's format), so choosing it here moves it off any other group.
     */
    const setAction = (group, value) => {
        const next = {};
        for (const [g, action] of Object.entries(pending)) {
            if (Number(g) !== group && (value === "" || action !== Number(value))) next[g] = action;
        }
        if (value !== "") next[group] = Number(value);
        onChange(next);
    }

    const sourceNote = !setup ? "" :
        !setup.hasShow ? "Open a show to set up the console's buttons." :
        setup.source === 'theatremix' ? "Using the buttons set in TheatreMix. Changes here are saved in this show (.tmixp) and kept when merging." :
        setup.source === 'none' ? "No buttons set yet." : "";

    return (
        <div style={BOX_STYLE}>
            <div style={BOX_TITLE_STYLE}>Mute Group Buttons (StudioLive)</div>

            <div style={{fontSize: 12, opacity: 0.8, marginBottom: "10px"}}>
                Use <b>empty</b> mute groups. {setup?.connected
                    ? "Press a button on the console to test it: it lights up here."
                    : "Connect to the console to see its mute groups and test the buttons."}
            </div>

            <div style={GRID_STYLE}>
                {(setup?.groups ?? []).map(({group, name, members, membersText}) => {
                    const action = pending[group];
                    const flash = flashes[group];
                    const customName = name && name !== `Mute Group ${group}` ? name : null;
                    const unsupported = action !== undefined && !setup.actions[action]?.supported;

                    return (
                        <div
                            key={group}
                            style={{
                                ...CELL_STYLE,
                                ...(flash ? {backgroundColor: flash.fired ? FLASH_FIRED : FLASH_PRESSED, borderColor: "#fff"} : {}),
                                opacity: enabled ? 1 : 0.5,
                            }}
                            data-group={group}
                        >
                            <div style={{fontWeight: 600, fontSize: 13}}>Mute Group {group}</div>
                            <div style={{fontSize: 11, opacity: 0.7, minHeight: "1.2em"}} title={customName ?? undefined}>
                                {customName ? `"${customName}"` : ""}
                            </div>

                            <select
                                style={SELECT_STYLE}
                                value={action ?? ""}
                                disabled={!enabled}
                                onChange={(e) => setAction(group, e.target.value)}
                                aria-label={`Mute group ${group} action`}
                            >
                                <option value="">—</option>
                                {setup.actions.filter((a) => a.supported || a.id === action).map((a) => (
                                    <option key={a.id} value={a.id}>{a.name}{a.supported ? "" : " (not supported)"}</option>
                                ))}
                            </select>

                            <div style={NOTE_STYLE}>
                                {members === null ? <span style={{opacity: 0.5}}>—</span>
                                    : members.length === 0 ? <span style={{color: "#7fd07f"}}>Empty</span>
                                    : action !== undefined
                                        ? <span style={{color: "#e0a800"}}>⚠ Also mutes ch {membersText}</span>
                                        : <span style={{opacity: 0.6}}>Ch {membersText}</span>}
                                {unsupported && <div style={{color: "#e0a800"}}>Not supported yet</div>}
                            </div>
                        </div>
                    );
                })}
            </div>

            {sourceNote && <div style={{fontSize: 11, opacity: 0.7, marginTop: "8px"}}>{sourceNote}</div>}
        </div>
    );
}

export default MuteGroupButtons;
export { BOX_STYLE, BOX_TITLE_STYLE };
