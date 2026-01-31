// js/network.js
import { currentUser, updateLED, showNotification, addTaskToDOM, isSharingFlow, resetSharingFlow } from './UI.js';
import { addTaskToDB, updateTaskSyncStatusInDB, db } from './DB.js';
import { blobToBase64, base64ToBlob } from './utilities.js';
import { apiCreateTask, apiUpdateTask } from './api.js';

export let socket = null;
export let sseSource = null;
let shortPollInterval = null;
let isLongPolling = false;

export function startNetwork() {
    if (!navigator.onLine) { stopNetwork(); return; }

    // Reset connections
    if (socket) { socket.close(); socket = null; }
    if (sseSource) { sseSource.close(); sseSource = null; }
    clearInterval(shortPollInterval);

    // 1. WebSocket Setup
    socket = new WebSocket('ws://localhost:3000');
    
    socket.onopen = () => {
        console.log(" WS Connected");
        updateLED('led-ws', 'green');
        socket.send(JSON.stringify({ type: 'login', username: currentUser }));
        syncPendingChanges();
    };
    
    socket.onmessage = (event) => handleServerMessage(JSON.parse(event.data));
    
    socket.onclose = () => { 
        updateLED('led-ws', 'red'); 
        if(navigator.onLine) setTimeout(startNetwork, 3000); 
    };

    // 2. SSE Setup
    sseSource = new EventSource('http://localhost:3000/events');
    sseSource.onmessage = (e) => {
        const statsDisplay = document.getElementById('global-stats');
        if(statsDisplay) {
            statsDisplay.innerText = JSON.parse(e.data).totalTasks;
            statsDisplay.style.color = "#00e676";
        }
        updateLED('led-sse', 'green');
    };
    sseSource.onerror = () => { updateLED('led-sse', 'red'); sseSource.close(); };

    // 3. Start Polling
    startShortPolling();
    startLongPolling();
}

export function stopNetwork() {
    if (socket) { socket.close(); socket = null; }
    if (sseSource) { sseSource.close(); sseSource = null; }
    clearInterval(shortPollInterval);
    isLongPolling = false;
    
    updateLED('led-ws', 'red');
    updateLED('led-sse', 'red');
    updateLED('led-lp', 'red');
    updateLED('led-sp', 'red');
}

// --- SYNC LOGIC ---
async function syncPendingChanges() {
    if (!db) return;
    const tx = db.transaction(['tasks'], 'readonly');
    
    tx.objectStore('tasks').getAll().onsuccess = async (e) => {
        const pending = e.target.result.filter(t => t.synced === false);
        
        if (pending.length > 0) {
            let syncCount = 0;

            for (const task of pending) {
                if (!navigator.onLine) continue;

                try {
                    // STEP 1: Prepare Payload
                    let payloadTask = { ...task, synced: true, username: currentUser };
                    if (task.type === 'image' && task.blob) {
                        payloadTask.imageBase64 = await blobToBase64(task.blob);
                        delete payloadTask.blob;
                    }

                    // STEP 2: Use API instead of Socket
                    // We try Create first. If it exists, the server 'should' handle it, 
                    // but to be safe for offline edits, we also Update.
                    
                    // A. Ensure it exists on server
                    await apiCreateTask(payloadTask).catch(e => console.log("Task likely exists, moving to update"));
                    
                    // B. Ensure state is current (handles offline completions)
                    await apiUpdateTask(payloadTask);

                    // STEP 3: Update Local DB
                    await updateTaskSyncStatusInDB(task.id, true);
                    syncCount++;

                    // STEP 4: Fix UI (The Green Outline & Chip)
                    const card = document.querySelector(`[data-id="${task.id}"]`);
                    if (card) {
                        // FIX: Add the green border class
                        card.classList.add('synced'); 

                        const statusText = card.querySelector('.status-text');
                        if (statusText) {
                            statusText.innerText = 'SYNCED';
                            statusText.classList.remove('status-unsynced');
                            statusText.classList.add('status-synced');
                        }
                    }

                } catch (err) {
                    console.error(`Failed to sync task ${task.id}:`, err);
                }
            }

            // STEP 5: Restore the Missing Notification
            if (syncCount > 0) {
                showNotification(` Synced ${syncCount} offline tasks.`);
            }
        }
    };
}

// --- INCOMING MESSAGE ROUTER ---
async function handleServerMessage(data) {
    if (data.type === 'initial_sync') {
        data.tasks.forEach(task => {
            if (task.type === 'image' && task.imageBase64) {
                task.blob = base64ToBlob(task.imageBase64);
                delete task.imageBase64;
            }
            addTaskToDB(task);
            if (!document.querySelector(`[data-id="${task.id}"]`)) addTaskToDOM(task);
        });
    }

    if (data.type === 'global_notification') showNotification(data.text);

    if (data.type === 'incoming_shared_task') {
        const task = data.task;
        if (task.type === 'image' && task.imageBase64) {
            task.blob = base64ToBlob(task.imageBase64);
            delete task.imageBase64;
        }
        addTaskToDB(task);
        if (!document.querySelector(`[data-id="${task.id}"]`)) {
            addTaskToDOM(task);
            showNotification(`📡 New Intel from Agent ${data.sender}!`);
        }
    }

    if (data.type === 'agent_list') {
        const listUI = document.getElementById('agent-list-ui');
        const shareModal = document.getElementById('share-modal');
        if (!listUI) return;
        
        listUI.innerHTML = ''; 
        if (data.agents.length === 0) listUI.innerHTML = '<li style="color:#8b949e; padding:10px;">No other agents online...</li>';

        data.agents.forEach(agentName => {
            const li = document.createElement('li');
            const btn = document.createElement('button');
            btn.className = 'agent-select-btn';
            btn.innerHTML = `<span class="status-dot"></span> Agent: ${agentName}`;
            
            // We use a custom event or direct call logic here. 
            // Ideally, UI handles clicks, but we can emit event.
            // For simplicity, we attach a global function or imported function via UI
            // But since performTargetedShare needs socket, we export it from here and import it in UI.
            // Check UI.js for how we handle this click.
            btn.dataset.agent = agentName; 
            li.appendChild(btn);
            listUI.appendChild(li);
        });

        if (isSharingFlow) {
            shareModal.showModal();
            resetSharingFlow(); 
        }
    }
}

// --- POLLING ---
function startShortPolling() {
    shortPollInterval = setInterval(async () => {
        if (!navigator.onLine) return;
        try {
            const res = await fetch('http://localhost:3000/short-poll');
            if (res.ok) updateLED('led-sp', 'green');
            else throw new Error("Glitch");
        } catch (err) { updateLED('led-sp', 'yellow'); }
    }, 5000);
}

async function startLongPolling() {
    if (isLongPolling) return;
    isLongPolling = true;
    async function poll() {
        if (!navigator.onLine || !isLongPolling) { updateLED('led-lp', 'red'); return; }
        try {
            updateLED('led-lp', 'green');
            const res = await fetch('http://localhost:3000/long-poll');
            if (!res.ok) throw new Error("Timeout");
            if(isLongPolling) poll();
        } catch (err) {
            updateLED('led-lp', 'yellow');
            if(isLongPolling) setTimeout(poll, 3000);
        }
    }
    poll();
}

// Send function to be used by UI
export function sendSocketMessage(msg) {
    if(socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(msg));
        return true;
    }
    return false;
}