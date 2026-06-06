'use client';

import { useState, useEffect, useRef, useTransition } from 'react';
import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import Drawer from '@mui/material/Drawer';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
import MenuIcon from '@mui/icons-material/Menu';
import ThumbUpIcon from '@mui/icons-material/ThumbUp';
import ThumbDownIcon from '@mui/icons-material/ThumbDown';
import ExpandLess from '@mui/icons-material/ExpandLess';
import ExpandMore from '@mui/icons-material/ExpandMore';
import FolderIcon from '@mui/icons-material/Folder';
import {
  get_next_wiki_articles,
  get_voted_wiki_articles,
  set_article_like,
  get_wiki_topic_tree,
} from '@/app/actions';
import type { Article, TopicStat, TopicTree } from '@/lib/db';

type View = 'random' | 'liked' | 'disliked' | 'topics';

const PAGE_SIZE = 10;

const VIEW_LABELS: Record<View, string> = {
  random: 'Random articles',
  liked: 'Liked',
  disliked: 'Disliked',
  topics: 'Topics',
};

function ArticleCard({
  article,
  onVoteChange,
}: {
  article: Article;
  onVoteChange?: (id: number, value: -1 | 0 | 1) => void;
}) {
  const [like, setLike] = useState<-1 | 0 | 1>(article.like);

  function vote(value: -1 | 1) {
    const next = like === value ? 0 : value;
    setLike(next);
    set_article_like(article.id, next);
    onVoteChange?.(article.id, next);
  }

  return (
    <Box sx={{ maxWidth: 680, mx: 'auto', px: 4, py: 4, borderBottom: 1, borderColor: 'divider' }}>
      <Box sx={{ display: 'flex', gap: 2, mb: article.extract ? 2 : 0 }}>
        {article.image_url && (
          <Box
            component="img"
            src={article.image_url}
            sx={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 1, flexShrink: 0 }}
          />
        )}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h5" component="h2">
            <Link href={article.url} target="_blank" rel="noopener noreferrer" underline="hover">
              {article.title}
            </Link>
          </Typography>
          {article.description && (
            <Typography variant="body2" color="text.secondary">
              {article.description}
            </Typography>
          )}
        </Box>
        <Box sx={{ display: 'flex', gap: 0.5, flexShrink: 0 }}>
          <IconButton
            onClick={() => vote(1)}
            color={like === 1 ? 'primary' : 'default'}
            size="small"
          >
            <ThumbUpIcon fontSize="small" />
          </IconButton>
          <IconButton
            onClick={() => vote(-1)}
            color={like === -1 ? 'error' : 'default'}
            size="small"
          >
            <ThumbDownIcon fontSize="small" />
          </IconButton>
        </Box>
      </Box>
      {article.extract && (
        <Typography variant="body1" sx={{ mb: article.categories.length ? 2 : 0 }}>
          {article.extract}
        </Typography>
      )}
      {article.categories.length > 0 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
          {article.categories.map((cat) => (
            <Chip
              key={cat}
              label={cat}
              size="small"
              variant="outlined"
              component="a"
              href={`https://en.wikipedia.org/wiki/Category:${encodeURIComponent(cat)}`}
              target="_blank"
              rel="noopener noreferrer"
              clickable
            />
          ))}
        </Box>
      )}
    </Box>
  );
}

function RandomFeed() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [isPending, startTransition] = useTransition();
  const sentinelRef = useRef<HTMLDivElement>(null);

  function fetchNext() {
    startTransition(async () => {
      const batch = await get_next_wiki_articles(PAGE_SIZE);
      setArticles((prev) => [...prev, ...batch]);
    });
  }

  useEffect(() => {
    fetchNext();
  }, []);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !isPending) fetchNext();
      },
      { rootMargin: '200px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [isPending]);

  return (
    <Box>
      {articles.map((article) => (
        <ArticleCard key={article.id} article={article} />
      ))}
      <Box ref={sentinelRef} sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        {isPending && <CircularProgress />}
      </Box>
    </Box>
  );
}

function VotedFeed({ vote }: { vote: -1 | 1 }) {
  const [articles, setArticles] = useState<Article[]>([]);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    startTransition(async () => {
      setArticles(await get_voted_wiki_articles(vote));
    });
  }, [vote]);

  function handleVoteChange(id: number, newLike: -1 | 0 | 1) {
    setArticles((prev) => prev.filter((a) => (a.id === id ? newLike === vote : true)));
  }

  if (isPending)
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  if (articles.length === 0)
    return (
      <Typography sx={{ textAlign: 'center', py: 8, color: 'text.secondary' }}>
        Nothing here yet.
      </Typography>
    );

  return (
    <Box>
      {articles.map((article) => (
        <ArticleCard key={article.id} article={article} onVoteChange={handleVoteChange} />
      ))}
    </Box>
  );
}

function TopicLeaf({ topic }: { topic: TopicStat }) {
  return (
    <ListItem sx={{ pl: 5 }}>
      <ListItemText primary={topic.label} secondary={`${topic.article_count} articles`} />
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
        {topic.liked > 0 && (
          <Chip
            icon={<ThumbUpIcon />}
            label={topic.liked}
            size="small"
            color="primary"
            variant="outlined"
          />
        )}
        {topic.disliked > 0 && (
          <Chip
            icon={<ThumbDownIcon />}
            label={topic.disliked}
            size="small"
            color="error"
            variant="outlined"
          />
        )}
      </Box>
    </ListItem>
  );
}

function TopicNode({ name, topics }: { name: string; topics: TopicStat[] }) {
  const [open, setOpen] = useState(false);
  const total = topics.reduce((sum, t) => sum + t.article_count, 0);

  return (
    <>
      <ListItemButton onClick={() => setOpen((o) => !o)}>
        <FolderIcon sx={{ mr: 1.5, color: 'text.secondary' }} />
        <ListItemText primary={name} secondary={`${topics.length} topics · ${total} articles`} />
        {open ? <ExpandLess /> : <ExpandMore />}
      </ListItemButton>
      <Collapse in={open} unmountOnExit>
        <List disablePadding>
          {topics.map((topic) => (
            <TopicLeaf key={topic.topic} topic={topic} />
          ))}
        </List>
      </Collapse>
    </>
  );
}

function TopicsFeed() {
  const [tree, setTree] = useState<TopicTree | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    startTransition(async () => setTree(await get_wiki_topic_tree()));
  }, []);

  if (isPending && !tree)
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );

  if (!tree) return null;

  return (
    <Box sx={{ maxWidth: 680, mx: 'auto', px: 2, py: 2 }}>
      {tree.roots.length === 0 ? (
        <Typography sx={{ textAlign: 'center', py: 8, color: 'text.secondary' }}>
          No topics yet — browse a few articles and check back.
        </Typography>
      ) : (
        <List>
          {tree.roots.map((root) => (
            <TopicNode key={root.name} name={root.name} topics={root.topics} />
          ))}
        </List>
      )}
    </Box>
  );
}

export default function WikiArticles() {
  const [view, setView] = useState<View>('random');
  const [drawerOpen, setDrawerOpen] = useState(false);

  function switchView(v: View) {
    setView(v);
    setDrawerOpen(false);
  }

  return (
    <>
      <AppBar position="sticky">
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

      {view === 'random' && <RandomFeed />}
      {view === 'liked' && <VotedFeed vote={1} />}
      {view === 'disliked' && <VotedFeed vote={-1} />}
      {view === 'topics' && <TopicsFeed />}
    </>
  );
}
