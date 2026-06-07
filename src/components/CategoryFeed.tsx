'use client';

import { useState, useEffect, useTransition } from 'react';
import Box from '@mui/material/Box';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import Collapse from '@mui/material/Collapse';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import ThumbUpIcon from '@mui/icons-material/ThumbUp';
import ThumbDownIcon from '@mui/icons-material/ThumbDown';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { get_wiki_category_tree } from '@/app/actions';
import type { CategoryTree } from '@/lib/db';

export const CategoryFeed = () => {
  const [categories, setCategories] = useState<CategoryTree | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    startTransition(async () => {
      const tree = await get_wiki_category_tree();
      setCategories(tree);
      setCollapsed(new Set(tree.map((c) => c.top_level)));
    });
  }, []);

  if (isPending && !categories)
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );

  if (!categories) return null;

  const toggle_top_level = (top_level: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(top_level)) next.delete(top_level);
      else next.add(top_level);
      return next;
    });

  const vote_chips = (liked: number, disliked: number) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
      {liked > 0 && (
        <Chip
          icon={<ThumbUpIcon />}
          label={liked}
          size="small"
          color="primary"
          variant="outlined"
        />
      )}
      {disliked > 0 && (
        <Chip
          icon={<ThumbDownIcon />}
          label={disliked}
          size="small"
          color="error"
          variant="outlined"
        />
      )}
    </Box>
  );

  return (
    <Box sx={{ width: '100%', maxWidth: 680, mx: 'auto', px: 2, py: 2 }}>
      {categories.length === 0 ? (
        <Typography sx={{ textAlign: 'center', py: 8, color: 'text.secondary' }}>
          No categories yet — browse a few articles and check back.
        </Typography>
      ) : (
        categories.map((tl) => {
          const is_open = !collapsed.has(tl.top_level);
          return (
            <Box key={tl.top_level} sx={{ mb: 1, m: 0 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', px: 1, gap: 0.25 }}>
                <IconButton
                  onClick={() => toggle_top_level(tl.top_level)}
                  size="small"
                  aria-label={is_open ? `Collapse ${tl.top_level}` : `Expand ${tl.top_level}`}
                  sx={{ p: 0.5 }}
                >
                  {is_open ? <ExpandMoreIcon /> : <ChevronRightIcon />}
                </IconButton>
                <Typography variant="subtitle2" sx={{ fontWeight: 600, minWidth: 'fit-content' }}>
                  {tl.top_level}
                </Typography>
                <Typography
                  variant="caption"
                  sx={{ color: 'text.secondary', minWidth: 'fit-content' }}
                >
                  {tl.article_count} articles · {tl.categories.length} categories
                </Typography>
                {vote_chips(tl.liked, tl.disliked)}
              </Box>
              <Collapse in={is_open} timeout="auto" unmountOnExit sx={{ mt: -0.5 }}>
                <List dense sx={{ py: 0 }}>
                  {tl.categories.map((cat) => (
                    <ListItem
                      key={cat.topic}
                      sx={{ pl: 6, display: 'flex', alignItems: 'center', gap: 0.25, py: 0.5 }}
                    >
                      <Typography variant="body2" sx={{ minWidth: 'fit-content' }}>
                        {cat.topic}
                      </Typography>
                      <Typography
                        variant="caption"
                        sx={{ color: 'text.secondary', minWidth: 'fit-content' }}
                      >
                        {cat.article_count} articles
                      </Typography>
                      {vote_chips(cat.liked, cat.disliked)}
                    </ListItem>
                  ))}
                </List>
              </Collapse>
            </Box>
          );
        })
      )}
    </Box>
  );
};
