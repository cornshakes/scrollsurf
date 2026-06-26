'use client';

import { useState, useRef, useLayoutEffect, Fragment } from 'react';
import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { alpha } from '@mui/material/styles';
import type { SxProps, Theme } from '@mui/material/styles';
import type { Topic, LinkType } from '@/lib/db/types';

const ROW_PADDING = 6; // breathing room so chip glows aren't clipped by overflow
// top padding + 2 × 24px chips + 1 × 4px gap, clipped just below row 2 so the
// 3rd row (which flows after only a 4px gap) stays hidden.
const TWO_ROWS_HEIGHT = ROW_PADDING + 52 + 2;

// Primary tint + soft glow so dataset/topic chips stand out from the plain
// outlined category chips. The glow is softer in light mode (it reads stronger
// on the pale background) and brighter in dark mode.
const accent_sx: SxProps<Theme> = (theme) => {
  const glow = theme.palette.primary.main;
  return {
    maxWidth: '100%',
    bgcolor: alpha(glow, 0.12),
    boxShadow: `0 0 6px ${alpha(glow, 0.22)}`,
    '&:hover': { boxShadow: `0 0 8px ${alpha(glow, 0.32)}` },
    ...theme.applyStyles('dark', {
      boxShadow: `0 0 8px ${alpha(glow, 0.5)}`,
      '&:hover': { boxShadow: `0 0 12px ${alpha(glow, 0.7)}` },
    }),
  };
};

export const CardTags = ({
  topics,
  categories,
  onTrack,
  leading,
  sx,
}: {
  topics: Topic[];
  categories?: string[];
  onTrack: (link_type: LinkType, link_label: string) => void;
  // Rendered as the first element of the chip row (e.g. the vote control).
  leading?: ReactNode;
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

  if (!leading && topics.length === 0 && (!categories || categories.length === 0)) {
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
          p: `${ROW_PADDING}px`,
          mx: `-${ROW_PADDING}px`, // cancel the padding's horizontal indent
          overflow: 'hidden',
          ...(expanded ? {} : { maxHeight: TWO_ROWS_HEIGHT }),
        }}
      >
        {leading}
        {(() => {
          const seen = new Set<string>();
          return topics.flatMap(({ dataset, topic, bucket, dataset_url }) => {
            const key = `${dataset}::${bucket}`;
            if (seen.has(key)) {
              return [];
            }
            seen.add(key);
            const topic_url = dataset_url ? `${dataset_url}/${topic.replace(/ /g, '_')}` : null;
            return [
              <Fragment key={key}>
                <Chip
                  label={dataset}
                  size="small"
                  color="primary"
                  variant="outlined"
                  component={dataset_url ? 'a' : 'div'}
                  href={dataset_url ?? undefined}
                  target={dataset_url ? '_blank' : undefined}
                  rel={dataset_url ? 'noopener noreferrer' : undefined}
                  clickable={!!dataset_url}
                  data-testid={dataset_url ? 'link-dataset' : undefined}
                  onClick={dataset_url ? () => onTrack('dataset', dataset) : undefined}
                  sx={accent_sx}
                />
                <Chip
                  label={bucket}
                  size="small"
                  color="primary"
                  variant="outlined"
                  component={topic_url ? 'a' : 'div'}
                  href={topic_url ?? undefined}
                  target={topic_url ? '_blank' : undefined}
                  rel={topic_url ? 'noopener noreferrer' : undefined}
                  clickable={!!topic_url}
                  data-testid={topic_url ? 'link-topic' : undefined}
                  onClick={topic_url ? () => onTrack('topic', topic) : undefined}
                  sx={accent_sx}
                />
              </Fragment>,
            ];
          });
        })()}
        {categories?.map((cat) => (
          <Chip
            key={cat}
            label={cat}
            size="small"
            color="primary"
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
