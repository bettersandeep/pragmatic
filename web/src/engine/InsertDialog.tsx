import { useState } from 'react';

const SAMPLES = {
  mermaid: 'flowchart LR\n  A[User opens app] --> B{Signed in?}\n  B -- Yes --> C[Home]\n  B -- No --> D[Google login]\n  D --> C',
  mindmap: 'Launch plan\n  Product\n    Scope\n    Design\n  Marketing\n    Blog post\n    Email\n  Support',
};

export function InsertDialog({ kind, onClose, onSubmit }: { kind: 'mermaid' | 'mindmap'; onClose: () => void; onSubmit: (source: string) => Promise<void> }) {
  const [source, setSource] = useState(SAMPLES[kind]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setError('');
    try { await onSubmit(source); onClose(); } catch (e) { setError((e as Error).message); setBusy(false); }
  };
  return (
    <div className="modal-backdrop" onPointerDown={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="insert-title" onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') onClose(); }}>
        <h2 id="insert-title">{kind === 'mermaid' ? 'Insert Mermaid diagram' : 'Insert mind map'}</h2>
        <p className="muted">
          {kind === 'mermaid'
            ? 'Flowcharts and sequence diagrams become shapes and connectors you can edit. Other Mermaid types become a picture.'
            : 'One node per line. Indent children with two spaces. One root.'}
        </p>
        <textarea autoFocus spellCheck={false} value={source} onChange={(e) => setSource(e.target.value)} rows={12}
          onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && submit()} />
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={submit} disabled={busy}>{busy ? 'Adding…' : 'Insert'}</button>
        </div>
      </div>
    </div>
  );
}
