import { createTheme } from '@mui/material/styles';

// Palette sampled from the favicon's surf scene: teal waves, sunset
// orange/gold sky, palm-green foliage, cream surfboard, deep navy-teal outline.
export const theme = createTheme({
  cssVariables: { colorSchemeSelector: 'media' },
  colorSchemes: {
    light: {
      palette: {
        primary: { main: '#0e8e92', light: '#4ec0c4', dark: '#0a5f62' }, // wave teal
        secondary: { main: '#e8771a', light: '#ff9a3d', dark: '#b45611' }, // sunset orange
        success: { main: '#2e7d32' }, // palm green
        warning: { main: '#f5b920' }, // sun gold
        background: { default: '#fbf6ea', paper: '#ffffff' }, // sandy cream
        text: { primary: '#0b252b', secondary: '#3d5860' }, // deep navy-teal
      },
    },
    dark: {
      palette: {
        primary: { main: '#2bb7bc', light: '#6fdadd', dark: '#0e8e92' }, // wave teal
        secondary: { main: '#ff9a3d', light: '#ffb869', dark: '#e8771a' }, // sunset orange
        success: { main: '#5fbd63' }, // palm green
        warning: { main: '#ffcf4d' }, // sun gold
        background: { default: '#0b252b', paper: '#10333b' }, // deep navy-teal
        text: { primary: '#eef6f5', secondary: '#a3c1c4' },
      },
    },
  },
});
