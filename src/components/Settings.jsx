import React, { useState, useEffect } from 'react';

import { is_ip_valid } from '../utils/ip_tools';

import { TEXT_COLOR, SELECTED_COLOR } from './utils/colors.jsx';

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
    minHeight: 0,
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

// Status column colours
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

    const close = () => {
        window.close();
    }

    const disconnect = () => {
        window.presonus.disconnect();
        setStatus("Disconnected.");
    }

    /**
     * Connect to a console
     * @param {Number} row device row (defaults to the selected one)
     */
    const ok = async (row = selRow) => {
        if (row == -1 || connecting) { return; }

        let board = devices[row];

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
					board.placeholder ? undefined : board.name
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

        const unsubscribeStatus = window.presonus.onStatus(setConsoleStatus);
        window.presonus.getStatus().then(setConsoleStatus);

        start_discovery();

        return () => {
            window.presonus.removeDeviceFoundListener();
            unsubscribeStatus();
        };
    }, [])

    // Enter = OK, Escape = Cancel, like a native dialog
    useEffect(() => {
        const handleKey = (event) => {
            if (event.key === 'Escape') close();
            if (event.key === 'Enter') ok();
        };

        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [selRow, devices, connecting]);

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

                <div style={{...BUTTON_GROUP_STYLE, justifyContent: "center"}}>
                    <button className="dialog-button" onClick={start_discovery} disabled={searching}>Rescan</button>
                    {/* Not built yet */}
                    <button className="dialog-button" disabled>Manual...</button>
                    <button className="dialog-button" disabled>Advanced...</button>
                </div>
            </div>

            <div style={FOOTER_STYLE}>
                <span style={BUTTON_GROUP_STYLE}>
                    <button className="dialog-button" onClick={disconnect} disabled={!isConnected}>Disconnect</button>
                    {/* Not built yet */}
                    <button className="dialog-button" disabled>Apply</button>
                </span>
                <span style={BUTTON_GROUP_STYLE}>
                    <button className="dialog-button" onClick={close}>Cancel</button>
                    <button className="dialog-button primary" onClick={() => ok()} disabled={selRow == -1 || connecting}>
                        {connecting ? "Connecting..." : "OK"}
                    </button>
                </span>
            </div>
        </div>
    );
}

export default Settings;
