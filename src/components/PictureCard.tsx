'use client';

import { useState } from 'react';
import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import ThumbUpIcon from '@mui/icons-material/ThumbUp';
import ThumbDownIcon from '@mui/icons-material/ThumbDown';
import { set_article_like, record_link_click } from '@/app/actions';
import type { Picture, LinkType } from '@/lib/db';
import { useConsent } from './CookieConsent';

export const PictureCard = ({
  picture,
  onVoteChange,
}: {
  picture: Picture;
  onVoteChange?: (type: 'picture', id: number, value: -1 | 0 | 1) => void;
}) => {
  const [like, setLike] = useState<-1 | 0 | 1>(picture.like);
  const { consent, openConsent } = useConsent();

  const vote = (value: -1 | 1) => {
    if (consent !== 'granted') {
      openConsent();
      return;
    }
    const next = like === value ? 0 : value;
    setLike(next);
    set_article_like('picture', picture.id, next);
    onVoteChange?.('picture', picture.id, next);
  };

  // Only log followed links once consent is granted — skip the request entirely
  // otherwise (the server would no-op anyway).
  const track = (link_type: LinkType, link_label: string) => {
    if (consent !== 'granted') {
      return;
    }
    record_link_click('picture', picture.id, link_type, link_label);
  };

  return (
    <Box
      data-testid="feed-card"
      data-card-type="picture"
      sx={{ maxWidth: 680, mx: 'auto', px: 4, py: 4, borderBottom: 1, borderColor: 'divider' }}
    >
      <Link
        href={picture.url}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="link-title"
        onClick={() => track('title', picture.title)}
      >
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
        <Box sx={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
          {picture.caption && (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{
                fontStyle: 'italic',
                display: '-webkit-box',
                WebkitLineClamp: 3,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {picture.caption}
            </Typography>
          )}
          {picture.credit && (
            <Typography variant="body2" color="text.secondary" noWrap>
              by{' '}
              <Link
                href={`https://commons.wikimedia.org/wiki/User:${encodeURIComponent(picture.credit)}`}
                target="_blank"
                rel="noopener noreferrer"
                underline="hover"
                color="inherit"
                data-testid="link-by"
                onClick={() => track('by', picture.credit ?? '')}
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
            aria-label="Like"
            aria-pressed={like === 1}
            data-testid="vote-up"
          >
            <ThumbUpIcon fontSize="small" />
          </IconButton>
          <IconButton
            onClick={() => vote(-1)}
            color={like === -1 ? 'error' : 'default'}
            size="small"
            aria-label="Dislike"
            aria-pressed={like === -1}
            data-testid="vote-down"
          >
            <ThumbDownIcon fontSize="small" />
          </IconButton>
        </Box>
      </Box>
    </Box>
  );
};
