<script setup>
import { useData } from 'vitepress'
import { ref, computed } from 'vue'

const { page } = useData()
const copied = ref(false)
const error = ref(false)

const copyMarkdown = async () => {
  try {
    // Attempt to fetch the raw markdown file from the local server (works in dev)
    let text = ''
    try {
      const localRes = await fetch(`/${page.value.relativePath}`)
      if (localRes.ok) {
        text = await localRes.text()
      } else {
        throw new Error('Local not found')
      }
    } catch (e) {
      // Fallback to GitHub raw content (works in production if repo is public and pushed)
      const githubRes = await fetch(`https://raw.githubusercontent.com/NormVg/voice-line/master/docs/${page.value.relativePath}`)
      if (githubRes.ok) {
        text = await githubRes.text()
      } else {
        throw new Error('Could not fetch markdown')
      }
    }
    
    await navigator.clipboard.writeText(text)
    copied.value = true
    error.value = false
    setTimeout(() => { copied.value = false }, 2000)
  } catch (err) {
    console.error('Failed to copy markdown:', err)
    error.value = true
    setTimeout(() => { error.value = false }, 2000)
  }
}
</script>

<template>
  <div class="copy-md-container">
    <button 
      @click="copyMarkdown" 
      class="copy-md-btn" 
      :class="{ copied, error }"
      title="Copy raw markdown of this page for AI context"
    >
      <svg v-if="!copied && !error" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
      <svg v-if="copied" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
      <svg v-if="error" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
      <span>{{ copied ? 'Copied MD' : error ? 'Error' : 'Copy Page MD' }}</span>
    </button>
  </div>
</template>

<style scoped>
.copy-md-container {
  display: flex;
  justify-content: flex-end;
  margin-bottom: -1rem;
  margin-top: 2rem;
  position: relative;
  z-index: 10;
}

.copy-md-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: var(--vp-font-family-base);
  font-size: 12px;
  font-weight: 500;
  padding: 6px 12px;
  border-radius: 6px;
  background-color: transparent;
  color: var(--vercel-accents-5);
  border: 1px solid var(--vercel-accents-2);
  cursor: pointer;
  transition: all 0.15s ease;
}

.copy-md-btn:hover {
  color: var(--vercel-foreground);
  border-color: var(--vercel-accents-4);
  background-color: var(--vercel-accents-1);
}

.copy-md-btn.copied {
  color: #10b981;
  border-color: #10b981;
}

.copy-md-btn.error {
  color: #ef4444;
  border-color: #ef4444;
}
</style>
