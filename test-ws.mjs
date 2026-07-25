import { WebSocketServer } from 'ws';
const wss = new WebSocketServer({ port: 8080 });
wss.on('connection', function connection(ws) {
  ws.on('message', function message(data, isBinary) {
    console.log('Received data of type:', data.constructor.name, 'isBinary:', isBinary);
    process.exit(0);
  });
});
import WebSocket from 'ws';
const ws = new WebSocket('ws://localhost:8080');
ws.on('open', function open() {
  ws.send(new Float32Array([1, 2, 3]).buffer);
});
