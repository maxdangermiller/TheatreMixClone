import React, { useState } from 'react';

// Reusable Alert Component
export default function Alert({ type = 'info', message, onClose }) {
  const styles = {
    info: { backgroundColor: '#d1ecf1', color: '#0c5460', border: '1px solid #bee5eb' },
    success: { backgroundColor: '#d4edda', color: '#155724', border: '1px solid #c3e6cb' },
    warning: { backgroundColor: '#fff3cd', color: '#856404', border: '1px solid #ffeeba' },
    error: { backgroundColor: '#f8d7da', color: '#721c24', border: '1px solid #f5c6cb' },
  };

  return (
    <div style={{
      padding: '15px',
      borderRadius: '4px',
      margin: '10px 0',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      ...styles[type]
    }}>
      <span>{message}</span>
      {onClose && (
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}>
          &times;
        </button>
      )}
    </div>
  );
}
