'use client';

import { useState, useTransition } from 'react';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import { getRandomWikiArticle, type WikiSummary } from '@/app/actions';

export default function WikiArticle() {
  const [article, setArticle] = useState<WikiSummary | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      setArticle(await getRandomWikiArticle());
    });
  }

  return (
    <Box sx={{ maxWidth: 600, mx: 'auto', p: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Button variant="contained" onClick={handleClick} loading={isPending}>
        Random article
      </Button>
      {article && (
        <>
          <Typography variant="h5" component="h1">
            <Link href={article.url} target="_blank" rel="noopener noreferrer" underline="hover">
              {article.title}
            </Link>
          </Typography>
          <Typography>{article.extract}</Typography>
        </>
      )}
    </Box>
  );
}
