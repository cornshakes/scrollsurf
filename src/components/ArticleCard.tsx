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

export const ArticleCard = ({
  article,
  onVoteChange,
}: {
  article: Article;
  onVoteChange?: (id: number, value: -1 | 0 | 1) => void;
}) => {
  const [like, setLike] = useState<-1 | 0 | 1>(article.like);

  const vote = (value: -1 | 1) => {
    const next = like === value ? 0 : value;
    setLike(next);
    set_article_like(article.id, next);
    onVoteChange?.(article.id, next);
  };

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
};
