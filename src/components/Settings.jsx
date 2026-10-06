import React, { useState, useEffect, useRef } from 'react';

import { is_ip_valid } from '../utils/ip_tools';

import { BORDER_COLOR, TEXT_COLOR, HEADER_COLOR, SELECTED_COLOR } from './utils/colors.jsx';

const CONTAINER_STYLE = {
    height: "100%", 
    display: "flex", 
    justifyContent: "center", 
    alignItems: "center", 
    flexDirection: "column",
    padding: "6px"
};

const TABLE_STYLE = {
	width: '100%', 
    minHeight: 200,
    alignItems: "start",
	borderCollapse: 'collapse', 
	textAlign: 'left', 
	color: TEXT_COLOR,
	fontFamily: 'Arial',
    border: '2px solid ' + BORDER_COLOR,

}

const HEADER_ITEM_STYLE = {
	padding: '6px',
	border: '2px solid ' + BORDER_COLOR,
	borderBottom: '4px solid ' + BORDER_COLOR,
	textAlign: 'center',
}

const ROW_STYLE = {
	height: '30px!important',
	textAlign: 'center',
}


const BUTTON_STYLE = {
    display: "inline-block",
    fontFamily: "system-ui, -apple-system, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif",
    fontWeight: 400,
    lineHeight: 1.5,
    color: TEXT_COLOR,
    textAlign: "center",
    textDecoration: "none",
    verticalAlign: "middle",
    cursor: "pointer",
    userSelect: "none",
    backgroundColor: "transparent",
    border: "1px solid #6c757d",
    padding: "0.375rem 0.75rem 0.375rem 0.75rem",
    fontSize: "1rem",
    borderRadius: "0.375rem",
    transition: "color 0.15s ease-in-out, background-color 0.15s ease-in-out, border-color 0.15s ease-in-out, box-shadow 0.15s ease-in-out",
}

const DEFAULT_HOVER_STATE = {
    rescan:false, manual: false, advanced: false, 
    disconnect: false, apply: false, close: false, ok: true
};


