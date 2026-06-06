'use client';

import { useState, useEffect, useRef } from 'react';
import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Chip from '@mui/material/Chip';
import ThumbUpIcon from '@mui/icons-material/ThumbUp';
import ThumbDownIcon from '@mui/icons-material/ThumbDown';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { set_article_like } from '@/app/actions';
import type { Article } from '@/lib/db';

const TEXT_MAX_LINES = 11;
const CHIP_MAX_HEIGHT = 56; // ~2 rows of small chips (24px) + gap

const CollapsibleText = ({ text }: { text: string }) => {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (ref.current) setOverflows(ref.current.scrollHeight > ref.current.clientHeight + 1);
  }, []);

  return (
    <>
      <Typography
        ref={ref}
        variant="body1"
        sx={
          expanded
            ? {}
            : {
                display: '-webkit-box',
                WebkitLineClamp: TEXT_MAX_LINES,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }
        }
      >
        {text}
      </Typography>
      {overflows && (
        <Box
          onClick={() => setExpanded((e) => !e)}
          sx={{ cursor: 'pointer', color: 'text.secondary', lineHeight: 0 }}
        >
          {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
        </Box>
      )}
    </>
  );
};

const CollapsibleChips = ({ categories }: { categories: string[] }) => {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) setOverflows(ref.current.scrollHeight > ref.current.clientHeight + 1);
  }, []);

  return (
    <>
      <Box
        ref={ref}
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 0.5,
          ...(!expanded && { maxHeight: CHIP_MAX_HEIGHT, overflow: 'hidden' }),
        }}
      >
        {categories.map((cat) => (
          <Chip
            key={cat}
            label={cat}
            size="small"
            variant="outlined"
            component="a"
            href={`https://en.wikipedia.org/wiki/Category:${encodeURIComponent(cat)}`}
            target="_blank"
            rel="noopener noreferrer"
            clickable
          />
        ))}
      </Box>
      {overflows && (
        <Box
          onClick={() => setExpanded((e) => !e)}
          sx={{ cursor: 'pointer', color: 'text.secondary', lineHeight: 0 }}
        >
          {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
        </Box>
      )}
    </>
  );
};

export const ArticleCard = ({
  article,
  onVoteChange,
}: {
  article: Article;
  onVoteChange?: (id: number, value: -1 | 0 | 1) => void;
}) => {
  const [like, setLike] = useState<-1 | 0 | 1>(article.like);

  const vote = (value: -1 | 1) => {
    const next = like === value ? 0 : value;
    setLike(next);
    set_article_like(article.id, next);
    onVoteChange?.(article.id, next);
  };

  return (
    <Box sx={{ maxWidth: 680, mx: 'auto', px: 4, py: 4, borderBottom: 1, borderColor: 'divider' }}>
      <Box sx={{ display: 'flex', gap: 2, mb: article.extract ? 2 : 0 }}>
        {article.image_url && (
          <Box
            component="img"
            src={article.image_url}
            sx={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 1, flexShrink: 0 }}
          />
        )}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h5" component="h2">
            <Link href={article.url} target="_blank" rel="noopener noreferrer" underline="hover">
              {article.title}
            </Link>
          </Typography>
          {article.description && (
            <Typography variant="body2" color="text.secondary">
              {article.description}
            </Typography>
          )}
        </Box>
        <Box sx={{ display: 'flex', gap: 0.5, flexShrink: 0 }}>
          <IconButton
            onClick={() => vote(1)}
            color={like === 1 ? 'primary' : 'default'}
            size="small"
          >
            <ThumbUpIcon fontSize="small" />
          </IconButton>
          <IconButton
            onClick={() => vote(-1)}
            color={like === -1 ? 'error' : 'default'}
            size="small"
          >
            <ThumbDownIcon fontSize="small" />
          </IconButton>
        </Box>
      </Box>
      {article.extract && (
        <Box sx={{ mb: article.categories.length ? 2 : 0 }}>
          <CollapsibleText text={article.extract} />
        </Box>
      )}
      {article.categories.length > 0 && <CollapsibleChips categories={article.categories} />}
    </Box>
  );
};
