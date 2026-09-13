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
    <ConfigProvider locale={zhCN}>
      <App />
    </ConfigProvider>
  </ThemeProvider>
);
