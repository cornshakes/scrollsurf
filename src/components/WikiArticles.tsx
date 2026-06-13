'use client';

import { useState } from 'react';
import NextLink from 'next/link';
import useScrollTrigger from '@mui/material/useScrollTrigger';
import Box from '@mui/material/Box';
import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Drawer from '@mui/material/Drawer';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Divider from '@mui/material/Divider';
import MenuIcon from '@mui/icons-material/Menu';
import { RandomFeed } from './RandomFeed';
import { VotedFeed } from './VotedFeed';
import { CategoryFeed } from './CategoryFeed';

type View = 'random' | 'liked' | 'disliked' | 'categories';

const VIEW_LABELS: Record<View, string> = {
  random: 'Scrollsurf',
  liked: 'Liked',
  disliked: 'Disliked',
  categories: 'Categories',
};

// The categories view is a local-dev-only tool (the category hierarchy is still
// being built out). Hide it in the test/prod Docker builds, which run with
// NODE_ENV=production.
const CATEGORIES_ENABLED = process.env.NODE_ENV === 'development';

const VIEWS = (Object.keys(VIEW_LABELS) as View[]).filter(
  (v) => v !== 'categories' || CATEGORIES_ENABLED
);

const TOOLBAR_HEIGHT = 48;

const WikiArticles = () => {
  const [view, setView] = useState<View>('random');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [scroll_node, set_scroll_node] = useState<HTMLDivElement | null>(null);

  const trigger = useScrollTrigger({ target: scroll_node, threshold: 0 });
  const showBar = !trigger;

  const switchView = (v: View) => {
    setView(v);
    setDrawerOpen(false);
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Box
        sx={{
          overflow: 'hidden',
          maxHeight: showBar ? TOOLBAR_HEIGHT : 0,
          transition: 'max-height 0.2s ease',
          flexShrink: 0,
        }}
      >
        <AppBar position="static">
          <Toolbar variant="dense">
            <IconButton
              edge="start"
              color="inherit"
              aria-label="Open menu"
              data-testid="menu-button"
              onClick={() => setDrawerOpen(true)}
              sx={{ mr: 1 }}
            >
              <MenuIcon />
            </IconButton>
            <Typography variant="h6" component="div" data-testid="view-title">
              {VIEW_LABELS[view]}
            </Typography>
          </Toolbar>
        </AppBar>
      </Box>

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <List sx={{ width: 220 }}>
          {VIEWS.map((v) => (
            <ListItem key={v} disablePadding>
              <ListItemButton
                selected={view === v}
                data-testid={`view-${v}`}
                onClick={() => switchView(v)}
              >
                <ListItemText primary={VIEW_LABELS[v]} />
              </ListItemButton>
            </ListItem>
          ))}
          <Divider />
          <ListItem disablePadding>
            <ListItemButton
              component={NextLink}
              href="/privacy"
              onClick={() => setDrawerOpen(false)}
            >
              <ListItemText
                primary="Privacy"
                slotProps={{ primary: { variant: 'body2', color: 'text.secondary' } }}
              />
            </ListItemButton>
          </ListItem>
        </List>
      </Drawer>

      <Box
        sx={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}
        data-testid="feed-scroll"
        ref={(node: HTMLDivElement | null) => set_scroll_node(node)}
      >
        {view === 'random' && <RandomFeed />}
        {view === 'liked' && <VotedFeed vote={1} />}
        {view === 'disliked' && <VotedFeed vote={-1} />}
        {view === 'categories' && CATEGORIES_ENABLED && <CategoryFeed />}
      </Box>
    </Box>
  );
};

export default WikiArticles;
