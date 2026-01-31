// js/db.js

export let db; // Export db instance so others can check if it exists

export function initDB() {
    return new Promise((resolve, reject) => {
        console.log(`💽 Initializing Database...`);
        const request = indexedDB.open('ResilientTaskDB', 4);

        request.onupgradeneeded = (e) => {
            db = e.target.result;
            if (!db.objectStoreNames.contains('tasks')) {
                db.createObjectStore('tasks', { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains('archives')) {
                db.createObjectStore('archives', { keyPath: 'id' });
            }
        };

        request.onsuccess = (e) => {
            db = e.target.result;
            console.log("✅ Database Engine Online");
            resolve(db);
        };

        request.onerror = (e) => reject(e);
    });
}

export function addTaskToDB(task) { 
    if(!db) return;
    const tx = db.transaction(['tasks'], 'readwrite');
    tx.objectStore('tasks').put(task); 
}

export function updateDB(id, updates) {
    if(!db) return;
    const tx = db.transaction(['tasks'], 'readwrite');
    const store = tx.objectStore('tasks');
    store.get(id).onsuccess = (e) => {
        const data = e.target.result;
        if(data) { 
            Object.assign(data, updates); 
            store.put(data);
        }
    };
}

export function deleteTaskFromDB(id) { 
    if(!db) return;
    db.transaction(['tasks'], 'readwrite').objectStore('tasks').delete(id); 
}

export function updateTaskSyncStatusInDB(id, synced) { 
    updateDB(id, { synced }); 
}

export async function getAllTasksFromDB() {
    if(!db) return [];
    return new Promise(resolve => {
        const tx = db.transaction(['tasks'], 'readonly');
        tx.objectStore('tasks').getAll().onsuccess = (e) => resolve(e.target.result);
    });
}