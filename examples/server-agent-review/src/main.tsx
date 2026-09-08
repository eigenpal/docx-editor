import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
const host = document.getElementById('root')!;
if (localStorage.getItem('margin-theme') === 'dark') host.classList.add('dark');
createRoot(host).render(<App />);
