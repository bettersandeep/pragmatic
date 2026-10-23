import { createRoot } from 'react-dom/client';
import '@fontsource/barlow/400.css';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow/600.css';
// Rich text: bold (700) and italic faces, so formatting is real type, not a synthetic slant or weight.
import '@fontsource/barlow/700.css';
import '@fontsource/barlow/500-italic.css';
import '@fontsource/barlow/600-italic.css';
import '@fontsource/barlow/700-italic.css';
import { App } from './App.tsx';
import './styles.css';

createRoot(document.getElementById('root')!).render(<App />);
