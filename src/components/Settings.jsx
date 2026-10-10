import React, { useState, useEffect, useRef } from 'react';

import { is_ip_valid } from '../utils/ip_tools';

import { TEXT_COLOR, SELECTED_COLOR } from './utils/colors.jsx';
import MuteGroupButtons from './MuteGroupButtons.jsx';
import DcaRecallOptions from './DcaRecallOptions.jsx';

// How long a button press lights up in the mute group grid
const FLASH_MS = 700;

// Laid out like TheatreMix's Console Setup: device list on top, discovery
// buttons under it, Disconnect / Apply bottom-left, Cancel / OK bottom-right.

const WINDOW_STYLE = {
    height: "100%",
    display: "flex",
    flexDirection: "column",
    backgroundColor: "rgb(50, 50, 50)",
    color: TEXT_COLOR,
    fontFamily: "system-ui, -apple-system, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif",
    fontSize: 14,
    userSelect: "none",
};

// The popup is frameless, so this bar is the window's title and drag handle
const TITLE_BAR_STYLE = {
    WebkitAppRegion: "drag",
    flex: "none",
    padding: "10px 16px",
    fontSize: 15,
    fontWeight: 600,
    textAlign: "center",
    backgroundColor: "rgb(43, 43, 43)",
    borderBottom: "1px solid rgb(30, 30, 30)",
};

const BODY_STYLE = {
    flex: 1,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    padding: "16px 20px",
};

const LIST_STYLE = {
    flex: 1,
    minHeight: 110,
    overflowY: "auto",
    backgroundColor: "rgb(30, 30, 30)",
    border: "1px solid rgb(30, 30, 30)",
};

const TABLE_STYLE = {
    width: "100%",
    tableLayout: "fixed",
    borderCollapse: "collapse",
    textAlign: "left",
};

const HEADER_CELL_STYLE = {
    position: "sticky",
    top: 0,
    backgroundColor: "rgb(43, 43, 43)",
    padding: "5px 8px",
    fontWeight: 600,
    fontSize: 13,
    borderRight: "1px solid rgb(30, 30, 30)",
    whiteSpace: "nowrap",
};

const CELL_STYLE = {
    padding: "5px 8px",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
};

const FOOTER_STYLE = {
    flex: "none",
    display: "flex",
    justifyContent: "space-between",
    padding: "12px 20px 16px",
};

const BUTTON_GROUP_STYLE = {display: "flex", gap: "10px"};

// Status column colors
const STATUS_COLORS = {connected: "#3cc83c", connecting: "#e0a800"};

/**
 * Status column text for a device
 * @param {Object} device
 * @param {{state: String, host?: String}} consoleStatus
 * @returns {{text: String, color?: String}}
 */
const device_status = (device, consoleStatus) => {
    if (consoleStatus.host === device.ip && consoleStatus.state !== 'disconnected') {
        return consoleStatus.state === 'connected'
            ? {text: "Connected", color: STATUS_COLORS.connected}
            : {text: "Connecting...", color: STATUS_COLORS.connecting};
    }

    if (device.placeholder) return {text: "Not found yet"};

    return {text: `Found ${device.timestamp}`};
}

