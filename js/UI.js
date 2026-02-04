// js/ui.js
import { sendSocketMessage, startNetwork } from './Network.js';
import { apiCreateTask, apiUpdateTask, apiDeleteTask, apiGetTasks } from './api.js';
import { apiLogin, apiRegister, setAuthToken } from './api.js';
import { addTaskToDB, deleteTaskFromDB, updateDB, db, getAllTasksFromDB, updateTaskSyncStatusInDB } from './DB.js';
import { blobToBase64, base64ToBlob } from './utilities.js';
// --- DOM ELEMENTS ---
export const loginOverlay = document.getElementById('login-overlay');
export const usernameInput = document.getElementById('username-input');
const btnLogin = document.getElementById('btn-login');

// Task Lists
const taskList = document.getElementById('task-list');
const completedList = document.getElementById('completed-task-list');

// Inputs
const taskInput = document.getElementById('task-input');
const fileInput = document.getElementById('file-input');
const btnAdd = document.getElementById('btn-add-task');
const btnAddImg = document.getElementById('btn-add-img');

// Modals & Notifications
const notificationArea = document.getElementById('notification-area');
const shareModal = document.getElementById('share-modal');
const agentListUI = document.getElementById('agent-list-ui');
const btnCloseShare = document.getElementById('btn-close-share'); // "Abort Mission" button

const infoModal = document.getElementById('info-modal');
const modalTitle = document.getElementById('modal-title');
const modalContent = document.getElementById('modal-content');

const editModal = document.getElementById('edit-modal');
const editInput = document.getElementById('edit-input');
const editFileInput = document.getElementById('edit-file-input');
const editImagePreview = document.getElementById('edit-image-preview');
const btnSaveEdit = document.getElementById('btn-save-edit');
const btnCancelEdit = document.getElementById('btn-cancel-edit');

// --- STATE ---
export let currentUser = localStorage.getItem('username') || "Agent_Unknown";
export let isSharingFlow = false;
let taskToShareBuffer = null;
let currentEditingId = null;

export function resetSharingFlow() { isSharingFlow = false; }

// --- INITIALIZATION ---
export async function initUI() {
    const token = localStorage.getItem('authToken');
    const savedUser = localStorage.getItem('username');

    if (token && savedUser) {
        currentUser = savedUser;
        setAuthToken(token); 
        if(loginOverlay) loginOverlay.classList.add('hidden');
        
        // 1. Load Local Data
        const tasks = await getAllTasksFromDB(); 
        tasks.forEach(t => addTaskToDOM(t));
        
        // 2. Try to sync with Server
        try {
            const serverTasks = await apiGetTasks(); 
            console.log("Server tasks loaded:", serverTasks.length);
        } catch (err) {
            console.warn("Startup Sync Failed:", err);
            
            // --- NEW: HANDLE INVALID TOKEN ---
            // If the server says "Who are you?" (403), we must log out.
            if (err.message.includes('403') || err.message.includes('Invalid Token')) {
                console.error("Token expired or invalid. Logging out...");
                handleLogout(); // Call the logout helper
                return; // Stop execution (don't start network)
            }
            
            // If it's just a network error (server down), show offline mode
            showNotification(" Offline Mode: Server unavailable");
        }
        
        // 3. Start Network (Only if token was valid)
        startNetwork();
    } else {
        if(loginOverlay) loginOverlay.classList.remove('hidden');
        injectPasswordInput(); 
    }
    setupEventListeners();
}

//helper
function handleLogout() {
    // 1. Clear credentials
    localStorage.removeItem('authToken');
    localStorage.removeItem('username');
    setAuthToken(null);
    
    // 2. Show Login Screen
    if(loginOverlay) loginOverlay.classList.remove('hidden');
    injectPasswordInput();
    
    // 3. Stop Network & Reset State
    // (Optional: You might want to clear the displayed tasks too)
    showNotification("🔒 Session Expired. Please Login Again.");
}

