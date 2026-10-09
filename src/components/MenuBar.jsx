import React, { useEffect, useRef, useState } from "react";

import {
    NewShowIcon, OpenShowIcon, SaveShowIcon,
    UndoIcon, RedoIcon,
    InsertCueIcon, CloneCueIcon, DeleteCueIcon,
    AssignIcon,
    FxColumnIcon, PositionsColumnIcon, LockIcon, UnlockIcon,
    BackIcon, GoIcon,
    ConsoleSetupIcon, QLabStatusIcon
} from "./ToolbarIcons.jsx";

const TOOLBAR_STYLE = {
    backgroundColor: "#444444",
    display: "flex",
    alignItems: "center",
    gap: "2px",
    padding: "4px 8px",
    flex: "none",
    overflow: "hidden",
    userSelect: "none",
};

const DIVIDER_STYLE = {
    flex: "none",
    width: "1px",
    height: "30px",
    margin: "0 8px",
    backgroundColor: "#5c5c5c",
};

const isMac = navigator.userAgent.includes("Mac");

// QLab status light colours
const QLAB_COLORS = {connected: "#3cc83c", connecting: "#9a9a9a"};

// Console Setup icon: green when connected (like TheatreMix), amber while (re)connecting
const CONSOLE_COLORS = {connected: "#3cc83c", connecting: "#e0a800"};

/**
 * Tooltip for the Console Setup button
 * @param {{state: String, host?: String, name?: String, message?: String}} status 
 */
const console_tooltip = (status) => {
    const target = status.name ? `${status.name} (${status.host})` : status.host;

    switch (status.state) {
        case 'connected': return `Console connected: ${target}`;
        case 'connecting': return `${status.message ?? "Connecting"}: ${target}`;
        default: return status.message ? `Console disconnected: ${status.message}` : "Console disconnected";
    }
}

const QLAB_STATUS_STYLE = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "42px",
    height: "40px",
    flex: "none",
};

/**
 * Shortcut text for tooltips, e.g. "⌘G" on Mac and "Ctrl+G" elsewhere
 * @param {String} keys e.g. "Mod+Shift+Z"
 * @returns {String}
 */
const shortcut = (keys) => {
    if (!isMac) return keys.replace("Mod", "Ctrl");

    const symbols = {Mod: "⌘", Shift: "⇧", Alt: "⌥"};
    const parts = keys.split("+");
    const key = parts.pop();

    // macOS order: ⌥⇧⌘
    const order = ["Alt", "Shift", "Mod"];
    return parts.sort((a, b) => order.indexOf(a) - order.indexOf(b)).map((m) => symbols[m]).join("") + key;
}

/**
 * @typedef {Object} ToolbarButtonProps
 * @property {String} label
 * @property {String} [keys] shortcut shown in the tooltip
 * @property {Function} [onClick] omitted for features that aren't built yet
 * @property {boolean} [disabled]
 * @property {boolean} [toggled]
 * @property {String} [color] icon colour (e.g. connection status)
 * @property {String} [tooltip] extra line shown above the label
 */

/**
 * @param {ToolbarButtonProps & {children: React.ReactNode}} props
 */
const ToolbarButton = ({label, keys, onClick, disabled = false, toggled = false, color, tooltip, children}) => (
    <button
        type="button"
        className={`toolbar-button${toggled ? " toggled" : ""}`}
        onClick={onClick}
        disabled={disabled || !onClick}
        style={color ? {color} : undefined}
        title={(tooltip ? `${tooltip}\n` : "") + (keys ? `${label} (${shortcut(keys)})` : label)}
        aria-label={label}
        aria-pressed={toggled || undefined}
    >
        {children}
    </button>
);

const Divider = () => <div style={DIVIDER_STYLE} aria-hidden="true" />;

/**
 * @typedef {Object} MenuBarProps
 * @property {Function} load_show - function that loads the show
 * @property {boolean} hasShow - is a show open?
 */

/**
 * Toolbar, laid out like TheatreMix's:
 * file | undo | cue editing | assign | view | transport | console
 * @param {MenuBarProps} params
 */
