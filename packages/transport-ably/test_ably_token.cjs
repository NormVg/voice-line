const Ably = require('ably');
const apiKey = "VLU4xA.Upxw-Q:1HLFfGi1UNkqkfQTqjliqP27nXM8oxODY7e-3yy7qaI";

async function main() {
  const rest = new Ably.Rest(apiKey);
  console.log("Creating token request...");
  const tokenRequest = await rest.auth.createTokenRequest({
    clientId: "test_client",
    capability: {
      "voice-line:test": ["publish", "subscribe"]
    }
  });

  console.log("Connecting with token request...");
  const realtime = new Ably.Realtime({
    authCallback: (_, cb) => cb(null, tokenRequest)
  });

  realtime.connection.on('connected', () => {
    console.log("Connected successfully via TokenRequest!");
    realtime.close();
  });

  realtime.connection.on('failed', (err) => {
    console.error("Connection failed:", err);
    process.exit(1);
  });
}

main().catch(console.error);
