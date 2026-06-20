'use client';

import { useState } from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import { vote_feed_item, record_link_click } from '@/app/actions';
import type { Picture, LinkType } from '@/lib/db';
import { useConsent } from './CookieConsent';
import { CardTags } from './CardTags';

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
    vote_feed_item(picture.id, next);
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
      data-item-title={picture.title}
      sx={{ maxWidth: 680, mx: 'auto', px: 4, py: 4, borderBottom: 1, borderColor: 'divider' }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
        <Paper elevation={3} sx={{ borderRadius: 2, p: 2, display: 'inline-block' }}>
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
                maxWidth: '100%',
                maxHeight: 480,
                width: 'auto',
                height: 'auto',
              }}
            />
          </Link>
        </Paper>
      </Box>
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
            <ArrowUpwardIcon fontSize="small" />
          </IconButton>
          <IconButton
            onClick={() => vote(-1)}
            color={like === -1 ? 'error' : 'default'}
            size="small"
            aria-label="Dislike"
            aria-pressed={like === -1}
            data-testid="vote-down"
          >
            <ArrowDownwardIcon fontSize="small" />
          </IconButton>
        </Box>
      </Box>
      <CardTags topics={picture.topics} onTrack={track} sx={{ mt: 2 }} />
    </Box>
  );
};
