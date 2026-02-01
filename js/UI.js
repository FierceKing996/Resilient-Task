// js/ui.js
import { addTaskToDB, deleteTaskFromDB, updateDB, db, getAllTasksFromDB } from './DB.js';
import { blobToBase64 } from './utilities.js';
import { sendSocketMessage, startNetwork } from './Network.js';
import { apiCreateTask, apiUpdateTask, apiDeleteTask, apiGetTasks } from './api.js';
import { apiLogin, apiRegister, setAuthToken } from './api.js';
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
        
        // Load data
        const tasks = await getAllTasksFromDB(); 
        tasks.forEach(t => addTaskToDOM(t));
        
        // Sync fresh from server
        const serverTasks = await apiGetTasks(); 
        // (Optional: Merge logic here, for now just log it)
        console.log("Server tasks loaded:", serverTasks.length);
        
        startNetwork();
    } else {
        // Show Login
        if(loginOverlay) loginOverlay.classList.remove('hidden');
        injectPasswordInput(); // Add password field programmatically
    }
    setupEventListeners();
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
            showNotification(" Initiating Stress Test (1k Nodes)...");
            
            const fragment = document.createDocumentFragment();
            // Create 1000 dummy elements
            for (let i = 0; i < 1000; i++) {
                const li = document.createElement('li');
                li.className = 'task-card stress-node'; 
                li.innerHTML = `<span class="task-text">STRESS TEST NODE #${i}</span>`;
                fragment.appendChild(li);
            }
            
            const taskList = document.getElementById('task-list');
            if(taskList) taskList.appendChild(fragment);

            // Auto-cleanup after 1 second
            setTimeout(() => {
                const nodes = document.querySelectorAll('.stress-node');
                nodes.forEach(n => n.remove());
                showNotification(" Stress Test Complete: System Stable.");
            }, 1000);
        });
    }

    // --- NEW: 10. ARCHIVE (WORKER) ---
    const btnArchive = document.getElementById('btn-archive');
    if (btnArchive) {
        btnArchive.addEventListener('click', () => {
             // 1. Get completed tasks
            const tx = db.transaction(['tasks'], 'readonly');
            tx.objectStore('tasks').getAll().onsuccess = (e) => {
                const completedTasks = e.target.result.filter(t => t.completed);
                if (completedTasks.length === 0) return showNotification(" No completed tasks to archive.");

                showNotification(" Encrypting & Archiving...");
                
                // Initialize Worker (Pointing to 'js' folder)
                const worker = new Worker('js/worker.js');
                
                // Send data
                worker.postMessage({ type: 'encrypt', payload: completedTasks });

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
                        // Restore Tasks
                        msg.data.result.forEach(task => {
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
    // ... object creation ...
    const newTask = {
        id: Date.now() + '-' + Math.floor(Math.random() * 1000),
        text: text, type: type, blob: blobData, synced: navigator.onLine, 
        completed: false, username: currentUser, createdAt: new Date().toLocaleString()
    };
    
    // 1. Save Local
    addTaskToDB(newTask);
    addTaskToDOM(newTask);
    
    // 2. Send to Server via CRUD API (Instead of WebSocket)
    if (navigator.onLine) {
        let payload = { ...newTask };
        if (type === 'image' && blobData) { 
            payload.imageBase64 = await blobToBase64(blobData); 
            delete payload.blob; 
        }
        
        // OLD: sendSocketMessage({ type: 'add_task', task: payload });
        // NEW:
        apiCreateTask(payload).then(() => {
            console.log("Task synced via API");
            // Optionally update UI to show "Synced" state here
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
        
        // 1. Optimistic Local Update
        updateDB(id, { completed: isCompleted, synced: navigator.onLine });
        card.remove(); // Remove from current list (Active/Completed)
        
        // 2. Re-render in the correct list
        const tx = db.transaction(['tasks'], 'readonly');
        tx.objectStore('tasks').get(id).onsuccess = (ev) => {
             const t = ev.target.result; 
             if(t) { t.completed = isCompleted; addTaskToDOM(t); }
        };

        // 3. Send to Server via CRUD API
        if (navigator.onLine) {
        // A. Save the data securely via API
        apiUpdateTask({ id: id, completed: isCompleted });

        // B. Tell everyone else via WebSocket (The Missing Link)
        sendSocketMessage({ 
            type: 'broadcast_action', // Use a type your server listens for
            action: isCompleted ? 'completed' : 're-opened',
            username: currentUser,
            taskId: id
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
        const updates = { synced: navigator.onLine };
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
            if (payload.type === 'image' && payload.blob) {
                 payload.imageBase64 = await blobToBase64(payload.blob);
                 delete payload.blob;
            }
            sendSocketMessage({ type: 'sync_task', task: payload });
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