'use client';

import { useState, useEffect, useRef, useTransition } from 'react';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import CircularProgress from '@mui/material/CircularProgress';
import { get_next_wiki_articles } from '@/app/actions';
import type { Article } from '@/lib/db';

const PAGE_SIZE = 10;

function ArticleCard({ article }: { article: Article }) {
  return (
    <Box
      sx={{
        maxWidth: 680,
        mx: 'auto',
        px: 4,
        py: 4,
        borderBottom: 1,
        borderColor: 'divider',
      }}
    >
      <Typography variant="h4" component="h2" gutterBottom>
        <Link href={article.url} target="_blank" rel="noopener noreferrer" underline="hover">
          {article.title}
        </Link>
      </Typography>
      <Typography variant="body1">{article.extract}</Typography>
    </Box>
  );
}

export default function WikiArticles() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [isPending, startTransition] = useTransition();
  const sentinelRef = useRef<HTMLDivElement>(null);

  function fetchNext() {
    startTransition(async () => {
      const batch = await get_next_wiki_articles(PAGE_SIZE);
      setArticles((prev) => [...prev, ...batch]);
    });
  }

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
}
