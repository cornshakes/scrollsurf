'use client';

import { useState, useRef, useLayoutEffect, Fragment } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import type { SxProps } from '@mui/material/styles';
import type { Topic, LinkType } from '@/lib/db/types';

const TWO_ROWS_HEIGHT = 52; // 2 × 24px chips + 1 × 4px gap

export const CardTags = ({
  topics,
  categories,
  onTrack,
  sx,
}: {
  topics: Topic[];
  categories?: string[];
  onTrack: (link_type: LinkType, link_label: string) => void;
  sx?: SxProps;
}) => {
  const [expanded, set_expanded] = useState(false);
  const [has_overflow, set_has_overflow] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    set_has_overflow(el.scrollHeight > el.clientHeight);
  }, [topics, categories]);

  if (topics.length === 0 && (!categories || categories.length === 0)) {
    return null;
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0, ...sx }}>
      <Box
        ref={ref}
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 0.5,
          minWidth: 0,
          overflow: 'hidden',
          ...(expanded ? {} : { maxHeight: TWO_ROWS_HEIGHT }),
        }}
      >
        {topics.map(({ dataset, topic, dataset_url }) => {
          const topic_url = dataset_url ? `${dataset_url}/${topic.replace(/ /g, '_')}` : null;
          return (
            <Fragment key={`${dataset}::${topic}`}>
              <Chip
                label={dataset}
                size="small"
                color="default"
                component={dataset_url ? 'a' : 'div'}
                href={dataset_url ?? undefined}
                target={dataset_url ? '_blank' : undefined}
                rel={dataset_url ? 'noopener noreferrer' : undefined}
                clickable={!!dataset_url}
                data-testid={dataset_url ? 'link-dataset' : undefined}
                onClick={dataset_url ? () => onTrack('dataset', dataset) : undefined}
                sx={{ maxWidth: '100%' }}
              />
              <Chip
                label={topic}
                size="small"
                component={topic_url ? 'a' : 'div'}
                href={topic_url ?? undefined}
                target={topic_url ? '_blank' : undefined}
                rel={topic_url ? 'noopener noreferrer' : undefined}
                clickable={!!topic_url}
                data-testid={topic_url ? 'link-topic' : undefined}
                onClick={topic_url ? () => onTrack('topic', topic) : undefined}
                sx={{ maxWidth: '100%' }}
              />
            </Fragment>
          );
        })}
        {categories?.map((cat) => (
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
            data-testid="link-category"
            onClick={() => onTrack('category', cat)}
            sx={{ maxWidth: '100%' }}
          />
        ))}
      </Box>
      {(has_overflow || expanded) && (
        <Box sx={{ display: 'flex', justifyContent: 'center' }}>
          <IconButton
            size="small"
            onClick={() => set_expanded((prev) => !prev)}
            aria-label={expanded ? 'Show fewer' : 'Show more'}
            sx={{ p: 0.25 }}
          >
            {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
          </IconButton>
        </Box>
      )}
    </Box>
  );
};
