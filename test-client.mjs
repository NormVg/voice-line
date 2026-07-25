const ws = new WebSocket('ws://localhost:3000/api/voice?session=123');
ws.onopen = () => {
  ws.send(JSON.stringify({ type: 'session:ready' }));
  console.log('Sent text message');
  setTimeout(() => process.exit(0), 1000);
};
ws.onerror = (e) => console.error('WS Error:', e.message);
