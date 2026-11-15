import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { ApiProvider } from './api/ApiProvider';
import { AppRoutes } from './App';
import { ToastProvider } from './components/ui';
import './styles/global.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ApiProvider>
      <ToastProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </ToastProvider>
    </ApiProvider>
  </StrictMode>,
);
