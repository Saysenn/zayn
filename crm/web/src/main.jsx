import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from './lib/queryClient';
import ErrorBoundary from './components/layout/ErrorBoundary';
import { ThemeProvider } from './hooks/useTheme';
import { applyTheme, readThemeId } from './helpers/theme';
import './index.css';

// BEFORE the first paint, so a saved theme never flashes the default first.
applyTheme(readThemeId());

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <ThemeProvider>
            <App />
          </ThemeProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
