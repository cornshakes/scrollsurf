'use client';

import { useState } from 'react';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import { vote_feed_item, record_link_click } from '@/app/actions';
import type { Quote } from '@/lib/db';
import { useConsent } from './CookieConsent';
import { VoteButtons } from './VoteButtons';

// Incoming-message bubble colors, tuned to read like Signal/WhatsApp in either
// scheme. The page uses `colorSchemeSelector: 'media'`, so dark-mode overrides
// go through `theme.applyStyles('dark', …)` rather than `palette.mode`.
const BUBBLE_LIGHT = '#e7e7ea';
const BUBBLE_DARK = '#2b2b2d';

const author_initials = (author: string) =>
  author
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();

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

  const track = (url: string) => {
    if (consent !== 'granted') {
      return;
    }
    record_link_click(quote.id, url);
  };

  const author_url = quote.author_url;

  return (
    <Box
      data-testid="feed-card"
      data-card-type="quote"
      data-item-title={quote.title}
      sx={{
        maxWidth: 680,
        mx: 'auto',
        px: { xs: 2, sm: 4 },
        py: 4,
        borderBottom: 1,
        borderColor: 'divider',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
        {/* Sender avatar — left, like an incoming message */}
        <Avatar
          src={quote.author_image ?? undefined}
          alt={quote.author}
          sx={{ width: 40, height: 40, flexShrink: 0, mt: 0.25 }}
        >
          {author_initials(quote.author)}
        </Avatar>

        {/* Message bubble with the quote and an inline attribution */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box
            sx={(theme) => ({
              position: 'relative',
              display: 'inline-block',
              width: 'fit-content',
              maxWidth: '100%',
              px: 1.5,
              py: 0.75,
              borderRadius: 2,
              borderTopLeftRadius: 0,
              bgcolor: BUBBLE_LIGHT,
              // Little tail tucked against the avatar at the top-left corner.
              '&::before': {
                content: '""',
                position: 'absolute',
                top: 0,
                left: -7,
                width: 0,
                height: 0,
                borderStyle: 'solid',
                borderWidth: '0 7px 8px 0',
                borderColor: `transparent ${BUBBLE_LIGHT} transparent transparent`,
              },
              ...theme.applyStyles('dark', {
                bgcolor: BUBBLE_DARK,
                '&::before': {
                  borderColor: `transparent ${BUBBLE_DARK} transparent transparent`,
                },
              }),
            })}
          >
            {/* Sender name — first line inside the bubble, with the quote year
                tucked into the top-right corner */}
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.25 }}>
              <Typography
                variant="caption"
                sx={{
                  flex: 1,
                  minWidth: 0,
                  fontWeight: 600,
                  color: 'primary.main',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {author_url ? (
                  <Link
                    href={author_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    underline="hover"
                    color="inherit"
                    data-testid="link-by"
                    onClick={() => track(author_url)}
                  >
                    {quote.author}
                  </Link>
                ) : (
                  quote.author
                )}
              </Typography>

              {quote.quote_year && (
                <Typography variant="caption" sx={{ flexShrink: 0, color: 'text.secondary' }}>
                  {quote.quote_year}
                </Typography>
              )}
            </Box>

            <Link
              href={quote.url}
              target="_blank"
              rel="noopener noreferrer"
              underline="none"
              color="inherit"
              data-testid="link-title"
              onClick={() => track(quote.url)}
            >
              <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                {quote.title}
              </Typography>
            </Link>
          </Box>
        </Box>
      </Box>
      {/* Vote control — bottom left, below the message bubble */}
      <Box sx={{ display: 'flex', mt: 2 }}>
        <VoteButtons like={like} onVote={vote} />
      </Box>
    </Box>
  );
};
