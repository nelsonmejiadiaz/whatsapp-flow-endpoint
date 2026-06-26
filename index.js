const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname, '../public')));

const agents = new Map();
const clients = new Map();
const queue   = [];

let clientCounter = 0;
let agentCounter  = 0;

function send(ws, msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function broadcastAgents(msg) {
  agents.forEach(ws => send(ws, msg));
}

function queueSnapshot() {
  return queue.map(q => ({
    clientId: q.clientId,
    waitSecs: Math.floor((Date.now() - q.joinedAt) / 1000),
  }));
}

wss.on('connection', (ws) => {
  let myId   = null;
  let myRole = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'register') {
      myRole = msg.role;

      if (myRole === 'agent') {
        myId = `agent-${++agentCounter}`;
        agents.set(myId, ws);
        send(ws, { type: 'registered', id: myId, queue: queueSnapshot() });
        console.log(`[+] Agente conectado: ${myId}`);
      }

      if (myRole === 'client') {
        myId = `client-${++clientCounter}`;
        clients.set(myId, { ws, agentId: null, state: 'queued' });
        queue.push({ clientId: myId, joinedAt: Date.now() });
        send(ws, { type: 'registered', id: myId });
        send(ws, { type: 'queued', position: queue.length });
        broadcastAgents({ type: 'queue_update', queue: queueSnapshot() });
        console.log(`[+] Cliente en cola: ${myId}`);
      }
    }

    if (msg.type === 'accept' && myRole === 'agent') {
      const clientId = msg.clientId;
      const client   = clients.get(clientId);
      if (!client) return;

      const idx = queue.findIndex(q => q.clientId === clientId);
      if (idx !== -1) queue.splice(idx, 1);

      client.agentId = myId;
      client.state   = 'connecting';

      send(client.ws, { type: 'accepted', agentId: myId });
      send(ws, { type: 'call_started', clientId });
      broadcastAgents({ type: 'queue_update', queue: queueSnapshot() });
      console.log(`[↔] ${myId} aceptó a ${clientId}`);
    }

    if (msg.type === 'reject' && myRole === 'agent') {
      const clientId = msg.clientId;
      const client   = clients.get(clientId);
      if (!client) return;

      const idx = queue.findIndex(q => q.clientId === clientId);
      if (idx !== -1) queue.splice(idx, 1);

      send(client.ws, { type: 'rejected' });
      clients.delete(clientId);
      broadcastAgents({ type: 'queue_update', queue: queueSnapshot() });
    }

    if (['offer', 'answer', 'ice'].includes(msg.type)) {
      if (myRole === 'client') {
        const client  = clients.get(myId);
        const agentWs = client?.agentId ? agents.get(client.agentId) : null;
        if (agentWs) send(agentWs, { ...msg, from: myId });
      }
      if (myRole === 'agent') {
        const clientData = clients.get(msg.to);
        if (clientData) send(clientData.ws, { ...msg, from: myId });
      }
    }

    if (msg.type === 'hangup') {
      if (myRole === 'client') {
        const client  = clients.get(myId);
        const agentWs = client?.agentId ? agents.get(client.agentId) : null;
        if (agentWs) send(agentWs, { type: 'hangup', clientId: myId });
        clients.delete(myId);
        const idx = queue.findIndex(q => q.clientId === myId);
        if (idx !== -1) queue.splice(idx, 1);
        broadcastAgents({ type: 'queue_update', queue: queueSnapshot() });
      }
      if (myRole === 'agent') {
        const clientData = clients.get(msg.clientId);
        if (clientData) {
          send(clientData.ws, { type: 'hangup' });
          clients.delete(msg.clientId);
        }
        broadcastAgents({ type: 'queue_update', queue: queueSnapshot() });
      }
    }
  });

  ws.on('close', () => {
    if (myRole === 'agent') {
      agents.delete(myId);
      console.log(`[-] Agente desconectado: ${myId}`);
    }
    if (myRole === 'client') {
      const client = clients.get(myId);
      if (client?.agentId) {
        const agentWs = agents.get(client.agentId);
        if (agentWs) send(agentWs, { type: 'hangup', clientId: myId });
      }
      clients.delete(myId);
      const idx = queue.findIndex(q => q.clientId === myId);
      if (idx !== -1) queue.splice(idx, 1);
      broadcastAgents({ type: 'queue_update', queue: queueSnapshot() });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ Servidor en http://localhost:${PORT}`));
