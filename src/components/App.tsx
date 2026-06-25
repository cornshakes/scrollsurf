'use client';

import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { ConsentProvider } from './CookieConsent';
import { FeedProvider } from './FeedContext';
import { theme } from './theme';

const App = ({ children }: { children: React.ReactNode }) => (
  <ThemeProvider theme={theme}>
    <CssBaseline />
    <ConsentProvider>
      <FeedProvider>{children}</FeedProvider>
    </ConsentProvider>
  </ThemeProvider>
);

export default App;
