'use client';

import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import type { SxProps } from '@mui/material/styles';
import type { Topic, LinkType } from '@/lib/db/types';

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
  if (topics.length === 0 && (!categories || categories.length === 0)) {
    return null;
  }

  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, minWidth: 0, ...sx }}>
      {topics.map(({ dataset, topic, dataset_url }) => {
        const topic_url = dataset_url ? `${dataset_url}/${topic.replace(/ /g, '_')}` : null;
        return (
          <Box
            key={`${dataset}::${topic}`}
            sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, minWidth: 0, maxWidth: '100%' }}
          >
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
          </Box>
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
  );
};
