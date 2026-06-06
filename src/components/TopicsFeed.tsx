'use client';

import { useState, useEffect, useTransition, type ReactElement } from 'react';
import Box from '@mui/material/Box';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import ThumbUpIcon from '@mui/icons-material/ThumbUp';
import ThumbDownIcon from '@mui/icons-material/ThumbDown';
import ExpandLess from '@mui/icons-material/ExpandLess';
import ExpandMore from '@mui/icons-material/ExpandMore';
import FolderIcon from '@mui/icons-material/Folder';
import { get_wiki_topic_tree } from '@/app/actions';
import type { TopicStat, TopicTree } from '@/lib/db';

const TopicLeaf = ({
  topic,
  indent,
  display_label,
}: {
  topic: TopicStat;
  indent: number;
  display_label?: string;
}) => {
  const label = display_label ?? topic.label;
  return (
    <ListItem sx={{ pl: indent }}>
      <ListItemText primary={label} secondary={`${topic.article_count} articles`} />
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
};

const TopicGroup = ({
  name,
  topics,
  indent,
}: {
  name: string;
  topics: TopicStat[];
  indent: number;
}): ReactElement | null => {
  const [open, setOpen] = useState(false);

  const nested = new Map<string, TopicStat[]>();
  for (const topic of topics) {
    const dot_idx = topic.label.indexOf('.');
    const first_segment = dot_idx > 0 ? topic.label.slice(0, dot_idx) : topic.label;
    if (first_segment.endsWith('*')) continue;
    let list = nested.get(first_segment);
    if (!list) {
      list = [];
      nested.set(first_segment, list);
    }
    list.push({
      ...topic,
      label: dot_idx > 0 ? topic.label.slice(dot_idx + 1) : topic.label,
    });
  }

  const sorted_nested = Array.from(nested.entries()).sort((a, b) => a[0].localeCompare(b[0]));

  if (
    sorted_nested.length === 1 &&
    sorted_nested[0][0] === name &&
    !sorted_nested[0][1].some((t) => t.label.includes('.'))
  ) {
    const leaf = sorted_nested[0][1][0];
    return <TopicLeaf topic={leaf} indent={indent} display_label={name} />;
  }

  const total = Array.from(nested.values()).reduce(
    (sum, list) => sum + list.reduce((s, t) => s + t.article_count, 0),
    0
  );
  const total_liked = Array.from(nested.values()).reduce(
    (sum, list) => sum + list.reduce((s, t) => s + t.liked, 0),
    0
  );
  const total_disliked = Array.from(nested.values()).reduce(
    (sum, list) => sum + list.reduce((s, t) => s + t.disliked, 0),
    0
  );

  return (
    <>
      <ListItemButton onClick={() => setOpen((o) => !o)} sx={{ pl: indent }}>
        <FolderIcon sx={{ mr: 1.5, color: 'text.secondary', fontSize: '1.2rem' }} />
        <ListItemText primary={name} secondary={`${total} articles`} />
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0, mr: 2 }}>
          {total_liked > 0 && (
            <Chip
              icon={<ThumbUpIcon />}
              label={total_liked}
              size="small"
              color="primary"
              variant="outlined"
            />
          )}
          {total_disliked > 0 && (
            <Chip
              icon={<ThumbDownIcon />}
              label={total_disliked}
              size="small"
              color="error"
              variant="outlined"
            />
          )}
        </Box>
        {open ? <ExpandLess /> : <ExpandMore />}
      </ListItemButton>
      <Collapse in={open} unmountOnExit>
        <List disablePadding>
          {sorted_nested.map(([segment_name, segment_topics]) => {
            const has_further_nesting = segment_topics.some((t) => t.label.includes('.'));
            if (segment_topics.length === 1 && !has_further_nesting) {
              return (
                <TopicLeaf
                  key={segment_topics[0].topic}
                  topic={segment_topics[0]}
                  indent={indent + 3}
                  display_label={segment_name}
                />
              );
            }
            return (
              <TopicGroup
                key={segment_name}
                name={segment_name}
                topics={segment_topics}
                indent={indent + 3}
              />
            );
          })}
        </List>
      </Collapse>
    </>
  );
};

const TopicRoot = ({ name, topics }: { name: string; topics: TopicStat[] }) => {
  const [open, setOpen] = useState(false);

  const grouped = new Map<string, TopicStat[]>();
  for (const topic of topics) {
    const first_dot = topic.label.indexOf('.');
    const group_key = first_dot > 0 ? topic.label.slice(0, first_dot) : topic.label;
    if (group_key.endsWith('*')) continue;
    let list = grouped.get(group_key);
    if (!list) {
      list = [];
      grouped.set(group_key, list);
    }
    list.push({
      ...topic,
      label: first_dot > 0 ? topic.label.slice(first_dot + 1) : topic.label,
    });
  }

  const sorted_groups = Array.from(grouped.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  const total = Array.from(grouped.values()).reduce(
    (sum, list) => sum + list.reduce((s, t) => s + t.article_count, 0),
    0
  );
  const total_liked = Array.from(grouped.values()).reduce(
    (sum, list) => sum + list.reduce((s, t) => s + t.liked, 0),
    0
  );
  const total_disliked = Array.from(grouped.values()).reduce(
    (sum, list) => sum + list.reduce((s, t) => s + t.disliked, 0),
    0
  );

  return (
    <>
      <ListItemButton onClick={() => setOpen((o) => !o)}>
        <FolderIcon sx={{ mr: 1.5, color: 'text.secondary' }} />
        <ListItemText primary={name} secondary={`${total} articles`} />
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0, mr: 2 }}>
          {total_liked > 0 && (
            <Chip
              icon={<ThumbUpIcon />}
              label={total_liked}
              size="small"
              color="primary"
              variant="outlined"
            />
          )}
          {total_disliked > 0 && (
            <Chip
              icon={<ThumbDownIcon />}
              label={total_disliked}
              size="small"
              color="error"
              variant="outlined"
            />
          )}
        </Box>
        {open ? <ExpandLess /> : <ExpandMore />}
      </ListItemButton>
      <Collapse in={open} unmountOnExit>
        <List disablePadding>
          {sorted_groups.map(([group_name, group_topics]) => (
            <TopicGroup key={group_name} name={group_name} topics={group_topics} indent={4} />
          ))}
        </List>
      </Collapse>
    </>
  );
};

export const TopicsFeed = () => {
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
            <TopicRoot key={root.name} name={root.name} topics={root.topics} />
          ))}
        </List>
      )}
    </Box>
  );
};
