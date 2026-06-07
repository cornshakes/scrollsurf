'use client';

import { useState, useEffect, useTransition } from 'react';
import Box from '@mui/material/Box';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import Collapse from '@mui/material/Collapse';
import Chip from '@mui/material/Chip';
import Checkbox from '@mui/material/Checkbox';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import ThumbUpIcon from '@mui/icons-material/ThumbUp';
import ThumbDownIcon from '@mui/icons-material/ThumbDown';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import {
  get_wiki_topic_tree,
  set_wiki_dataset_enabled,
  get_wiki_datasets_enabled,
} from '@/app/actions';
import type { TopicTree } from '@/lib/db';

export const TopicsFeed = () => {
  const [topics, setTopics] = useState<TopicTree | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    startTransition(async () => {
      const [tree, dataset_enabled] = await Promise.all([
        get_wiki_topic_tree(),
        get_wiki_datasets_enabled(),
      ]);
      setTopics(tree);
      setEnabled(dataset_enabled);
      setCollapsed(new Set(tree.map((d) => d.dataset)));
    });
  }, []);

  const toggle_dataset = (dataset: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(dataset)) next.delete(dataset);
      else next.add(dataset);
      return next;
    });

  const toggle_dataset_enabled = (dataset: string) => {
    const new_enabled = !enabled[dataset];
    setEnabled((prev) => ({ ...prev, [dataset]: new_enabled }));
    startTransition(async () => {
      await set_wiki_dataset_enabled(dataset, new_enabled);
    });
  };

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
            <Box key={d.dataset} sx={{ mb: 1, m: 0 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', px: 1, gap: 0.25 }}>
                <IconButton
                  onClick={() => toggle_dataset(d.dataset)}
                  size="small"
                  aria-label={is_open ? `Collapse ${d.dataset}` : `Expand ${d.dataset}`}
                  sx={{ p: 0.5 }}
                >
                  {is_open ? <ExpandMoreIcon /> : <ChevronRightIcon />}
                </IconButton>
                <Checkbox
                  checked={enabled[d.dataset] ?? true}
                  onChange={() => toggle_dataset_enabled(d.dataset)}
                  size="small"
                  aria-label={`Include ${d.dataset} in random articles`}
                  sx={{ p: 0.5 }}
                />
                <Typography variant="subtitle2" sx={{ fontWeight: 600, minWidth: 'fit-content' }}>
                  {d.dataset}
                </Typography>
                {d.source_url && (
                  <IconButton
                    component="a"
                    href={d.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    size="small"
                    aria-label={`Open ${d.dataset} source on Wikipedia`}
                    sx={{ p: 0.5 }}
                  >
                    <OpenInNewIcon fontSize="small" />
                  </IconButton>
                )}
                <Typography
                  variant="caption"
                  sx={{ color: 'text.secondary', minWidth: 'fit-content' }}
                >
                  {d.article_count} articles · {d.topics.length} topics
                </Typography>
                {vote_chips(d.liked, d.disliked)}
              </Box>
              <Collapse in={is_open} timeout="auto" unmountOnExit sx={{ mt: -0.5 }}>
                <List dense sx={{ py: 0 }}>
                  {d.topics.map((t) => (
                    <ListItem
                      key={t.topic}
                      sx={{ pl: 6, display: 'flex', alignItems: 'center', gap: 0.25, py: 0.5 }}
                    >
                      <Typography variant="body2" sx={{ minWidth: 'fit-content' }}>
                        {t.topic}
                      </Typography>
                      <Typography
                        variant="caption"
                        sx={{ color: 'text.secondary', minWidth: 'fit-content' }}
                      >
                        {t.article_count} articles
                      </Typography>
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