function injectPasswordInput() {
    // Quick hack to add a password field if it doesn't exist in your HTML
    if (!document.getElementById('password-input')) {
        const input = document.createElement('input');
        input.type = 'password';
        input.id = 'password-input';
        input.placeholder = 'Enter Password';
        input.className = 'login-input'; // Match your username-input style
        usernameInput.parentNode.insertBefore(input, btnLogin);
    }
}

// --- EVENT LISTENERS ---
function setupEventListeners() {
    // 1. Login
    if (btnLogin) {
        btnLogin.addEventListener('click', async () => {
            const name = usernameInput.value.trim();
            const pass = document.getElementById('password-input').value.trim();
            
            if (name && pass) {
                try {
                    // Try to Login
                    const data = await apiLogin(name, pass);
                    finishLogin(data.token, data.username);
                } catch (err) {
                    // If login fails, try to Register (Auto-register for simplicity)
                    try {
                        await apiRegister(name, pass);
                        const data = await apiLogin(name, pass);
                        finishLogin(data.token, data.username);
                        showNotification(" Account Created!");
                    } catch (regErr) {
                        showNotification(" Login Failed");
                    }
                }
            }
        });
    }

    // 2. Add Task
    if (btnAdd) btnAdd.addEventListener('click', () => {
        const text = taskInput.value.trim();
        if (text) { createTask(text, 'text', null); taskInput.value = ''; }
    });

    // 3. Add Image
    if (btnAddImg) btnAddImg.addEventListener('click', () => fileInput.click());
    if (fileInput) fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        const text = taskInput.value.trim() || "Image Evidence";
        if (file) { createTask(text, 'image', file); fileInput.value = ''; taskInput.value = ''; }
    });

    // 4. Task Clicks (Delegation for Delete, Edit, Info, Share, Check)
    if (taskList) taskList.addEventListener('click', handleTaskClick);
    if (completedList) completedList.addEventListener('click', handleTaskClick);

    // 5. Agent Picker Click
    if (agentListUI) {
        agentListUI.addEventListener('click', (e) => {
            if (e.target.closest('.agent-select-btn')) {
                const agent = e.target.closest('.agent-select-btn').dataset.agent;
                performTargetedShare(agent);
            }
        });
    }

    // 6. Share Modal "Abort"
    if (btnCloseShare) btnCloseShare.addEventListener('click', () => shareModal.close());

    // 7. Edit Modal Actions
    if (btnCancelEdit) btnCancelEdit.addEventListener('click', () => editModal.close());
    if (btnSaveEdit) btnSaveEdit.addEventListener('click', saveEdit);

    const searchBar = document.getElementById('search-bar');
    if (searchBar) {
        // Restore previous search if exists
        const savedSearch = sessionStorage.getItem('missionSearch');
        if (savedSearch) {
            searchBar.value = savedSearch;
            setTimeout(() => applySearch(savedSearch), 300);
        }

        searchBar.addEventListener('input', (e) => {
            const term = e.target.value.toLowerCase();
            sessionStorage.setItem('missionSearch', term);
            applySearch(term);
        });
    }

    // --- NEW: 9. STRESS TEST ---
    const btnStress = document.getElementById('btn-stress');
    if (btnStress) {
    btnStress.addEventListener('click', () => {
        showNotification("Initiating Shadow Stress Test (1k Nodes)...");
        
        // 1. Create the 'Host' Element
        // This is the only element that will actually touch your real DOM
        const shadowHost = document.createElement('div');
        shadowHost.id = 'stress-test-container';
        shadowHost.style.marginTop = '20px';
        shadowHost.style.border = '2px dashed #ff1744'; // Visual boundary

        // 2. Attach the Shadow Root (Open Mode)
        // This creates a separate DOM tree attached to the host
        const shadowRoot = shadowHost.attachShadow({ mode: 'open' });

        // 3. Inject Styles (Critical!)
        // Shadow DOM blocks global CSS. We must inject styles locally so the nodes aren't invisible/ugly.
        const styleSheet = document.createElement('style');
        styleSheet.textContent = `
            :host { display: block; padding: 10px; }
            .stress-node {
                background: #2a0a0a;
                color: #ff5252;
                padding: 5px;
                margin-bottom: 2px;
                font-family: monospace;
                font-size: 0.8rem;
                border-bottom: 1px solid #ff1744;
            }
        `;
        shadowRoot.appendChild(styleSheet);

        // 4. Generate the 1,000 Nodes
        const fragment = document.createDocumentFragment();
        for (let i = 0; i < 1000; i++) {
            const div = document.createElement('div');
            div.className = 'stress-node'; 
            div.innerText = `[SHADOW NODE] System Load Test #${i}`;
            fragment.appendChild(div);
        }
        
        // 5. Append Fragment to Shadow Root
        shadowRoot.appendChild(fragment);

        // 6. Mount Host to Real DOM
        const taskList = document.getElementById('task-list');
        if(taskList) {
            // We append the HOST, not the 1000 nodes
            taskList.appendChild(shadowHost);
        }

        // 7. Cleanup (The Best Part)
        // We simply remove the host, and the browser garbage collects the entire tree.
        setTimeout(() => {
            shadowHost.remove(); // <--- O(1) Removal operation
            showNotification(" Stress Test Complete: Shadow Tree Purged.");
        }, 1500); // Increased to 1.5s so you can see it
    });
    }

    // --- NEW: 10. ARCHIVE (WORKER) ---
    const btnArchive = document.getElementById('btn-archive');
    if (btnArchive) {
        btnArchive.addEventListener('click', () => {
             // 1. Get completed tasks
            const tx = db.transaction(['tasks'], 'readonly');
            tx.objectStore('tasks').getAll().onsuccess = async (e) => {
                const completedTasks = e.target.result.filter(t => t.completed);
                if (completedTasks.length === 0) return showNotification(" No completed tasks to archive.");

                showNotification(" Encrypting & Archiving...");

                const tasksSafeForWorker = await Promise.all(completedTasks.map(async (t) => {
                    const copy = { ...t }; // Clone it
                    if (copy.type === 'image' && copy.blob) {
                        copy.imageBase64 = await blobToBase64(copy.blob); // Convert to String
                        delete copy.blob; // Remove the Blob (it creates bugs in JSON)
                    }
                    return copy;
                }));
                
                // Initialize Worker (Pointing to 'js' folder)
                const worker = new Worker('js/worker.js');
                
                // Send data
                worker.postMessage({ type: 'encrypt', payload: tasksSafeForWorker });

                // Listen for result
                worker.onmessage = (msg) => {
                    if (msg.data.type === 'encrypt_complete') {
                        // Save Vault to DB
                        const writeTx = db.transaction(['archives', 'tasks'], 'readwrite');
                        writeTx.objectStore('archives').put({ id: 'latest_vault', ...msg.data.result });
                        
                        // Delete original tasks
                        const taskStore = writeTx.objectStore('tasks');
                        completedTasks.forEach(task => {
                            taskStore.delete(task.id);
                            const card = document.querySelector(`[data-id="${task.id}"]`);
                            if(card) card.remove();
                        });

                        showNotification(" Archive Securely Encrypted.");
                        worker.terminate();
                    }
                };
            };
        });
    }

    // --- NEW: 11. UNARCHIVE (DECRYPT) ---
    const btnUnarchive = document.getElementById('btn-unarchive');
    if (btnUnarchive) {
        btnUnarchive.addEventListener('click', () => {
            const tx = db.transaction(['archives'], 'readonly');
            tx.objectStore('archives').get('latest_vault').onsuccess = (e) => {
                if (!e.target.result) return showNotification(" No archived vault found.");

                showNotification(" Decrypting Vault...");
                const worker = new Worker('js/worker.js');
                worker.postMessage({ type: 'decrypt', payload: e.target.result });

                worker.onmessage = (msg) => {
                    if (msg.data.type === 'decrypt_complete') {

                        const restoredTasks = msg.data.result.map(task => {
                            // If it has image data, convert Base64 String back to Blob
                            if (task.type === 'image' && task.imageBase64) {
                                task.blob = base64ToBlob(task.imageBase64);
                                delete task.imageBase64; // Clean up
                            }
                            return task;
                        });


                        // Restore Tasks
                        restoredTasks.forEach(task => {
                            addTaskToDB(task);
                            addTaskToDOM(task);
                        });
                        showNotification(" Vault Decrypted & Restored.");
                        worker.terminate();
                    }
                };
            };
        });
    }
}

