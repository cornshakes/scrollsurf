'use client';

import { useState, useEffect, useTransition } from 'react';
import Box from '@mui/material/Box';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import ThumbUpIcon from '@mui/icons-material/ThumbUp';
import ThumbDownIcon from '@mui/icons-material/ThumbDown';
import { get_wiki_topic_tree } from '@/app/actions';
import type { TopicTree } from '@/lib/db';

export const TopicsFeed = () => {
  const [topics, setTopics] = useState<TopicTree | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    startTransition(async () => setTopics(await get_wiki_topic_tree()));
  }, []);

  if (isPending && !topics)
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );

  if (!topics) return null;

  return (
    <Box sx={{ maxWidth: 680, mx: 'auto', px: 2, py: 2 }}>
      {topics.length === 0 ? (
        <Typography sx={{ textAlign: 'center', py: 8, color: 'text.secondary' }}>
          No topics yet — browse a few articles and check back.
        </Typography>
      ) : (
        <List>
          {topics.map((t) => (
            <ListItem key={t.topic}>
              <ListItemText primary={t.topic} secondary={`${t.article_count} articles`} />
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
                {t.liked > 0 && (
                  <Chip
                    icon={<ThumbUpIcon />}
                    label={t.liked}
                    size="small"
                    color="primary"
                    variant="outlined"
                  />
                )}
                {t.disliked > 0 && (
                  <Chip
                    icon={<ThumbDownIcon />}
                    label={t.disliked}
                    size="small"
                    color="error"
                    variant="outlined"
                  />
                )}
              </Box>
            </ListItem>
          ))}
        </List>
      )}
    </Box>
  );
};
