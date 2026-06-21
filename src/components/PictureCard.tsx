'use client';

import { useState } from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import { vote_feed_item, record_link_click } from '@/app/actions';
import type { Picture, LinkType } from '@/lib/db';
import { useConsent } from './CookieConsent';
import { CardTags } from './CardTags';
import { VoteButtons } from './VoteButtons';

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
      sx={{
        maxWidth: 680,
        mx: 'auto',
        px: { xs: 2, sm: 4 },
        py: 4,
        borderBottom: 1,
        borderColor: 'divider',
      }}
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
      <Box sx={{ minWidth: 0, overflow: 'hidden', textAlign: 'center' }}>
        {picture.caption && (
          // The caption links to the original too (same as the image), but keeps
          // its plain italic caption look — no underline, inherited color.
          <Link
            href={picture.url}
            target="_blank"
            rel="noopener noreferrer"
            underline="none"
            color="inherit"
            onClick={() => track('title', picture.title)}
          >
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
          </Link>
        )}
        {picture.credit && (
          <Typography variant="body2" color="text.secondary" noWrap sx={{ mt: 1 }}>
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
      <CardTags
        topics={picture.topics}
        onTrack={track}
        leading={<VoteButtons like={like} onVote={vote} />}
        sx={{ mt: 2 }}
      />
    </Box>
  );
};