function finishLogin(token, username) {
    currentUser = username;
    localStorage.setItem('username', currentUser);
    setAuthToken(token); // Save token
    
    loginOverlay.classList.add('hidden');
    startNetwork();
    showNotification(`Welcome back, Agent ${username}`);
}


// --- CORE FUNCTIONS ---

async function createTask(text, type, blobData) {
    const newTask = {
        id: Date.now() + '-' + Math.floor(Math.random() * 1000),
        text: text, type: type, blob: blobData, 
        synced: false, // <--- CHANGE: Always start as False (Yellow)
        completed: false, username: currentUser, createdAt: new Date().toLocaleString()
    };
    
    // 1. Save Local & Render (Yellow/Unsynced)
    addTaskToDB(newTask);
    addTaskToDOM(newTask);
    
    // 2. Send to Server
    if (navigator.onLine) {
        let payload = { ...newTask };
        if (type === 'image' && blobData) { 
            payload.imageBase64 = await blobToBase64(blobData); 
            delete payload.blob; 
        }
        
        // NEW: Handle the Success to turn it Green
        apiCreateTask(payload)
            .then(() => {
                // Server said OK! Now we make it Green.
                updateDB(newTask.id, { synced: true }); // Update DB
                
                // Update UI Card
                const card = document.querySelector(`[data-id="${newTask.id}"]`);
                if (card) {
                    card.classList.add('synced');
                    const status = card.querySelector('.status-text');
                    if(status) {
                        status.innerText = "SYNCED";
                        status.className = "status-text status-synced";
                    }
                }
                console.log("✅ Task Synced via API");
            })
            .catch(err => {
                console.warn("❌ Create failed (Offline/Error):", err);
                // It stays Yellow, which is correct!
            });
    }
}

