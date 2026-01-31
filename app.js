import { initDB } from './js/DB.js';
import { initUI } from './js/UI.js';
// 1. IMPORT NETWORK CONTROLS
import { startNetwork, stopNetwork } from './js/Network.js';

async function boot() {
    try {
        await initDB(); 
        await initUI(); 
        
        // 2. RESTORE THE EVENT LISTENERS
        window.addEventListener('online', () => {
            console.log(" Network Restored - Reconnecting...");
            startNetwork();
        });
        
        window.addEventListener('offline', () => {
            console.log(" Network Lost - Shutting Down Channels");
            stopNetwork();
        });

        console.log(" System Modularized & Online");
    } catch (err) {
        console.error("Critical System Failure:", err);
    }
}

boot();