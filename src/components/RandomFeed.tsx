'use client';

import { useState, useEffect, useRef, useTransition } from 'react';
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
  const sentinelRef = useRef<HTMLDivElement>(null);

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
    const sentinel = sentinelRef.current;
    if (!sentinel) {
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !isPending) {
          fetchNext();
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [isPending]);

  return (
    <Box>
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ maxWidth: 680, mx: 'auto', px: { xs: 2, sm: 4 }, pt: 3, pb: 1 }}
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
      <Box ref={sentinelRef} sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        {isPending && <CircularProgress />}
      </Box>
    </Box>
  );
};
