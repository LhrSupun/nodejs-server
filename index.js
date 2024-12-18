const net = require('net');
const WebSocket = require('ws');

const TCP_PORT = 30080; // Port for TCP connections
const WS_PORT = 8080; // Port for WebSocket clients

// WebSocket Server
const wss = new WebSocket.Server({ port: WS_PORT }, () => {
    console.log(`WebSocket Server listening on ws://localhost:${WS_PORT}`);
});

// Broadcast to all connected WebSocket clients
function broadcastToClients(data) {
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(data);
        }
    });
}

// TCP Server
const tcpServer = net.createServer((socket) => {
    console.log('New TCP connection:', socket.remoteAddress, socket.remotePort);

    socket.on('data', (data) => {
        console.log('Data received from TCP:', data.toString());
        broadcastToClients(data.toString()); // Send data to WebSocket clients
    });

    socket.on('end', () => {
        console.log('TCP connection closed');
    });

    socket.on('error', (err) => {
        console.error('TCP Socket error:', err);
    });
});

tcpServer.listen(TCP_PORT, () => {
    console.log(`TCP Server listening on port ${TCP_PORT}`);
});
