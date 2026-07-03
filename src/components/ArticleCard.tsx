'use client';

import { useState } from 'react';
import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import { vote_feed_item, record_link_click } from '@/app/actions';
import type { Article } from '@/lib/db';
import { useConsent } from './CookieConsent';
import { CardTags } from './CardTags';
import { VoteButtons } from './VoteButtons';

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
    vote_feed_item(article.id, next);
    onVoteChange?.('article', article.id, next);
  };

  // Only log followed links once consent is granted — skip the request entirely
  // otherwise (the server would no-op anyway).
  const track = (url: string) => {
    if (consent !== 'granted') {
      return;
    }
    record_link_click(article.id, url);
  };

  return (
    <Box
      data-testid="feed-card"
      data-card-type="article"
      data-item-title={article.title}
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
          <Typography variant="h5" component="h2">
            <Link
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
              underline="hover"
              data-testid="link-title"
              onClick={() => track(article.url)}
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
      </Box>
      {article.extract && (
        <Typography
          variant="body1"
          sx={{
            mb: 2,
            display: '-webkit-box',
            WebkitLineClamp: 5,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {article.extract}
        </Typography>
      )}
      <CardTags
        links={article.links}
        onTrack={track}
        leading={<VoteButtons like={like} onVote={vote} />}
      />
    </Box>
  );
};