// Reusable Alert Component
const Settings = () => {
    const rowRefs = useRef({});

    const [isHovered, setIsHovered] = useState(DEFAULT_HOVER_STATE);
    const [devices, setDevices] = useState([]);
    const [selRow, setSelRow] = useState(-1);
    
    const DISABLED_BTN_STYLE = {
        ...BUTTON_STYLE,
        opacity: 0.65
    };

    const RESCAN_BTN_STYLE = {
        ...BUTTON_STYLE,
        backgroundColor: isHovered.rescan ? "#6c757d" : "transparent"
    }

    const MANUAL_BTN_STYLE = {
        ...BUTTON_STYLE,
        backgroundColor: isHovered.manual ? "#6c757d" : "transparent",
    }

    const ADVANCED_BTN_STYLE = {
        ...BUTTON_STYLE,
        backgroundColor: isHovered.advanced ? "#6c757d" : "transparent",
    }

    const DISCONNECT_BTN_STYLE = {
        ...BUTTON_STYLE,
        backgroundColor: isHovered.disconnect ? "#6c757d" : "transparent"
    }

    const APPLY_BTN_STYLE = {
        ...BUTTON_STYLE,
        backgroundColor: isHovered.apply ? "#6c757d" : "transparent"
    }

    const CLOSE_BTN_STYLE = {
        ...BUTTON_STYLE,
        backgroundColor: isHovered.close ? "#6c757d" : "transparent"
    }

    const OK_BTN_STYLE = {
        ...BUTTON_STYLE,
        backgroundColor: isHovered.ok ? "#6c757d" : "transparent"
    }

    const rescan = () => {
        start_discovery();
    }

    const manual = () => {

    }

    const advanced = () => {
        
    }

    const disconnect = () => {
        
    }

    const apply = () => {
        
    }

    const close = () => {
        window.close();
    }
    
    const ok = async () => {
        if (selRow == -1) { return; }

        let board = devices[selRow];
        console.log(board);

		if (!is_ip_valid(board.ip)) {
			setValid(false);
		}
		else {
			console.log(`Connecting to console at '${board.ip}' on port ${board.port}.`)

			try {
				console.log('Connecting...');

				const result = await window.presonus.connect(
					board.ip,
					board.port
				);

				console.log('Connection result:', result);

                window.close();
			} catch (error) {
				console.error('Connection failed:', error);
			}
		}
    }

    const start_discovery = async () => {
        const clients = await window.presonus.discover(30000);

        setDevices(clients);
    }

    // Discover Clients on mount
    useEffect(() => {
        start_discovery();
    }, [])

    return (
        <>
            <div style={CONTAINER_STYLE}>
                <table style={TABLE_STYLE}>
		
                    {/* Table Header */}
                    <thead>
                        <tr style={{ backgroundColor: HEADER_COLOR }}>
                            <th style={HEADER_ITEM_STYLE}>Model</th>
                            <th style={HEADER_ITEM_STYLE}>Serial</th>
                            <th style={HEADER_ITEM_STYLE}>IP Address</th>
                            <th style={HEADER_ITEM_STYLE}>Port</th>
                            <th style={HEADER_ITEM_STYLE}>Status</th>
                        </tr>
                    </thead>
                    
                    {/* Table Body */}
                    <tbody>
                        {/* 3. Loop through your data array using .map() */}
                        {devices.map((device, index) => (
                            <tr 
                                key={index}
                                ref={(el) => (rowRefs.current[index] = el)}
                                style={{...ROW_STYLE, backgroundColor: selRow == index ? SELECTED_COLOR : ""}}
                                onClick={(e) => setSelRow(index)}
                            >
                                <td>{device.name}</td>
                                <td>{device.serial}</td>
                                <td>{device.ip}</td>
                                <td>{device.port}</td>
                                <td>{device.timestamp}</td>
                            </tr>
                        ))}
                    </tbody>

                </table>
                <br/>
                <span style={{display: "flex", gap: "30px"}}>
                    <button 
                        style={RESCAN_BTN_STYLE} 
                        onMouseEnter={() => setIsHovered({...DEFAULT_HOVER_STATE, rescan: true})}
                        onMouseLeave={() => setIsHovered({...DEFAULT_HOVER_STATE, rescan: false})}
                        onClick={rescan}
                    >
                        Rescan
                    </button>

                    <button 
                        style={DISABLED_BTN_STYLE} 
                        disabled
                        onMouseEnter={() => setIsHovered({...DEFAULT_HOVER_STATE, manual: true})}
                        onMouseLeave={() => setIsHovered({...DEFAULT_HOVER_STATE, manual: false})}
                        onClick={manual}
                    >
                        Manual...
                    </button>

                    <button 
                        style={DISABLED_BTN_STYLE} 
                        disabled
                        onMouseEnter={() => setIsHovered({...DEFAULT_HOVER_STATE, advanced: true})}
                        onMouseLeave={() => setIsHovered({...DEFAULT_HOVER_STATE, advanced: false})}
                        onClick={advanced}
                    >
                        Advanced...
                    </button>
                </span>
            </div>
            <div style={{position: "absolute", width:"100%", bottom: "10px", alignItems: "end", justifyContent: "space-between"}}>
                <div style={{display: "flex", padding: "10px", alignItems: "end", justifyContent: "space-between", boxSizing: "border-box"}}>

                    <span style={{display: "flex", gap: "15px"}}>
                        <button 
                            style={DISABLED_BTN_STYLE} 
                            disabled
                            onMouseEnter={() => setIsHovered({...DEFAULT_HOVER_STATE, disconnect: true})}
                            onMouseLeave={() => setIsHovered({...DEFAULT_HOVER_STATE, disconnect: false})}
                            onClick={disconnect}
                        >
                            Disconnect
                        </button>

                        <button 
                            style={DISABLED_BTN_STYLE} 
                            disabled
                            onMouseEnter={() => setIsHovered({...DEFAULT_HOVER_STATE, apply: true})}
                            onMouseLeave={() => setIsHovered({...DEFAULT_HOVER_STATE, apply: false})}
                            onClick={apply}
                        >
                            Apply
                        </button>
                    </span>
                    <span style={{display: "flex", gap: "15px"}}> 
                        <button
                            style={CLOSE_BTN_STYLE}
                            onMouseEnter={() => setIsHovered({...DEFAULT_HOVER_STATE, close: true})}
                            onMouseLeave={() => setIsHovered({...DEFAULT_HOVER_STATE, close: false})}
                            onClick={close}
                        >
                            Cancel
                        </button>

                        <button 
                            style={selRow != -1 ? OK_BTN_STYLE : DISABLED_BTN_STYLE} 
                            onMouseEnter={() => setIsHovered({...DEFAULT_HOVER_STATE, ok: true})}
                            onMouseLeave={() => setIsHovered({...DEFAULT_HOVER_STATE, ok: false})}
                            onClick={ok}
                            disabled={selRow == -1}
                        >
                            OK
                        </button>
                    </span>
                </div>
            </div>
        </>
    );
}

export default Settings;
