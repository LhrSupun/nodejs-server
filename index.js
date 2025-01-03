const net = require('net');
const WebSocket = require('ws');

// RFID TCP Server Configuration
const RFID_TCP_PORT = 30080;
const RFID_WS_PORT = 8080;

// Weight Scale Configuration
const WEIGHT_HOST = '10.40.7.181';
const WEIGHT_PORT = 7000;
const WEIGHT_WS_PORT = 8081;

// WebSocket Server for RFID
const rfidWss = new WebSocket.Server({ port: RFID_WS_PORT }, () => {
    console.log(`RFID WebSocket Server listening on ws://localhost:${RFID_WS_PORT}`);
});

// WebSocket Server for Weight
const weightWss = new WebSocket.Server({ port: WEIGHT_WS_PORT }, () => {
    console.log(`Weight WebSocket Server listening on ws://localhost:${WEIGHT_WS_PORT}`);
});

// Broadcast functions for each WebSocket server
function broadcastRFID(data) {
    rfidWss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(data);
        }
    });
}

function broadcastWeight(data) {
    weightWss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(data);
        }
    });
}

// RFID TCP Server
const rfidServer = net.createServer((socket) => {
    console.log('New RFID TCP connection:', socket.remoteAddress, socket.remotePort);

    socket.on('data', (data) => {
        const rfidData = data.toString();
        console.log('RFID Data received:', rfidData);
        broadcastRFID(rfidData);
    });

    socket.on('end', () => {
        console.log('RFID TCP connection closed');
    });

    socket.on('error', (err) => {
        console.error('RFID TCP Socket error:', err);
    });
});

// Weight Scale Client
const weightClient = new net.Socket();

function connectWeightScale() {
    weightClient.connect(WEIGHT_PORT, WEIGHT_HOST, () => {
        console.log(`Connected to weight scale at ${WEIGHT_HOST}:${WEIGHT_PORT}`);
    });
}

weightClient.on('data', (data) => {
    const weightData = data.toString();
    console.log('Weight Data received:', weightData);
    broadcastWeight(weightData);
});

weightClient.on('close', () => {
    console.log('Weight scale connection closed');
    // Reconnect after 5 seconds
    setTimeout(connectWeightScale, 5000);
});

weightClient.on('error', (err) => {
    console.error('Weight scale connection error:', err);
});

// Start servers
rfidServer.listen(RFID_TCP_PORT, () => {
    console.log(`RFID TCP Server listening on port ${RFID_TCP_PORT}`);
});

// Initial connection to weight scale
connectWeightScale();

// Error handling
rfidServer.on('error', (err) => {
    console.error('RFID TCP Server error:', err);
});

rfidWss.on('error', (err) => {
    console.error('RFID WebSocket Server error:', err);
});

weightWss.on('error', (err) => {
    console.error('Weight WebSocket Server error:', err);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down servers...');
    rfidServer.close();
    weightClient.destroy();
    rfidWss.close();
    weightWss.close();
    process.exit();
});
