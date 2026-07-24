/**
 * Bootstrap config for the browser client.
 * Does not create a session — the WS connection does that.
 */
export default defineEventHandler((event) => {
  const url = getRequestURL(event);
  const protocol = url.protocol === "https:" ? "wss:" : "ws:";
  
  return {
    wsUrl: `${protocol}//${url.host}/_ws`,
    sampleRate: 16_000,
  };
});
