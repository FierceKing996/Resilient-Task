// server.js
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const jwt = require('jsonwebtoken');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());


// Data Stores
let globalTasks = []; 
let globalTaskCount = 0;
const activeAgents = new Map();
const SECRET_KEY = "my_super_secret_mission_key"; 
const users = [];

//Auth
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer <token>

    if (!token) return res.status(401).json({ error: "Access Denied: No Token" });

    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) return res.status(403).json({ error: "Invalid Token" });
        req.user = user; // Attach user info to the request
        next();
    });
}

// 1. REGISTER (Simple)
app.post('/api/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Missing fields" });
    
    // Check if user exists
    if (users.find(u => u.username === username)) {
        return res.status(400).json({ error: "User already exists" });
    }

    users.push({ username, password }); // In real app, HASH the password!
    res.status(201).json({ message: "Agent Registered" });
});

// 2. LOGIN (Issues Token)
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const user = users.find(u => u.username === username && u.password === password);

    if (!user) return res.status(400).json({ error: "Invalid Credentials" });

    // Generate Token (Expires in 1 hour)
    const token = jwt.sign({ username: user.username }, SECRET_KEY, { expiresIn: '1h' });
    res.json({ token, username: user.username });
});


// 1. CREATE (POST) - Replaces 'add_task' and 'sync_task' (creation part)
app.post('/api/tasks',authenticateToken, (req, res) => {
    const task = req.body;

    task.username = req.user.username;

    if (!task || !task.id) return res.status(400).json({ error: "Invalid Data" });

    // Logic: Add to server memory
    // Check duplication (idempotency)
    const exists = globalTasks.find(t => String(t.id) === String(task.id));
    if (!exists) {
        globalTasks.push(task);
        
        // Check for completed count increment
        if (task.completed) {
            globalTaskCount++;
            broadcastNotification(`User ${task.username} completed a mission!`);
        }

        // REAL-TIME BRIDGE: Tell everyone else a new task exists
        /*broadcastToOthers(task.username, { 
            type: 'incoming_shared_task', // Or a new type like 'task_created'
            task: task, 
            sender: task.username 
        });*/
    }

    res.status(201).json({ message: "Task Synced", task: task });
});

// 2. READ (GET) - Fetch tasks for a specific user
app.get('/api/tasks', authenticateToken , (req, res) => {
    const username = req.query.username;
    // Return only tasks belonging to this user
    const tasks = username ? globalTasks.filter(t => t.username === username) : [];
    res.json(tasks);
});

// 3. UPDATE (PUT) - Replaces 'toggle_task' and 'edit_task'
app.put('/api/tasks/:id', authenticateToken ,(req, res) => {
    const { id } = req.params;
    const updates = req.body;
    
    const task = globalTasks.find(t => String(t.id) === String(id));
    if (!task) return res.status(404).json({ error: "Task Not Found" });

    // Handle Global Count Logic (if toggling completion)
    if (!task.completed && updates.completed) {
        globalTaskCount++;
        broadcastNotification(`User ${task.username} completed a mission!`);
    } else if (task.completed && updates.completed === false) {
        // Optional: Decrement count if they uncheck it?
        // globalTaskCount--; 
    }

    // Apply Updates
    Object.assign(task, updates);

    // REAL-TIME BRIDGE: Notify others of the update
    //broadcastToOthers(task.username, { type: 'sync_task', task: task });

    res.json({ message: "Task Updated", task: task });
});

// 4. DELETE (DELETE) - Replaces 'delete_task'
app.delete('/api/tasks/:id', authenticateToken, (req, res) => {
    const { id } = req.params;
    const initialLength = globalTasks.length;
    
    // Remove from memory
    globalTasks = globalTasks.filter(t => String(t.id) !== String(id));

    if (globalTasks.length === initialLength) {
        return res.status(404).json({ error: "Task Not Found" });
    }

    // REAL-TIME BRIDGE: Tell everyone to delete it
    //broadcastGlobal({ type: 'delete_task', taskId: id });

    res.json({ message: "Task Deleted" });
});

// --- WEBSOCKET LOGIC ---
wss.on('connection', (ws) => {
    
    ws.on('message', (message) => {
        const data = JSON.parse(message);

        // 1. LOGIN (Keep in WS - Session Logic)
        if (data.type === 'login') {
            ws.username = data.username;
            activeAgents.set(data.username, ws);
            console.log(`👤 Login: ${data.username}`);
            
            // Send Tasks
            const userTasks = globalTasks.filter(t => t.username === data.username);
            ws.send(JSON.stringify({ type: 'initial_sync', tasks: userTasks }));
            
            // Broadcast Agent List
            broadcastActiveList();
        }

        // [REMOVED] add_task (Moved to POST /api/tasks)
        // [REMOVED] sync_task (Moved to POST/PUT /api/tasks)
        // [REMOVED] toggle_task (Moved to PUT /api/tasks/:id)
        // [REMOVED] delete_task (Moved to DELETE /api/tasks/:id)

        // 2. SHARING - DIRECTORY (Keep in WS - Real-time P2P)
        if (data.type === 'request_agent_list') {
            const list = Array.from(activeAgents.keys()).filter(name => name !== ws.username);
            ws.send(JSON.stringify({ type: 'agent_list', agents: list }));
        }

        // 3. SHARING - TRANSMISSION (Keep in WS - Real-time P2P)
        if (data.type === 'targeted_share') {
            const recipientWs = activeAgents.get(data.targetUser);
            if (recipientWs && recipientWs.readyState === WebSocket.OPEN) {
                recipientWs.send(JSON.stringify({
                    type: 'incoming_shared_task',
                    task: data.task,
                    sender: ws.username
                }));
            }
        }
        if (data.type === 'broadcast_action') {
        // Send to everyone ELSE (broadcast)
        wss.clients.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                    type: 'global_notification', // This matches your Network.js handler
                    text: `User ${data.username} has ${data.action} a task!`
                }));
            }
        });
    }
    });

    ws.on('close', () => {
        if (ws.username) activeAgents.delete(ws.username);
        broadcastActiveList();
    });
});

function broadcastActiveList() {
    const list = Array.from(activeAgents.keys());
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            const others = list.filter(name => name !== client.username);
            client.send(JSON.stringify({ type: 'agent_list', agents: others }));
        }
    });
}

function broadcastNotification(text) {
    const msg = JSON.stringify({ type: 'global_notification', text: text });
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) client.send(msg);
    });
}

function broadcastGlobal(data) {
    const msg = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) client.send(msg);
    });
}

// Helper to broadcast to everyone EXCEPT the sender (prevents echo)
function broadcastToOthers(senderName, data) {
    const msg = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client.username !== senderName) {
            client.send(msg);
        }
    });
}

// --- ENDPOINTS ---
app.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const sendStats = () => res.write(`data: ${JSON.stringify({ totalTasks: globalTaskCount })}\n\n`);
    sendStats();
    const intervalId = setInterval(sendStats, 2000);
    req.on('close', () => clearInterval(intervalId));
});

app.get('/short-poll', (req, res) => {
    if (Math.random() < 0.1) res.status(500).json({ error: "Glitch" });
    else res.json({ status: "OK" });
});

app.get('/long-poll', (req, res) => {
    setTimeout(() => {
        if (Math.random() < 0.15) res.status(503).json({ error: "Timeout" });
        else res.json({ status: "OK" });
    }, 3000);
});

server.listen(3000, () => console.log(` Server Online on 3000`));