export function addTaskToDOM(task) {
    const li = document.createElement('li');
    li.className = `task-card ${task.synced ? 'synced' : ''}`;
    li.dataset.id = task.id;
    
    const isChecked = task.completed ? 'checked' : '';
    const statusClass = task.synced ? 'status-synced' : 'status-unsynced';
    const statusLabel = task.synced ? 'SYNCED' : 'UNSYNCED';
    const shareBtnHtml = `<button class="icon-btn share-btn" title="Share">📤</button>`;

    let contentHtml = `<span class="task-text">${task.text}</span>`;
    if (task.type === 'image' && task.blob) {
        contentHtml = `
            <div class="task-content-wrapper">
                <img src="${URL.createObjectURL(task.blob)}" class="task-image">
                <span class="task-text">${task.text}</span>
            </div>`;
    }

    // FIXED: Added 'edit-btn' back into the HTML
    li.innerHTML = `
        <input type="checkbox" class="task-check" ${isChecked}>
        ${contentHtml}
        <div class="task-meta-container">
            ${shareBtnHtml} 
            <span class="status-text ${statusClass}">${statusLabel}</span>
        </div>
        <button class="icon-btn info-btn">ℹ️</button>
        <button class="icon-btn edit-btn">✏️</button>
        <button class="icon-btn delete-btn">🗑️</button>
    `;
    
    if (task.completed) { if(completedList) completedList.appendChild(li); } 
    else { if(taskList) taskList.appendChild(li); }
}

