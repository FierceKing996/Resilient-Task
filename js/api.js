// js/api.js
const API_URL = 'http://localhost:3000/api';
let authToken = localStorage.getItem('authToken') || null;

// Helper to set token on login
export function setAuthToken(token) {
    authToken = token;
    if(token) localStorage.setItem('authToken', token);
    else localStorage.removeItem('authToken');
}

// 1. NEW: Auth Functions
export async function apiRegister(username, password) {
    const res = await fetch(`${API_URL}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });
    if (!res.ok) throw new Error(await res.text());
    return true;
}

export async function apiLogin(username, password) {
    const res = await fetch(`${API_URL}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });
    if (!res.ok) throw new Error("Login Failed");
    return await res.json(); // Returns { token, username }
}

function getHeaders() {
    return { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}` // <--- THE KEY PART
    };
}

export async function apiCreateTask(task) {
        const res = await fetch(`${API_URL}/tasks`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(task)
        });
        if (!res.ok) throw new Error('API Create Failed');
        return await res.json();
    
}

export async function apiUpdateTask(task) {
        const res = await fetch(`${API_URL}/tasks/${task.id}`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify(task)
        });
        if (!res.ok) throw new Error('API Update Failed');
        return await res.json();
    
}

export async function apiDeleteTask(id) {
        const res = await fetch(`${API_URL}/tasks/${id}`, {
        method: 'DELETE',
        headers: getHeaders()
        });
        if (!res.ok) throw new Error('API Delete Failed');
        return true;
}

export async function apiGetTasks(username) {
        try {
        const res = await fetch(`${API_URL}/tasks`, { headers: getHeaders() });
        if (!res.ok) throw new Error('Fetch Failed');
        return await res.json();
    } catch (err) {
        return [];
    }
}