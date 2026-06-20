'use client';

import { useCallback, useEffect, useTransition } from 'react';
import { useInView } from 'react-intersection-observer';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import { get_next_feed_items } from '@/app/actions';
import { ArticleCard } from './ArticleCard';
import { PictureCard } from './PictureCard';
import { QuoteCard } from './QuoteCard';
import { useFeed } from './FeedContext';

const PAGE_SIZE = 10;

export const RandomFeed = () => {
  const { items, setItems } = useFeed();
  const [isPending, startTransition] = useTransition();
  const { ref, inView } = useInView({ rootMargin: '200px' });

  const fetchNext = useCallback(() => {
    startTransition(async () => {
      const batch = await get_next_feed_items(PAGE_SIZE);
      // without a cookie, the same feed items might show up multiple times.
      // we filter.
      setItems((prev) => {
        const seen = new Set(prev.map(({ id }) => id));
        return [...prev, ...batch.filter(({ id }) => !seen.has(id))];
      });
    });
  }, [setItems]);

  useEffect(() => {
    if (items.length === 0) {
      fetchNext();
    }
  }, [items.length, fetchNext]);

  useEffect(() => {
    if (inView && !isPending) {
      fetchNext();
    }
  }, [inView, isPending, fetchNext]);

  return (
    <Box>
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ maxWidth: 680, mx: 'auto', px: { xs: 2, sm: 4 }, pt: 1.5, pb: 1 }}
      >
        Discover Wikipedia articles, pictures, topics and categories from curated datasets.
      </Typography>
      {items.map((item) => {
        if (item.type === 'picture') {
          return <PictureCard key={item.id} picture={item} />;
        } else if (item.type === 'quote') {
          return <QuoteCard key={item.id} quote={item} />;
        } else {
          return <ArticleCard key={item.id} article={item} />;
        }
      })}
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
