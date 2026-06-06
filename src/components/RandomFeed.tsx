'use client';

import { useState, useEffect, useRef, useTransition } from 'react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import { get_next_wiki_articles } from '@/app/actions';
import { ArticleCard } from './ArticleCard';
import type { Article } from '@/lib/db';

const PAGE_SIZE = 10;

export const RandomFeed = () => {
  const [articles, setArticles] = useState<Article[]>([]);
  const [isPending, startTransition] = useTransition();
  const sentinelRef = useRef<HTMLDivElement>(null);

  const fetchNext = () => {
    startTransition(async () => {
      const batch = await get_next_wiki_articles(PAGE_SIZE);
      setArticles((prev) => [...prev, ...batch]);
    });
  };

  useEffect(() => {
    fetchNext();
  }, []);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !isPending) fetchNext();
      },
      { rootMargin: '200px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [isPending]);

  return (
    <Box>
      {articles.map((article) => (
        <ArticleCard key={article.id} article={article} />
      ))}
      <Box ref={sentinelRef} sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        {isPending && <CircularProgress />}
      </Box>
    </Box>
  );
};
