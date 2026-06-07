'use client';

import { useState, useEffect, useTransition } from 'react';
import Box from '@mui/material/Box';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Collapse from '@mui/material/Collapse';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import ThumbUpIcon from '@mui/icons-material/ThumbUp';
import ThumbDownIcon from '@mui/icons-material/ThumbDown';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { get_wiki_topic_tree } from '@/app/actions';
import type { TopicTree } from '@/lib/db';

export const TopicsFeed = () => {
  const [topics, setTopics] = useState<TopicTree | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    startTransition(async () => setTopics(await get_wiki_topic_tree()));
  }, []);

  const toggle_dataset = (dataset: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(dataset)) next.delete(dataset);
      else next.add(dataset);
      return next;
    });

  if (isPending && !topics)
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );

  if (!topics) return null;

  const vote_chips = (liked: number, disliked: number) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
      {liked > 0 && (
        <Chip
          icon={<ThumbUpIcon />}
          label={liked}
          size="small"
          color="primary"
          variant="outlined"
        />
      )}
      {disliked > 0 && (
        <Chip
          icon={<ThumbDownIcon />}
          label={disliked}
          size="small"
          color="error"
          variant="outlined"
        />
      )}
    </Box>
  );

  return (
    <Box sx={{ width: '100%', maxWidth: 680, mx: 'auto', px: 2, py: 2 }}>
      {topics.length === 0 ? (
        <Typography sx={{ textAlign: 'center', py: 8, color: 'text.secondary' }}>
          No topics yet — browse a few articles and check back.
        </Typography>
      ) : (
        topics.map((d) => {
          const is_open = !collapsed.has(d.dataset);
          return (
            <Box key={d.dataset} sx={{ mb: 3 }}>
              <ListItemButton onClick={() => toggle_dataset(d.dataset)} sx={{ borderRadius: 1 }}>
                {is_open ? <ExpandMoreIcon /> : <ChevronRightIcon />}
                <ListItemText
                  primary={
                    <Typography variant="h6" component="h2">
                      {d.dataset}
                    </Typography>
                  }
                  secondary={`${d.article_count} articles · ${d.topics.length} topics`}
                  sx={{ ml: 1 }}
                />
                {vote_chips(d.liked, d.disliked)}
              </ListItemButton>
              <Collapse in={is_open} timeout="auto" unmountOnExit>
                <List dense>
                  {d.topics.map((t) => (
                    <ListItem key={t.topic} sx={{ pl: 6 }}>
                      <ListItemText primary={t.topic} secondary={`${t.article_count} articles`} />
                      {vote_chips(t.liked, t.disliked)}
                    </ListItem>
                  ))}
                </List>
              </Collapse>
            </Box>
          );
        })
      )}
    </Box>
  );
};
