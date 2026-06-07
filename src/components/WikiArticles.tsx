'use client';

import { useState } from 'react';
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
import MenuIcon from '@mui/icons-material/Menu';
import { RandomFeed } from './RandomFeed';
import { VotedFeed } from './VotedFeed';
import { TopicsFeed } from './TopicsFeed';
import { CategoryFeed } from './CategoryFeed';

type View = 'random' | 'liked' | 'disliked' | 'topics' | 'categories';

const VIEW_LABELS: Record<View, string> = {
  random: 'Random articles',
  liked: 'Liked',
  disliked: 'Disliked',
  topics: 'Topics',
  categories: 'Categories',
};

const WikiArticles = () => {
  const [view, setView] = useState<View>('random');
  const [drawerOpen, setDrawerOpen] = useState(false);

  const switchView = (v: View) => {
    setView(v);
    setDrawerOpen(false);
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <AppBar position="static">
        <Toolbar variant="dense">
          <IconButton
            edge="start"
            color="inherit"
            onClick={() => setDrawerOpen(true)}
            sx={{ mr: 1 }}
          >
            <MenuIcon />
          </IconButton>
          <Typography variant="h6" component="div">
            {VIEW_LABELS[view]}
          </Typography>
        </Toolbar>
      </AppBar>

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <List sx={{ width: 220 }}>
          {(Object.keys(VIEW_LABELS) as View[]).map((v) => (
            <ListItem key={v} disablePadding>
              <ListItemButton selected={view === v} onClick={() => switchView(v)}>
                <ListItemText primary={VIEW_LABELS[v]} />
              </ListItemButton>
            </ListItem>
          ))}
        </List>
      </Drawer>

      <Box sx={{ flex: 1, overflow: 'auto' }}>
        {view === 'random' && <RandomFeed />}
        {view === 'liked' && <VotedFeed vote={1} />}
        {view === 'disliked' && <VotedFeed vote={-1} />}
        {view === 'topics' && <TopicsFeed />}
        {view === 'categories' && <CategoryFeed />}
      </Box>
    </Box>
  );
};

export default WikiArticles;
