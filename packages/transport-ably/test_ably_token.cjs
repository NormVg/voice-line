const Ably = require("ably");

async function run() {
  const apiKey = process.env.ABLY_API_KEY;
  if (!apiKey) throw new Error("No API key");

  const rest = new Ably.Rest(apiKey);
  const sessionId = "ses_test123";
  const channelName = `voice-line:${sessionId}`;

  console.log("Creating token request...");
  const tokenRequest = await rest.auth.createTokenRequest({
    clientId: `client_${sessionId}`,
    capability: {
      [channelName]: ["publish", "subscribe", "presence"],
    },
  });

  console.log("Token request created. Connecting client...");

  const client = new Ably.Realtime({
    authCallback: (tokenParams, callback) => {
      callback(null, tokenRequest);
    },
  });

  await new Promise((resolve, reject) => {
    client.connection.once("connected", resolve);
    client.connection.once("failed", reject);
  });

  console.log("Client connected. Subscribing...");

  const channel = client.channels.get(channelName);
  await Promise.all([
    channel.subscribe("audio:server", () => {}),
    channel.subscribe("event:server", () => {}),
  ]);

  console.log("Subscribed! Publishing...");

  await channel.publish("event:client", { type: "client:ready" });

  console.log("Published! Waiting a bit...");

  await new Promise((r) => setTimeout(r, 2000));

  console.log("Closing...");
  client.close();
  console.log("Done.");
}

run().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
