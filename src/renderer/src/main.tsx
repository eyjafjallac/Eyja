import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { StickyMemo } from './components/memo/StickyMemo'
// KaTeX stylesheet — required for the math extension to render correctly.
import 'katex/dist/katex.min.css'
import './styles/index.css'

/**
 * One renderer bundle serves two window types, chosen by the URL hash:
 *  - "#memo/<id>"  → a single floating sticky-memo window
 *  - anything else → the full editor app
 * The main process sets the hash when it creates each window (see windows/).
 */
function Root(): JSX.Element {
  const memoMatch = window.location.hash.match(/^#memo\/(.+)$/)
  if (memoMatch) return <StickyMemo memoId={decodeURIComponent(memoMatch[1])} />
  return <App />
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
)
