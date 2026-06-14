'use client';

import { useState, useEffect, useTransition } from 'react';
import { useInView } from 'react-intersection-observer';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import { get_next_wiki_articles } from '@/app/actions';
import { ArticleCard } from './ArticleCard';
import { PictureCard } from './PictureCard';
import type { FeedItem } from '@/lib/db';

const PAGE_SIZE = 10;

export const RandomFeed = () => {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [isPending, startTransition] = useTransition();
  const { ref, inView } = useInView({ rootMargin: '200px' });

  const fetchNext = () => {
    startTransition(async () => {
      const batch = await get_next_wiki_articles(PAGE_SIZE);
      setItems((prev) => [...prev, ...batch]);
    });
  };

  useEffect(() => {
    fetchNext();
  }, []);

  useEffect(() => {
    if (inView && !isPending) {
      fetchNext();
    }
  }, [inView, isPending]);

  return (
    <Box>
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ maxWidth: 680, mx: 'auto', px: { xs: 2, sm: 4 }, pt: 1.5, pb: 1 }}
      >
        Discover Wikipedia articles, pictures, topics and categories from curated datasets.
      </Typography>
      {items.map((item) =>
        item.type === 'picture' ? (
          <PictureCard key={`picture-${item.id}`} picture={item} />
        ) : (
          <ArticleCard key={`article-${item.id}`} article={item} />
        )
      )}
      <Box
        ref={ref}
        data-testid="feed-sentinel"
        sx={{ display: 'flex', justifyContent: 'center', py: 4 }}
      >
        {isPending && <CircularProgress />}
      </Box>
    </Box>
  );
};
