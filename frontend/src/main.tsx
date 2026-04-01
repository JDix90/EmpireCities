import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import App from './App';
import './index.css';

if (Capacitor.isNativePlatform()) {
  void StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
  void StatusBar.setBackgroundColor({ color: '#0f1117' }).catch(() => {});
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: '#1a1f2e',
            color: '#e8e8e8',
            border: '1px solid #2d3448',
          },
        }}
      />
    </BrowserRouter>
  </React.StrictMode>
);
