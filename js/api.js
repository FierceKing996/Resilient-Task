// js/api.js
const API_BASE = 'http://localhost:3000/api';
let authToken = localStorage.getItem('authToken') || null;

export function setAuthToken(token) {
    authToken = token;
    token ? localStorage.setItem('authToken', token) : localStorage.removeItem('authToken');
}

// 1. THE GLOBAL WRAPPER 
async function request(endpoint, method = 'GET', body = null) {
    const url = `${API_BASE}${endpoint}`;
    
    const headers = { 'Content-Type': 'application/json' };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

    const config = {
        method,
        headers,
        body: body ? JSON.stringify(body) : null
    };

    try {
        const res = await fetch(url, config);
        
        // GLOBAL ERROR HANDLING
        if (!res.ok) {
            // Try to get the server's error message, fallback to status text
            const errorText = await res.text().catch(() => res.statusText);
            throw new Error(`API Error ${res.status}: ${errorText}`);
        }

        // Return JSON if there is content, otherwise true (for 204 No Content)
        if (res.status === 204) return true;
        return await res.json();

    } catch (err) {
        console.error(`Request failed: ${method} ${url}`, err);
        throw err; // RE-THROW so the UI/Network knows it failed
    }
}

// --- 2. AUTH API  ---
export const apiRegister = (username, password) => request('/register', 'POST', { username, password });

export async function apiLogin(username, password) {
    const data = await request('/login', 'POST', { username, password });
    return data; // Returns { token, username }
}

// --- 3. TASK API  ---
export const apiGetTasks    = ()     => request('/tasks');
export const apiCreateTask  = (task) => request('/tasks', 'POST', task);
export const apiUpdateTask  = (task) => request(`/tasks/${task.id}`, 'PUT', task);
export async function apiDeleteTask(id) {
    try {
        // Try to delete normally
        return await request(`/tasks/${id}`, 'DELETE');
    } catch (err) {
        // If the error is "404 Not Found", it means the task is already gone from the server.
        // We treat this as a SUCCESS so the UI can remove it locally.
        if (err.message.includes('404')) {
            console.warn(`Task ${id} was already deleted on server (Ghost Task).`);
            return true; 
        }
        // If it's any other error (like 500 or Network Error), throw it
        throw err;
    }
}