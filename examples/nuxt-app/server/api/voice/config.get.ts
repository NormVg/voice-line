/**
 * Bootstrap config for the browser client.
 * Does not create a session — the WS connection does that.
 */
export default defineEventHandler(() => {
  const config = useRuntimeConfig();
  return {
    wsUrl: config.public.voiceWsUrl as string,
    sampleRate: 16_000,
  };
});
