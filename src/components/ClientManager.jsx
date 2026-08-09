import React, { useEffect, useState } from 'react'

import { is_ip_valid, ip_regex } from '../utils/ip_tools';

const mixers = await window.presonus.discover();

console.log(mixers);


const ClientManager = (params) => {

    const { client, setClient } = params;

    const [ consoleIP, setConsoleIP ] = useState("0.0.0.0");
    const [ valid, setValid ] = useState(false);
    const [ options, setOptions] = useState([]);
    

    /**
     * 
     * @param {Event} event 
     */
    const handle_ip_change = (event) => {
        const value = event.target.value;

        if (ip_regex(value)) {
            setConsoleIP(value);
        }

        if (is_ip_valid(value) !== valid) {
            setValid(is_ip_valid(value));
        }
    }

    const connect = async () => {
        if (!is_ip_valid(consoleIP)) {
            setValid(false);
        }
        else {
            console.log("Connecting to console at '" + consoleIP + "'.")

            try {
                console.log('Connecting...');

                const result = await window.presonus.connect(
                    consoleIP,
                    53000
                );

                console.log('Connection result:', result);
            } catch (error) {
                console.error('Connection failed:', error);
            }
        }
    }


    return <>
        <label style={{outlineColor: valid ? "black" : "red"}}>
            IP Address: 
            <input value={consoleIP} onChange={handle_ip_change} style={{outlineColor: valid ? "black" : "red"}}/>
        </label>
        <button onClick={connect}>Connect</button>

        {
            options.map((option, index) => (
                <h2 key={index}>{option}</h2>
            ))
        }
    </>;
}

export default ClientManager;