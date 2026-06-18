'use client';

import { createTheme, ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { ConsentProvider } from './CookieConsent';
import { FeedProvider } from './FeedContext';

const theme = createTheme({
  cssVariables: { colorSchemeSelector: 'media' },
  colorSchemes: { light: true, dark: true },
});

const App = ({ children }: { children: React.ReactNode }) => (
  <ThemeProvider theme={theme}>
    <CssBaseline />
    <ConsentProvider>
      <FeedProvider>{children}</FeedProvider>
    </ConsentProvider>
  </ThemeProvider>
);

export default App;
