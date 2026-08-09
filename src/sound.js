import { app, BrowserWindow, ipcMain } from 'electron';

import { Client, Discovery } from '@featherbear/presonus-studiolive-api';

import {convert_ip_to_octets, is_ip_valid} from './utils/ip_tools';

import DCA from './types/dca';

// Global Presonus Client Object
let presonusClient = null;


/**
 * Handle Presonus Discovery
 */
ipcMain.handle('presonus:discover', async () => {
    const discovery = new Discovery();
    const devices = [];

    console.log("[SOUND:discover]: Discovering PreSonous Consoles on the Network!")

    return new Promise((resolve) => {
        discovery.on('discover', (device) => {
            devices.push(device);
        });

        discovery.start(3000);

        setTimeout(() => {
            resolve(devices);
        }, 3500);
    });
});

ipcMain.handle('presonus:connect', async (_event, { host, port }) => {
    console.log("[SOUND:connect]: Connecting to Sound Board at ip address: " + host + " on port " + port + ".")
    presonusClient = new Client({ host, port });

    await presonusClient.connect({
        clientDescription: 'Electron App',
    }).then(() => {

        // Set channel 1 fader to -6 dB over a duration of 3 seconds
        client.setChannelVolumeLogarithmic({
            type: 'LINE',
            channel: 1
        }, -6, 3000).then(() => {

            // Unmute channel 2
            client.unmute({
                type: 'LINE',
                channel: 2
            })
        })

        console.log(`Version ${client.state.get('global.mixer_version')}`);
    });
    

    return { connected: true };
});


/**
 * Set DCA on console
 * @param {Event} _event
 * @param {DCA} dca_object 
 */
const set_dta = async (_event, {dca_object}) => {
    console.log("[SOUND:set_dca]: Setting DCA #" + dca_object.number);
}

ipcMain.handle('presonus:set_dca', set_dta);

