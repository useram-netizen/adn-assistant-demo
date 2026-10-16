import '@fontsource-variable/inter';
import '@fontsource/fraunces/500.css';
import './styles/widget.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { readEmbedContext } from './lib/embedContext';

const embed = readEmbedContext(window.location.search, window);
document.documentElement.dataset.mode = embed.mode;

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App embed={embed} />
    </StrictMode>,
  );
}
