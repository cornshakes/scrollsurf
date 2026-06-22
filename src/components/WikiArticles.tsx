'use client';

import { useState, useLayoutEffect, useRef } from 'react';
import NextLink from 'next/link';
import Image from 'next/image';
import useScrollTrigger from '@mui/material/useScrollTrigger';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import Drawer from '@mui/material/Drawer';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Divider from '@mui/material/Divider';
import { RandomFeed } from './RandomFeed';
import { VotedFeed } from './VotedFeed';
import { CategoryFeed } from './CategoryFeed';
import { useFeed } from './FeedContext';

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

// The floating menu icon is always the logo. On voted views a tiny badge arrow
// is overlaid at the bottom-right corner to indicate the active filter.
const renderViewIcon = (v: View) => {
  const badge =
    v === 'liked' ? (
      <ArrowUpwardIcon
        sx={{ fontSize: 16, position: 'absolute', bottom: -3, right: -3, color: 'success.main' }}
      />
    ) : v === 'disliked' ? (
      <ArrowDownwardIcon
        sx={{ fontSize: 16, position: 'absolute', bottom: -3, right: -3, color: 'error.main' }}
      />
    ) : null;

  return (
    <Box sx={{ position: 'relative', width: 32, height: 32 }}>
      <Image src="/menu-icon.png" alt="" width={32} height={32} />
      {badge}
    </Box>
  );
};

const WikiArticles = () => {
  const [view, setView] = useState<View>('random');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [scroll_node, set_scroll_node] = useState<HTMLDivElement | null>(null);
  const { scrollTopRef } = useFeed();
  const scroll_nodeRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (view === 'random' && scroll_nodeRef.current) {
      scroll_nodeRef.current.scrollTop = scrollTopRef.current;
    }
  }, [view, scroll_node, scrollTopRef]);

  // Default hysteresis encodes scroll direction: true when scrolling down,
  // false when scrolling up or at the very top.
  const trigger = useScrollTrigger({ target: scroll_node });
  const showIcon = !trigger;

  const switchView = (v: View) => {
    setView(v);
    setDrawerOpen(false);
  };

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        position: 'relative',
      }}
    >
      <IconButton
        color="inherit"
        aria-label="Open menu"
        data-testid="menu-button"
        onClick={() => setDrawerOpen(true)}
        sx={{
          position: 'absolute',
          top: 8,
          left: 8,
          zIndex: (theme) => theme.zIndex.appBar,
          bgcolor: 'background.paper',
          boxShadow: 1,
          '&:hover': { bgcolor: 'background.paper' },
          opacity: showIcon ? 1 : 0,
          pointerEvents: showIcon ? 'auto' : 'none',
          transition: 'opacity 0.2s ease',
        }}
      >
        {renderViewIcon(view)}
      </IconButton>

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
            <ListItemButton component={NextLink} href="/about" onClick={() => setDrawerOpen(false)}>
              <ListItemText
                primary="About"
                slotProps={{ primary: { variant: 'body2', color: 'text.secondary' } }}
              />
            </ListItemButton>
          </ListItem>
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
        sx={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', overflowAnchor: 'none' }}
        data-testid="feed-scroll"
        ref={(node: HTMLDivElement | null) => {
          scroll_nodeRef.current = node;
          set_scroll_node(node);
        }}
        onScroll={(event) => {
          if (view === 'random') {
            scrollTopRef.current = event.currentTarget.scrollTop;
          }
        }}
      >
        <Typography variant="h6" component="h1" sx={{ pl: 8, pr: 2, pt: 2.2, pb: 0.5 }}>
          Scrollsurf
        </Typography>
        {view === 'random' && <RandomFeed />}
        {view === 'liked' && <VotedFeed vote={1} />}
        {view === 'disliked' && <VotedFeed vote={-1} />}
        {view === 'categories' && CATEGORIES_ENABLED && <CategoryFeed />}
      </Box>
    </Box>
  );
};

export default WikiArticles;
