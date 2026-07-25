const ws = new WebSocket('ws://localhost:3000/_ws?session=123');
ws.onopen = () => {
  ws.send(JSON.stringify({ type: 'session:ready' }));
  console.log('Sent text message');
  
  // send some mock audio
  const mockAudio = new Int16Array(16000).fill(100);
  ws.send(mockAudio.buffer);
  console.log('Sent binary message');
  
  setTimeout(() => process.exit(0), 1000);
};
ws.onerror = (e) => console.error('WS Error:', e.message);
