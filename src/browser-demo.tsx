import React from 'react';
import { createRoot } from 'react-dom/client';
import LabWorkspace from '../components/lab/LabWorkspace';
import { browserDemo } from './demo-runtime';
import '../app/globals.css';
import '../app/lab/lab.css';
import 'katex/dist/katex.min.css';
import './browser-demo.css';
function Demo() {
  return <><div className="public-demo-bar"><span><strong>PIA demo</strong><span className="public-demo-detail"> · Fictional lab · Edits stay in this browser</span></span><nav aria-label="Demo links"><a href="https://github.com/assafshocher/PIA">GitHub</a><button onClick={() => { if (confirm('Reset this demo to its original fictional records? Your demo edits will be removed.')) { browserDemo.reset(); location.reload(); } }}>Reset demo</button><a href="https://assafshocher.github.io/other/">← Other</a></nav></div><LabWorkspace /></>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Demo /></React.StrictMode>);
