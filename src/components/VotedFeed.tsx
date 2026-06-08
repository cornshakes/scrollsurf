'use client';

import { useState, useEffect, useTransition } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import { get_voted_wiki_articles } from '@/app/actions';
import { ArticleCard } from './ArticleCard';
import { PictureCard } from './PictureCard';
import type { FeedItem } from '@/lib/db';

export const VotedFeed = ({ vote }: { vote: -1 | 1 }) => {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    startTransition(async () => {
      setItems(await get_voted_wiki_articles(vote));
    });
  }, [vote]);

  const handleVoteChange = (type: 'article' | 'picture', id: number, newLike: -1 | 0 | 1) => {
    setItems((prev) =>
      prev.filter((item) => (item.type === type && item.id === id ? newLike === vote : true))
    );
  };

  if (isPending) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }
  if (items.length === 0) {
    return (
      <Typography sx={{ textAlign: 'center', py: 8, color: 'text.secondary' }}>
        Nothing here yet.
      </Typography>
    );
  }

  return (
    <Box>
      {items.map((item) =>
        item.type === 'picture' ? (
          <PictureCard key={`picture-${item.id}`} picture={item} onVoteChange={handleVoteChange} />
        ) : (
          <ArticleCard key={`article-${item.id}`} article={item} onVoteChange={handleVoteChange} />
        )
      )}
    </Box>
  );
};
