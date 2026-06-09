'use client';

import { useState } from 'react';
import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Chip from '@mui/material/Chip';
import ThumbUpIcon from '@mui/icons-material/ThumbUp';
import ThumbDownIcon from '@mui/icons-material/ThumbDown';
import { set_article_like } from '@/app/actions';
import type { Article } from '@/lib/db';
import { useConsent } from './CookieConsent';

export const ArticleCard = ({
  article,
  onVoteChange,
}: {
  article: Article;
  onVoteChange?: (type: 'article', id: number, value: -1 | 0 | 1) => void;
}) => {
  const [like, setLike] = useState<-1 | 0 | 1>(article.like);
  const { consent, openConsent } = useConsent();

  const vote = (value: -1 | 1) => {
    if (consent !== 'granted') {
      openConsent();
      return;
    }
    const next = like === value ? 0 : value;
    setLike(next);
    set_article_like('article', article.id, next);
    onVoteChange?.('article', article.id, next);
  };

  const vote_buttons = (
    <Box sx={{ display: 'flex', gap: 0.5, flexShrink: 0 }}>
      <IconButton onClick={() => vote(1)} color={like === 1 ? 'primary' : 'default'} size="small">
        <ThumbUpIcon fontSize="small" />
      </IconButton>
      <IconButton onClick={() => vote(-1)} color={like === -1 ? 'error' : 'default'} size="small">
        <ThumbDownIcon fontSize="small" />
      </IconButton>
    </Box>
  );

  const has_tags = article.categories.length > 0 || article.topics.length > 0;

  return (
    <Box
      sx={{
        maxWidth: 680,
        mx: 'auto',
        px: { xs: 2, sm: 4 },
        py: 4,
        borderBottom: 1,
        borderColor: 'divider',
      }}
    >
      <Box sx={{ display: 'flex', gap: 2, mb: article.extract ? 2 : 0, alignItems: 'flex-start' }}>
        {article.image_url && (
          <Box
            component="img"
            src={article.image_url}
            sx={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 1, flexShrink: 0 }}
          />
        )}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="h5" component="h2">
                <Link
                  href={article.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  underline="hover"
                >
                  {article.title}
                </Link>
              </Typography>
              {article.description && (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {article.description}
                </Typography>
              )}
            </Box>
            {/* Vote buttons — desktop only (sm+) */}
            <Box sx={{ display: { xs: 'none', sm: 'flex' }, gap: 0.5, flexShrink: 0 }}>
              {vote_buttons}
            </Box>
          </Box>
          {/* Vote buttons — mobile only (xs) */}
          <Box sx={{ display: { xs: 'flex', sm: 'none' }, mt: 0.5 }}>{vote_buttons}</Box>
        </Box>
      </Box>
      {article.extract && (
        <Typography
          variant="body1"
          sx={{
            mb: has_tags ? 2 : 0,
            display: '-webkit-box',
            WebkitLineClamp: 5,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {article.extract}
        </Typography>
      )}
      {has_tags && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
          {article.topics.map(({ dataset, topic, dataset_url }) => {
            const topic_url = dataset_url ? `${dataset_url}/${topic.replace(/ /g, '_')}` : null;
            return (
              <Box key={`${dataset}::${topic}`} sx={{ display: 'flex', gap: 0.5 }}>
                <Chip
                  label={dataset}
                  size="small"
                  color="default"
                  component={dataset_url ? 'a' : 'div'}
                  href={dataset_url ?? undefined}
                  target={dataset_url ? '_blank' : undefined}
                  rel={dataset_url ? 'noopener noreferrer' : undefined}
                  clickable={!!dataset_url}
                />
                <Chip
                  label={topic}
                  size="small"
                  component={topic_url ? 'a' : 'div'}
                  href={topic_url ?? undefined}
                  target={topic_url ? '_blank' : undefined}
                  rel={topic_url ? 'noopener noreferrer' : undefined}
                  clickable={!!topic_url}
                />
              </Box>
            );
          })}
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
};
