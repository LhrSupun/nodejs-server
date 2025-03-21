const net = require('net');
const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');
const ThermalPrinter = require('node-thermal-printer').printer;
const PrinterTypes = require('node-thermal-printer').types;
const os = require('os');
const { exec } = require('child_process');
// const printDi = require('printer');

// Load environment variables
require('dotenv').config();

// Host IP
const REQUIRED_HOST_IP = process.env.REQUIRED_HOST_IP;

// Function to check the host IP address
function checkHostIP() {
    const networkInterfaces = os.networkInterfaces();
    let validIP = false;

    // Loop through all network interfaces
    for (const interfaceName in networkInterfaces) {
        for (const netInterface of networkInterfaces[interfaceName]) {
            if (netInterface.family === 'IPv4' && !netInterface.internal) {
                const hostIP = netInterface.address;
                console.log(`Host IP Address: ${hostIP}`);
                if (hostIP === REQUIRED_HOST_IP) {
                    validIP = true;
                    break;
                }
            }
        }
        if (validIP) break;
    }

    if (!validIP) {
        console.error(`Error: This program can only run on a host with IP address ${REQUIRED_HOST_IP}.`);
        process.exit(1); // Terminate the program
    }
}

// Run the IP address check at startup
checkHostIP();

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
const PRINTER_CONNECTION = process.env.PRINTER_CONNECTION || 'NETWORK'; // Default to NETWORK if not specified
const PRINTER_USB_NAME = process.env.PRINTER_USB_NAME || 'EPSON TM-T81 Receipt';

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

// Function to list Windows printers
function listWindowsPrinters() {
    return new Promise((resolve, reject) => {
        exec('wmic printer get name', (error, stdout, stderr) => {
            if (error) {
                console.error(`Error listing printers: ${error.message}`);
                reject(error);
                return;
            }
            if (stderr) {
                console.error(`stderr: ${stderr}`);
                reject(new Error(stderr));
                return;
            }

            const printerList = stdout.split('\n')
                .map(line => line.trim())
                .filter(line => line && line !== 'Name')
                .sort();

            console.log('Available printers:');
            printerList.forEach(printer => console.log(`- ${printer}`));

            resolve(printerList);
        });
    });
}

// Network printer initialization function
function initNetworkPrinter() {
    console.log(`Connecting to network printer at ${PRINTER_IP}:${PRINTER_PORT}`);
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

// Windows printer initialization function
function initWindowsPrinter(printerName) {
    console.log(`Connecting to Windows printer: ${printerName}`);
    let printer = new ThermalPrinter({
        type: PrinterTypes.EPSON,
        // interface: `printer:${printerName}`,
        interface: 'usb',
        driver: {},
        options: {
            timeout: 5000
        },
        width: 48
    });
    return printer;
}

// Printer initialization function
async function initPrinter() {
    if (PRINTER_CONNECTION.toUpperCase() === 'USB') {
        console.log(`Looking for USB printer via Windows: ${PRINTER_USB_NAME}`);
        try {
            // List available Windows printers
            const printers = await listWindowsPrinters();

            // Find printer that matches our desired name
            const matchingPrinter = printers.find(printer =>
                printer.toLowerCase().includes(PRINTER_USB_NAME.toLowerCase()));

            if (matchingPrinter) {
                console.log(`Found matching printer: ${matchingPrinter}`);
                return initWindowsPrinter(matchingPrinter);
            } else {
                console.warn(`Windows printer "${PRINTER_USB_NAME}" not found, falling back to network printer`);
                return initNetworkPrinter();
            }
        } catch (error) {
            console.error(`Error finding Windows printer: ${error.message}`);
            console.warn('Falling back to network printer');
            return initNetworkPrinter();
        }
    } else {
        return initNetworkPrinter();
    }
}

// Print endpoint
app.post('/api/print', async (req, res) => {
    try {
        const { printData } = req.body;
        const printer = await initPrinter();

        // Check if printer is connected, with error handling
        let isConnected = false;
        try {
            isConnected = await printer.isPrinterConnected();
        } catch (error) {
            console.error(`Error checking printer connection: ${error.message}`);
        }

        if (!isConnected) {
            console.error('Printer is not connected, attempting to print anyway');
            // Continue anyway, some printer drivers might still work
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
            printer.drawLine();

            printer.setTextNormal();
            printer.setTextDoubleHeight();
            printer.bold(true);
            printer.leftRight(`Gross Weight  `, `${printData.gross_weight}`);
            printer.setTextNormal();
            printer.newLine();
        } else {
            printer.drawLine();
        }
        printer.cut();

        try {
            await printer.execute();
            // if (PRINTER_CONNECTION.toUpperCase() !== 'USB') {
            // } else {
            //     printDi.printDirect({
            //         data : printer.getBuffer(),
            //         printer : PRINTER_USB_NAME,
            //         type: 'RAW',
            //         success: () => {
            //             console.log('Print job executed successfully');
            //             printer.clear();
            //         },
            //         error: (error) => {
            //             console.error(`Error executing print job: ${error.message}`);
            //             // Try to print using system print command as a fallback
            //             // printFallback(printData);
            //         }
            //     })
            // }
            console.log('Print job executed successfully');
        } catch (error) {
            console.error(`Error executing print job: ${error.message}`);
            // Try to print using system print command as a fallback
            // if (PRINTER_CONNECTION.toUpperCase() === 'USB') {
            //     await printFallback(printData);
            // } else {
            //     throw error;
            // }
            throw error;
        }

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

// List printers on startup
listWindowsPrinters().catch(err => {
    console.warn('Could not list Windows printers:', err.message);
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