import DefaultTheme from 'vitepress/theme'
import { h } from 'vue'
import CopyPageMarkdown from './components/CopyPageMarkdown.vue'
import './style.css'

export default {
  extends: DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      'doc-before': () => h(CopyPageMarkdown)
    })
  }
}