function handleTaskClick(e) {
    const target = e.target;
    const card = target.closest('.task-card');
    if (!card) return;
    const id = card.dataset.id;

    // A. SHARE (Keep on WebSocket - This is P2P signaling)
    if (target.classList.contains('share-btn')) {
        if (!navigator.onLine) { showNotification("⚠️ Offline."); return; }
        isSharingFlow = true;
        const tx = db.transaction(['tasks'], 'readonly');
        tx.objectStore('tasks').get(id).onsuccess = (ev) => {
            taskToShareBuffer = ev.target.result;
            sendSocketMessage({ type: 'request_agent_list' });
        };
    }

    // B. INFO (Local DB Read - No Change)
    if (target.classList.contains('info-btn')) {
        const tx = db.transaction(['tasks'], 'readonly');
        tx.objectStore('tasks').get(id).onsuccess = (ev) => {
            const t = ev.target.result;
            if(!t) return;
            modalTitle.innerText = "MISSION INTEL";
            modalContent.innerHTML = `
                <p><strong>ID:</strong> ${id}</p>
                <p><strong>Owner:</strong> ${t.username}</p>
                <p><strong>Created:</strong> ${t.createdAt}</p>
                <p><strong>Status:</strong> ${t.completed ? "Completed" : "Active"}</p>
            `;
            infoModal.showModal();
        };
    }

    // C. EDIT (Opens Modal - No Change here, save happens in saveEdit)
    if (target.classList.contains('edit-btn')) {
        currentEditingId = id;
        const tx = db.transaction(['tasks'], 'readonly');
        tx.objectStore('tasks').get(id).onsuccess = (ev) => {
            const t = ev.target.result;
            if(!t) return;
            editInput.value = t.text;
            if (t.type === 'image') {
                editImagePreview.style.display = 'block';
                editImagePreview.src = URL.createObjectURL(t.blob);
            } else {
                editImagePreview.style.display = 'none';
            }
            editModal.showModal();
        };
    }

    // D. CHECKBOX (Moved to API)
    if (target.classList.contains('task-check')) {
    const isCompleted = target.checked;
        
        // 1. Optimistic Update (Visuals only) -> Sets it to Yellow initially
        updateDB(id, { completed: isCompleted, synced: false }); 
        card.remove(); 

        // 2. Re-render in the correct list
        // This creates a NEW DOM element in the 'Completed' list (which is currently Yellow/Unsynced)
        const tx = db.transaction(['tasks'], 'readonly');
        tx.objectStore('tasks').get(id).onsuccess = (ev) => {
            const t = ev.target.result; 
            if(t) { t.completed = isCompleted; addTaskToDOM(t); }
        };

        // 3. Try to Sync with Server
        if (navigator.onLine) {
            apiUpdateTask({ id: id, completed: isCompleted })
                .then(() => {
                    // ✅ SUCCESS! Server responded.
                    
                    // A. Update DB to true
                    updateTaskSyncStatusInDB(id, true); // (Or use updateDB(id, { synced: true }))

                    // B. FIND THE NEW CARD and make it Green
                    // We must search again because the old 'card' variable refers to the removed element
                    const newCard = document.querySelector(`[data-id="${id}"]`);
                    
                    if (newCard) {
                        newCard.classList.add('synced'); // Add green border
                        
                        const status = newCard.querySelector('.status-text');
                        if(status) {
                            status.innerText = "SYNCED";
                            status.classList.remove('status-unsynced');
                            status.classList.add('status-synced');
                        }
                    }

                    // C. Broadcast
                    sendSocketMessage({ 
                        type: 'broadcast_action', 
                        action: isCompleted ? 'completed' : 're-opened',
                        username: currentUser,
                        taskId: id
                    });
                })
                .catch(err => {
                    console.warn("Sync failed, keeping as Unsynced:", err);
                });
        }
    }
    // E. DELETE (Moved to API)
    if (target.classList.contains('delete-btn')) {
        // 1. Local Delete
        deleteTaskFromDB(id);
        card.remove();

        // 2. Send to Server via CRUD API
        if (navigator.onLine) {
            // OLD: sendSocketMessage({ type: 'delete_task', ... });
            // NEW:
            apiDeleteTask(id);
        }
    }
}

