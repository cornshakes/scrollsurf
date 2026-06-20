'use client';

import { useState } from 'react';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import ThumbUpIcon from '@mui/icons-material/ThumbUp';
import ThumbDownIcon from '@mui/icons-material/ThumbDown';
import { vote_feed_item, record_link_click } from '@/app/actions';
import type { Quote, LinkType } from '@/lib/db';
import { useConsent } from './CookieConsent';

export const QuoteCard = ({
  quote,
  onVoteChange,
}: {
  quote: Quote;
  onVoteChange?: (type: 'quote', id: number, value: -1 | 0 | 1) => void;
}) => {
  const [like, setLike] = useState<-1 | 0 | 1>(quote.like);
  const { consent, openConsent } = useConsent();

  const vote = (value: -1 | 1) => {
    if (consent !== 'granted') {
      openConsent();
      return;
    }
    const next = like === value ? 0 : value;
    setLike(next);
    vote_feed_item(quote.id, next);
    onVoteChange?.('quote', quote.id, next);
  };

  const track = (link_type: LinkType, link_label: string) => {
    if (consent !== 'granted') {
      return;
    }
    record_link_click('quote', quote.id, link_type, link_label);
  };

  return (
    <Box
      data-testid="feed-card"
      data-card-type="quote"
      data-item-title={quote.title}
      sx={{ maxWidth: 680, mx: 'auto', px: 4, py: 4, borderBottom: 1, borderColor: 'divider' }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
        <Box sx={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
          <Link
            href={quote.url}
            target="_blank"
            rel="noopener noreferrer"
            underline="hover"
            color="inherit"
            data-testid="link-title"
            onClick={() => track('title', quote.title)}
          >
            <Typography variant="body1" sx={{ fontStyle: 'italic', textAlign: 'center', mb: 1 }}>
              {quote.title}
            </Typography>
          </Link>
          {quote.author_image && (
            <Avatar
              src={quote.author_image}
              alt={quote.author}
              sx={{ width: 56, height: 56, mx: 'auto', mb: 1 }}
            />
          )}
          {quote.author_url ? (
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
              —{' '}
              <Link
                href={quote.author_url}
                target="_blank"
                rel="noopener noreferrer"
                underline="hover"
                color="inherit"
                data-testid="link-by"
                onClick={() => track('by', quote.author)}
              >
                {quote.author}
              </Link>
            </Typography>
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
              — {quote.author}
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
