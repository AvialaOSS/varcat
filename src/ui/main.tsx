import './figma-storage-shim';
import { createRoot } from 'react-dom/client';
import { ConfigProvider, ThemeProvider, zhCN } from '@aviala-design/spiral';
import '@aviala-design/spiral/styles.css';
import { App } from './App';

const root = document.getElementById('root');
if (!root) {
  throw new Error('VarCat UI: #root missing');
}

createRoot(root).render(
  // No storageKey needed — Figma data: iframes cannot use real localStorage;
  // figma-storage-shim provides an in-memory stand-in for ThemeProvider.
  <ThemeProvider defaultMode="light">
    {/* ConfigProvider wraps its children in a `dir` div. Left at `height: auto`
        it breaks the panel's `height: 100%` chain, so the shell grows past the
        iframe instead of scrolling its body. */}
    <ConfigProvider locale={zhCN} className="vc-root">
      <App />
    </ConfigProvider>
  </ThemeProvider>
);