const MenuBar = ({load_show, hasShow}) => {
    const popupRef = useRef(null);

    const [lockEditing, setLockEditing] = useState(false);

    /** @type {[{state: String, workspace?: String, message?: String}, Function]} */
    const [qlab, setQLab] = useState({state: 'off'});

    const [consoleStatus, setConsoleStatus] = useState({state: 'disconnected'});

    const handleOpenFile = async () => {
        // Access the API exposed by the preload script
        const path = await window.electronAPI.openFile();

        if (path) {
            load_show(path);
        }
    };

    const handleOpenSettings = () => {
        // Prevent duplicate windows if already open
        if (popupRef.current && !popupRef.current.closed) {
            popupRef.current.focus();
            return;
        }

        // Open the new window via a targeted path matching your React routing
        popupRef.current = window.open(
            '#/popup',
            'PopupModal',
            'width=600,height=800' // Merged into overrideBrowserWindowOptions by Electron
        );
    }

    // Toolbar buttons run the same commands as the app menu
    const trigger = (action) => () => window.menuApi.trigger(action);

    useEffect(() => {
        // File → Console Setup (⌘K) opens the same popup as the toolbar button
        const unsubscribeMenu = window.menuApi.onMenuAction((action) => {
            if (action === 'console-setup') {
                handleOpenSettings();
            }
        });

        // Keep the lock button in sync with View → Lock Editing
        const unsubscribeView = window.menuApi.onViewSettings((view) => setLockEditing(view.lockEditing));
        window.menuApi.getViewSettings().then((view) => setLockEditing(view.lockEditing));

        // QLab connection light
        const unsubscribeQLab = window.qlabApi.onStatus(setQLab);
        window.qlabApi.getStatus().then(setQLab);

        // Console connection colours the Console Setup icon
        const unsubscribeConsole = window.presonus.onStatus(setConsoleStatus);
        window.presonus.getStatus().then(setConsoleStatus);

        return () => {
            unsubscribeMenu();
            unsubscribeView();
            unsubscribeQLab();
            unsubscribeConsole();
        };
    }, []);

    return (
        <div style={TOOLBAR_STYLE} role="toolbar" aria-label="Show toolbar">
            {/* Not built yet: New Show, cue editing, Assign, FX / Positions columns */}
            <ToolbarButton label="New Show" keys="Mod+N"><NewShowIcon/></ToolbarButton>
            <ToolbarButton label="Open Show" keys="Mod+O" onClick={handleOpenFile}><OpenShowIcon/></ToolbarButton>
            <ToolbarButton label="Save Show" keys="Mod+S" onClick={() => window.showApi.save()} disabled={!hasShow}><SaveShowIcon/></ToolbarButton>

            <Divider/>

            <ToolbarButton label="Undo" keys="Mod+Z" onClick={trigger('undo')} disabled={!hasShow}><UndoIcon/></ToolbarButton>
            <ToolbarButton label="Redo" keys="Mod+Shift+Z" onClick={trigger('redo')} disabled={!hasShow}><RedoIcon/></ToolbarButton>

            <Divider/>

            <ToolbarButton label="Insert Cue" keys="Mod+M"><InsertCueIcon/></ToolbarButton>
            <ToolbarButton label="Clone Cue" keys="Mod+Alt+C"><CloneCueIcon/></ToolbarButton>
            <ToolbarButton label="Delete Cue"><DeleteCueIcon/></ToolbarButton>

            <Divider/>

            <ToolbarButton label="Assign..." keys="Mod+E"><AssignIcon/></ToolbarButton>

            <Divider/>

            <ToolbarButton label="View FX" keys="Mod+F"><FxColumnIcon/></ToolbarButton>
            <ToolbarButton label="View Positions" keys="Mod+T"><PositionsColumnIcon/></ToolbarButton>
            <ToolbarButton
                label={lockEditing ? "Unlock Editing" : "Lock Editing"}
                keys="Mod+L"
                onClick={() => window.menuApi.setLockEditing(!lockEditing)}
                disabled={!hasShow}
                toggled={hasShow && lockEditing}
            >
                {lockEditing ? <LockIcon/> : <UnlockIcon/>}
            </ToolbarButton>

            <Divider/>

            <ToolbarButton label="Back" keys="Mod+B" onClick={trigger('back')} disabled={!hasShow}><BackIcon/></ToolbarButton>
            <ToolbarButton label="Go" keys="Mod+G" onClick={trigger('go')} disabled={!hasShow}><GoIcon/></ToolbarButton>

            <Divider/>

            <ToolbarButton
                label="Console Setup"
                keys="Mod+K"
                onClick={handleOpenSettings}
                color={CONSOLE_COLORS[consoleStatus.state]}
                tooltip={console_tooltip(consoleStatus)}
            >
                <ConsoleSetupIcon/>
            </ToolbarButton>

            {/* Only shown when the show recalls QLab cues */}
            {qlab.state !== 'off' && (
                <span
                    style={{...QLAB_STATUS_STYLE, color: QLAB_COLORS[qlab.state] ?? QLAB_COLORS.connecting}}
                    title={qlab.state === 'connected'
                        ? `QLab connected: ${qlab.workspace}`
                        : `QLab disconnected${qlab.message ? `: ${qlab.message}` : ""}`}
                    role="status"
                    aria-label={qlab.state === 'connected' ? `QLab connected: ${qlab.workspace}` : "QLab disconnected"}
                >
                    <QLabStatusIcon/>
                </span>
            )}
        </div>
    );
}

export default MenuBar;