async function saveEdit() {
    if (!currentEditingId) return;
    const newText = editInput.value.trim();
    const newFile = editFileInput.files[0];
    
    // 1. Get current task
    const tx = db.transaction(['tasks'], 'readwrite'); // Use readwrite immediately
    const store = tx.objectStore('tasks');
    
    store.get(currentEditingId).onsuccess = async (e) => {
        const task = e.target.result;
        if(!task) return;

        // 2. Prepare Updates
        const updates = { synced: false };
        if (newText) updates.text = newText;
        if (newFile) { updates.blob = newFile; updates.type = 'image'; }
        
        // 3. Save to DB
        Object.assign(task, updates);
        store.put(task);

        // 4. Update UI
        const card = document.querySelector(`[data-id="${currentEditingId}"]`);
        if (card) {
            card.querySelector('.task-text').innerText = newText || task.text;
            if(newFile) card.querySelector('.task-image').src = URL.createObjectURL(newFile);
            const status = card.querySelector('.status-text');
            if(status) {
                status.innerText = navigator.onLine ? 'SYNCED' : 'UNSYNCED';
                status.className = `status-text ${navigator.onLine ? 'status-synced' : 'status-unsynced'}`;
            }
        }

        // 5. Send to Server
        if (navigator.onLine) {
            let payload = { ...task, synced: true };
            // ... (blob logic) ...
            
            // OLD: sendSocketMessage(...)
            // NEW:
            apiUpdateTask(payload).then(() => {
                // Update DB to true
                updateDB(currentEditingId, { synced: true });
                
                // Update UI to Green
                const card = document.querySelector(`[data-id="${currentEditingId}"]`);
                if (card) {
                    const status = card.querySelector('.status-text');
                    if(status) {
                         status.innerText = 'SYNCED';
                         status.className = 'status-text status-synced';
                    }
                }
                 // Broadcast change to others
                 sendSocketMessage({ type: 'sync_task', task: payload });
            });
        }
    };
    editModal.close();
}

async function performTargetedShare(targetUser) {
    if (!taskToShareBuffer) return;
    let payload = { ...taskToShareBuffer };
    
    if (payload.type === 'image' && payload.blob) {
        payload.imageBase64 = await blobToBase64(payload.blob);
        delete payload.blob;
    }

    const success = sendSocketMessage({ type: 'targeted_share', targetUser: targetUser, task: payload });
    if(success) {
        shareModal.close();
        showNotification(`🚀 Sent to ${targetUser}`);
        taskToShareBuffer = null;
    }
}

export function showNotification(text) {
    const div = document.createElement('div');
    div.innerText = text;
    div.style.cssText = "background: #2979ff; color: white; padding: 12px; margin-bottom: 10px; border-radius: 6px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); animation: fadeIn 0.3s ease;";
    if(notificationArea) notificationArea.appendChild(div);
    setTimeout(() => div.remove(), 4000);
}

export function updateLED(id, color) { 
    const led = document.getElementById(id); 
    if(led) led.className = `led ${color}`; 
}

function applySearch(term) {
    const allTaskCards = document.querySelectorAll('.task-card');
    allTaskCards.forEach(card => {
        const textEl = card.querySelector('.task-text');
        if (textEl) {
            const text = textEl.innerText.toLowerCase();
            card.style.display = text.includes(term) ? 'flex' : 'none';
        }
    });
}