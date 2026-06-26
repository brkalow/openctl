import { createRoot } from 'react-dom/client';
import { ClerkProvider } from '@clerk/react';
import { App } from './App';
import { AuthContextProvider } from './components/AuthContext';
import { setupGlobals } from './globals';

// Set up global utilities (toast, clipboard) for backwards compatibility
setupGlobals();

// Clerk publishable key from environment
// This gets injected at build time by Bun's static server (see bunfig.toml)
// Use typeof check to safely access in browser context when not replaced
const CLERK_PUBLISHABLE_KEY = process.env.PUBLIC_CLERK_PUBLISHABLE_KEY;
const isClerkConfigured = Boolean(CLERK_PUBLISHABLE_KEY);

// Optional Clerk Frontend API proxy URL (e.g. "https://openctl.dev/__clerk").
// When set, Clerk routes FAPI traffic through our domain instead of a CNAME.
// Must match the proxy URL configured in the Clerk Dashboard and the server's
// PUBLIC_CLERK_PROXY_URL. See src/routes/clerk-proxy.ts.
const CLERK_PROXY_URL = process.env.PUBLIC_CLERK_PROXY_URL;

// Mount React app
const container = document.getElementById('app');
if (container) {
  const root = createRoot(container);

  // Always wrap with AuthContextProvider to let components know if Clerk is available
  if (isClerkConfigured && CLERK_PUBLISHABLE_KEY) {
    root.render(
      <AuthContextProvider isClerkConfigured={true}>
        <ClerkProvider
          publishableKey={CLERK_PUBLISHABLE_KEY}
          {...(CLERK_PROXY_URL ? { proxyUrl: CLERK_PROXY_URL } : {})}
        >
          <App />
        </ClerkProvider>
      </AuthContextProvider>
    );
  } else {
    // Fallback for development without Clerk
    root.render(
      <AuthContextProvider isClerkConfigured={false}>
        <App />
      </AuthContextProvider>
    );
  }
}
