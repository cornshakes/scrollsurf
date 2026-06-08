'use client';

import { useState, useEffect, useTransition } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import { get_voted_wiki_articles } from '@/app/actions';
import { ArticleCard } from './ArticleCard';
import type { Article } from '@/lib/db';

export const VotedFeed = ({ vote }: { vote: -1 | 1 }) => {
  const [articles, setArticles] = useState<Article[]>([]);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    startTransition(async () => {
      setArticles(await get_voted_wiki_articles(vote));
    });
  }, [vote]);

  const handleVoteChange = (id: number, newLike: -1 | 0 | 1) => {
    setArticles((prev) => prev.filter((a) => (a.id === id ? newLike === vote : true)));
  };

  if (isPending) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }
  if (articles.length === 0) {
    return (
      <Typography sx={{ textAlign: 'center', py: 8, color: 'text.secondary' }}>
        Nothing here yet.
      </Typography>
    );
  }

  return (
    <Box>
      {articles.map((article) => (
        <ArticleCard key={article.id} article={article} onVoteChange={handleVoteChange} />
      ))}
    </Box>
  );
};
