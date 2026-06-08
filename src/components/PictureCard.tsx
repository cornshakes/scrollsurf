'use client';

import { useState } from 'react';
import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import ThumbUpIcon from '@mui/icons-material/ThumbUp';
import ThumbDownIcon from '@mui/icons-material/ThumbDown';
import { set_article_like } from '@/app/actions';
import type { Picture } from '@/lib/db';

export const PictureCard = ({
  picture,
  onVoteChange,
}: {
  picture: Picture;
  onVoteChange?: (type: 'picture', id: number, value: -1 | 0 | 1) => void;
}) => {
  const [like, setLike] = useState<-1 | 0 | 1>(picture.like);

  const vote = (value: -1 | 1) => {
    const next = like === value ? 0 : value;
    setLike(next);
    set_article_like('picture', picture.id, next);
    onVoteChange?.('picture', picture.id, next);
  };

  return (
    <Box sx={{ maxWidth: 680, mx: 'auto', px: 4, py: 4, borderBottom: 1, borderColor: 'divider' }}>
      <Link href={picture.url} target="_blank" rel="noopener noreferrer">
        <Box
          component="img"
          src={picture.image_url}
          loading="lazy"
          sx={{
            display: 'block',
            width: '100%',
            maxHeight: 480,
            objectFit: 'contain',
            borderRadius: 1,
            mb: 2,
          }}
        />
      </Link>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {picture.caption && (
            <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
              {picture.caption}
            </Typography>
          )}
          {picture.credit && (
            <Typography variant="body2" color="text.secondary">
              by{' '}
              <Link
                href={`https://commons.wikimedia.org/wiki/User:${encodeURIComponent(picture.credit)}`}
                target="_blank"
                rel="noopener noreferrer"
                underline="hover"
                color="inherit"
              >
                {picture.credit}
              </Link>
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
    </Box>
  );
};
