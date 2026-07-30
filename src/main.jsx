import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

// Last-resort guard: turn any uncaught render error into a readable message
// (with the actual error text) instead of a blank white screen.
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#020617', padding: 16, fontFamily: 'system-ui, sans-serif' }}>
          <div style={{ maxWidth: 480, background: '#fff', borderRadius: 16, padding: 24 }}>
            <div style={{ color: '#e11d48', fontWeight: 700, marginBottom: 8 }}>⚠️ เกิดข้อผิดพลาด</div>
            <p style={{ fontSize: 14, color: '#475569' }}>แอปโหลดไม่สำเร็จ ข้อความ error:</p>
            <pre style={{ fontSize: 12, background: '#f1f5f9', padding: 12, borderRadius: 8, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#0f172a' }}>
              {String(this.state.error?.message || this.state.error)}
            </pre>
            <button onClick={() => location.reload()} style={{ marginTop: 12, background: '#db2777', color: '#fff', border: 0, borderRadius: 8, padding: '8px 16px', fontSize: 14, cursor: 'pointer' }}>
              โหลดใหม่
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
