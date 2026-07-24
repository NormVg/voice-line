---
# https://vitepress.dev/reference/default-theme-home-page
layout: home

hero:
  name: "voice-line"
  text: "The real-time voice layer for AI agents."
  tagline: "You bring the brain — we handle the ears and mouth. No WebRTC. No infrastructure. Just WebSockets."
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: Read the Architecture
      link: /guide/introduction

features:
  - title: Bring Your Own Brain
    details: Seamlessly integrates with Vercel AI SDK, Eve, or your custom LLM orchestrators. We give you text, you give us text.
  - title: Zero WebRTC Headaches
    details: WebRTC introduces complex NAT traversal and STUN/TURN requirements. We rely purely on WebSockets and pub/sub (Ably) for massive scalability.
  - title: Do One Thing Best
    details: We handle Voice Activity Detection (VAD), STT streaming, TTS chunking, and human interruptions out of the box. You just build the agent.
  - title: Zero-Boilerplate React & Vue
    details: Ships with useVoiceAgent hooks that handle token fetching, transport instantiation, and state management in a single line.
---

<style>
:root {
  --vp-home-hero-name-color: transparent;
  --vp-home-hero-name-background: -webkit-linear-gradient(120deg, #bd34fe 30%, #41d1ff);
}
</style>