const Settings = () => {
    const [devices, setDevices] = useState([]);
    const [selRow, setSelRow] = useState(-1);
    const [status, setStatus] = useState("");
    const [connecting, setConnecting] = useState(false);
    const [searching, setSearching] = useState(false);
    const [consoleStatus, setConsoleStatus] = useState({state: 'disconnected'});

    // StudioLive mute group buttons: what's saved, and the edits not applied yet
    const [buttonSetup, setButtonSetup] = useState(null);
    const [pendingButtons, setPendingButtons] = useState({});
    const [buttonsDirty, setButtonsDirty] = useState(false);
    const [flashes, setFlashes] = useState({});
    const buttonsDirtyRef = useRef(false);
    buttonsDirtyRef.current = buttonsDirty;

    // DCA Recall preferences: edits not applied yet
    const [recall, setRecall] = useState(null);
    const [recallDirty, setRecallDirty] = useState(false);

    const editRecall = (next) => {
        setRecall(next);
        setRecallDirty(true);
    }

    /**
     * Re-read the button setup (keeps unapplied edits)
     */
    const loadButtonSetup = async () => {
        const setup = await window.consoleSetupApi.get();
        setButtonSetup(setup);
        if (!buttonsDirtyRef.current) setPendingButtons(setup.map);
    }

    const editButtons = (next) => {
        setPendingButtons(next);
        setButtonsDirty(true);
    }

    /**
     * Save the mute group button edits into the show
     */
    const apply = async () => {
        if (recallDirty) {
            setRecall(await window.consoleSetupApi.setRecall(recall));
            setRecallDirty(false);
            if (!buttonsDirty) setStatus("Preferences saved.");
        }

        if (!buttonsDirty) return;

        const setup = await window.consoleSetupApi.setButtonMap(pendingButtons);
        setButtonSetup(setup);
        setPendingButtons(setup.map);
        setButtonsDirty(false);
        setStatus("Buttons saved to the show. Save the show (⌘S) to keep them.");
    }

    // Cancel discards unapplied edits
    const close = () => {
        window.close();
    }

    const disconnect = () => {
        window.presonus.disconnect();
        setStatus("Disconnected.");
    }

    /**
     * OK: apply button edits, then connect to the selected console (if it isn't
     * already the connected one) and close
     * @param {Number} row device row (defaults to the selected one)
     */
    const ok = async (row = selRow) => {
        if (connecting) { return; }

        await apply();

        const board = devices[row];
        const alreadyConnected = board && consoleStatus.state !== 'disconnected' && consoleStatus.host === board.ip;

        if (!board || alreadyConnected) {
            window.close();
            return;
        }

		if (!is_ip_valid(board.ip)) {
			setStatus(`Invalid IP address '${board.ip}'`);
		}
		else {
			console.log(`Connecting to console at '${board.ip}' on port ${board.port}.`)

			setConnecting(true);
			setStatus(`Connecting to ${board.ip}...`);

			try {
				const result = await window.presonus.connect(
					board.ip,
					board.port,
					board.placeholder ? undefined : board.name,
					board.placeholder ? undefined : board.serial
				);

				console.log('Connection result:', result);

				if (result?.ok) {
					window.close();
				} else {
					setStatus(`Connection failed: ${result?.error ?? "Unknown error"}`);
				}
			} catch (error) {
				console.error('Connection failed:', error);
				setStatus(`Connection failed: ${error.message}`);
			} finally {
				setConnecting(false);
			}
		}
    }

    const start_discovery = async () => {
        // Placeholder row until a real console announces itself
        setDevices([{
			name: "StudioLive 32 Hayden (placeholder)",
			serial: "SD3E19010055",
			ip: "169.254.4.171",
			port: 53000,
			timestamp: "-",
			placeholder: true
		}]);
        setSelRow(-1);
        setSearching(true);
        setStatus("Searching for consoles...");

        const {devices: found, error} = await window.presonus.discover(10000);

        console.log("[Settings.jsx]: ", found, error);
        setSearching(false);

        if (error) {
            setStatus(error);
        } else if (found.length === 0) {
            setStatus("No consoles found. On macOS, make sure Local Network access is allowed for this app.");
        } else {
            setStatus("");
        }
    }

    // Show consoles as soon as they are found, then discover on mount
    useEffect(() => {
        window.presonus.onDeviceFound((device) => {
            setDevices((prev) => [
                ...prev.filter((d) => !d.placeholder && d.serial !== device.serial),
                device
            ]);
        });

        // Connecting / disconnecting changes what we know about the mute groups
        const unsubscribeStatus = window.presonus.onStatus((status) => {
            setConsoleStatus(status);
            loadButtonSetup();
        });
        window.presonus.getStatus().then(setConsoleStatus);

        // Mute group names / channels changed on the console, or the show's map changed
        const unsubscribeChanged = window.consoleSetupApi.onChanged(loadButtonSetup);

        // Light up a button when it's pressed on the console
        const unsubscribeActivity = window.consoleSetupApi.onButtonActivity(({group, pressed, fired}) => {
            if (!pressed) return;
            const at = Date.now();
            setFlashes((prev) => ({...prev, [group]: {fired, at}}));
            setTimeout(() => setFlashes((prev) => prev[group]?.at === at ? (({[group]: _, ...rest}) => rest)(prev) : prev), FLASH_MS);
        });

        loadButtonSetup();
        window.consoleSetupApi.getRecall().then(setRecall);
        start_discovery();

        return () => {
            window.presonus.removeDeviceFoundListener();
            unsubscribeStatus();
            unsubscribeChanged();
            unsubscribeActivity();
        };
    }, [])

    // Enter = OK, Escape = Cancel, like a native dialog
    useEffect(() => {
        const handleKey = (event) => {
            if (event.key === 'Escape') close();
            // (not while picking from a dropdown with the keyboard)
            if (event.key === 'Enter' && event.target.tagName !== 'SELECT') ok();
        };

        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [selRow, devices, connecting, buttonsDirty, pendingButtons, consoleStatus, recall, recallDirty]);

    const isConnected = consoleStatus.state !== 'disconnected';

    return (
        <div style={WINDOW_STYLE}>
            <div style={TITLE_BAR_STYLE}>Console Setup</div>

            <div style={BODY_STYLE}>
                <div style={LIST_STYLE}>
                    <table style={TABLE_STYLE}>
                        <colgroup>
                            <col/>
                            <col style={{width: "22%"}}/>
                            <col style={{width: "19%"}}/>
                            <col style={{width: "10%"}}/>
                            <col style={{width: "18%"}}/>
                        </colgroup>
                        <thead>
                            <tr>
                                <th style={HEADER_CELL_STYLE}>Model</th>
                                <th style={HEADER_CELL_STYLE}>Serial</th>
                                <th style={HEADER_CELL_STYLE}>IP Address</th>
                                <th style={HEADER_CELL_STYLE}>Port</th>
                                <th style={{...HEADER_CELL_STYLE, borderRight: "none"}}>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {devices.map((device, index) => {
                                const deviceStatus = device_status(device, consoleStatus);

                                return (
                                    <tr
                                        key={device.serial ?? index}
                                        style={{
                                            backgroundColor: selRow == index ? SELECTED_COLOR : (index % 2 ? "rgb(43, 43, 43)" : "transparent"),
                                            cursor: "default",
                                        }}
                                        onClick={() => setSelRow(index)}
                                        onDoubleClick={() => { setSelRow(index); ok(index); }}
                                    >
                                        <td style={CELL_STYLE} title={device.name}>{device.name}</td>
                                        <td style={CELL_STYLE}>{device.serial}</td>
                                        <td style={CELL_STYLE}>{device.ip}</td>
                                        <td style={CELL_STYLE}>{device.port}</td>
                                        <td style={{...CELL_STYLE, color: selRow == index ? TEXT_COLOR : deviceStatus.color}}>{deviceStatus.text}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                <div style={{minHeight: "1.3em", fontSize: 13, textAlign: "center", opacity: 0.85}}>{status}</div>

                <div style={{...BUTTON_GROUP_STYLE, justifyContent: "center", alignItems: "center"}}>
                    <label style={{display: "flex", alignItems: "center", gap: "6px", fontSize: 13, marginRight: "10px"}}
                        title="When the app opens, connect to the last console if it's found on the network">
                        <input
                            type="checkbox"
                            checked={recall?.autoConnect ?? true}
                            disabled={recall === null}
                            onChange={(e) => editRecall({...recall, autoConnect: e.target.checked})}
                        />
                        Connect automatically on launch
                    </label>
                    <button className="dialog-button" onClick={start_discovery} disabled={searching}>Rescan</button>
                    {/* Not built yet */}
                    <button className="dialog-button" disabled>Manual...</button>
                    <button className="dialog-button" disabled>Advanced...</button>
                </div>

                <MuteGroupButtons
                    setup={buttonSetup}
                    pending={pendingButtons}
                    onChange={editButtons}
                    flashes={flashes}
                />

                <DcaRecallOptions values={recall} onChange={editRecall}/>
            </div>

            <div style={FOOTER_STYLE}>
                <span style={BUTTON_GROUP_STYLE}>
                    <button className="dialog-button" onClick={disconnect} disabled={!isConnected}>Disconnect</button>
                    <button className="dialog-button" onClick={apply} disabled={!buttonsDirty && !recallDirty}>Apply</button>
                </span>
                <span style={BUTTON_GROUP_STYLE}>
                    <button className="dialog-button" onClick={close}>Cancel</button>
                    <button className="dialog-button primary" onClick={() => ok()} disabled={connecting}>
                        {connecting ? "Connecting..." : "OK"}
                    </button>
                </span>
            </div>
        </div>
    );
}

export default Settings;
