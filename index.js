const net = require('net');
const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');
const ThermalPrinter = require('node-thermal-printer').printer;
const PrinterTypes = require('node-thermal-printer').types;

// Load environment variables
require('dotenv').config();

// RFID TCP Server Configuration
const RFID_TCP_PORT = process.env.RFID_TCP_PORT;
const RFID_WS_PORT = process.env.RFID_WS_PORT;

// Weight Scale Configuration
const WEIGHT_HOST = process.env.WEIGHT_HOST;
const WEIGHT_PORT = process.env.WEIGHT_PORT;
const WEIGHT_WS_PORT = process.env.WEIGHT_WS_PORT;

// Thermal Printer Configuration
const PRINTER_IP = process.env.PRINTER_IP;
const PRINTER_PORT = process.env.PRINTER_PORT;

// Express App Setup
const EXPRESS_PORT = process.env.EXPRESS_PORT;
const app = express();
app.use(cors());
app.use(express.json());

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

// Printer initialization function
async function initPrinter() {
    let printer = new ThermalPrinter({
        type: PrinterTypes.EPSON,
        interface: `tcp://${PRINTER_IP}:${PRINTER_PORT}`,
        options: {
            timeout: 3000
        },
        width: 48
    });
    return printer;
}

// Print endpoint
app.post('/api/print', async (req, res) => {
    try {
        const { printData } = req.body;
        const printer = await initPrinter();

        const isConnected = await printer.isPrinterConnected();
        if (!isConnected) {
            throw new Error('Printer is not connected');
        }

        // Header
        printer.alignCenter();
        printer.setTextDoubleHeight();
        printer.setTextDoubleWidth();
        printer.bold(true);
        printer.print(printData.title);
        printer.setTextNormal();
        printer.newLine();
        printer.newLine();

        // Ticket Number
        printer.alignLeft();
        printer.setTextDoubleHeight();
        printer.println(`No ${printData.ticket_no}`);

        // Vehicle and Supplier Info
        printer.setTextDoubleHeight();
        printer.setTextDoubleWidth();
        printer.println(printData.vehicle_number);
        printer.setTextNormal();
        printer.println(printData.supplier);
        printer.println(printData.address);

        // Weight Info
        printer.alignLeft();
        printer.println('In Time & Weight');
        printer.drawLine();

        printer.setTextNormal();
        printer.setTextDoubleHeight();
        printer.bold(true);
        printer.leftRight(`${printData.in_time}  `, `${printData.in_weight}`);
        printer.setTextNormal();

        if (printData.out_time) {
            printer.drawLine();
            printer.alignLeft();
            printer.println('Out Time & Weight');
            printer.setTextNormal();
            printer.setTextDoubleHeight();
            printer.bold(true);
            printer.leftRight(`${printData.out_time}  `, `${printData.out_weight}`);
            printer.setTextNormal();
            printer.newLine();
        } else {
            printer.drawLine();
        }
        printer.cut();
        await printer.execute();

        return res.json({ success: true, message: 'Print job sent successfully' });
    } catch (error) {
        console.error('Printing error:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
});

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
    // console.log('Weight Data received:', weightData);
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

// Start Express server
app.listen(EXPRESS_PORT, () => {
    console.log(`Express server listening on port ${EXPRESS_PORT}`);
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
    app.close();
    process.exit();
});