import './styles/main.css';
import { LuminoTetrisApp } from './ui/app';

const mount = document.getElementById('app') ?? document.body;
const app = new LuminoTetrisApp({ container: mount });

if (typeof window !== 'undefined') {
  (window as Window & { __luminoApp?: LuminoTetrisApp }).__luminoApp = app;
}
