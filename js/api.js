// js/api.js
const API_URL = 'http://localhost:3000/api/tasks';

export async function apiCreateTask(task) {
        const res = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(task)
        });
        if (!res.ok) throw new Error('API Create Failed');
        return await res.json();
    
}

export async function apiUpdateTask(task) {
        const res = await fetch(`${API_URL}/${task.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(task)
        });
        if (!res.ok) throw new Error('API Update Failed');
        return await res.json();
    
}

export async function apiDeleteTask(id) {
        const res = await fetch(`${API_URL}/${id}`, {
            method: 'DELETE'
        });
        if (!res.ok) throw new Error('API Delete Failed');
        return true;
}

export async function apiGetTasks(username) {
        const res = await fetch(`${API_URL}?username=${username}`);
        if (!res.ok) throw new Error('API Fetch Failed');
        return await res.json();
    
}