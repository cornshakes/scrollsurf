'use client';

import { useState, useRef, useLayoutEffect } from 'react';
import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { alpha } from '@mui/material/styles';
import type { SxProps, Theme } from '@mui/material/styles';
import type { Link, LinkType } from '@/lib/db/types';

const ROW_PADDING = 6; // breathing room so chip glows aren't clipped by overflow
// top padding + 2 × 24px chips + 1 × 4px gap, clipped just below row 2 so the
// 3rd row (which flows after only a 4px gap) stays hidden.
const TWO_ROWS_HEIGHT = ROW_PADDING + 52 + 2;

// Primary tint + soft glow so dataset/topic chips stand out from the plain
// outlined category chips. The glow is softer in light mode (it reads stronger
// on the pale background) and brighter in dark mode.
const accent_sx: SxProps<Theme> = (theme) => {
  const glow = theme.palette.primary.main;
  return {
    maxWidth: '100%',
    bgcolor: alpha(glow, 0.12),
    boxShadow: `0 0 6px ${alpha(glow, 0.22)}`,
    '&:hover': { boxShadow: `0 0 8px ${alpha(glow, 0.32)}` },
    ...theme.applyStyles('dark', {
      boxShadow: `0 0 8px ${alpha(glow, 0.5)}`,
      '&:hover': { boxShadow: `0 0 12px ${alpha(glow, 0.7)}` },
    }),
  };
};

export const CardTags = ({
  links,
  onTrack,
  leading,
  sx,
}: {
  links: Link[];
  onTrack: (link_type: LinkType, link_label: string) => void;
  // Rendered as the first element of the chip row (e.g. the vote control).
  leading?: ReactNode;
  sx?: SxProps;
}) => {
  const [expanded, set_expanded] = useState(false);
  const [has_overflow, set_has_overflow] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    set_has_overflow(el.scrollHeight > el.clientHeight);
  }, [links]);

  if (!leading && links.length === 0) {
    return null;
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0, ...sx }}>
      <Box
        ref={ref}
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 0.5,
          minWidth: 0,
          p: `${ROW_PADDING}px`,
          mx: `-${ROW_PADDING}px`, // cancel the padding's horizontal indent
          overflow: 'hidden',
          ...(expanded ? {} : { maxHeight: TWO_ROWS_HEIGHT }),
        }}
      >
        {leading}
        {links.map((link, i) => {
          const is_accent = link.type === 'dataset' || link.type === 'topic';
          return (
            <Chip
              key={`${link.type}-${link.title}-${i}`}
              label={link.title}
              size="small"
              color={'primary'}
              variant="outlined"
              component={link.url ? 'a' : 'div'}
              href={link.url ?? undefined}
              target={link.url ? '_blank' : undefined}
              rel={link.url ? 'noopener noreferrer' : undefined}
              clickable={!!link.url}
              data-testid={`link-${link.type}`}
              onClick={link.url ? () => onTrack(link.type as LinkType, link.title) : undefined}
              sx={is_accent ? accent_sx : { maxWidth: '100%' }}
            />
          );
        })}
      </Box>
      {(has_overflow || expanded) && (
        <Box sx={{ display: 'flex', justifyContent: 'center' }}>
          <IconButton
            size="small"
            onClick={() => set_expanded((prev) => !prev)}
            aria-label={expanded ? 'Show fewer' : 'Show more'}
            sx={{ p: 0.25 }}
          >
            {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
          </IconButton>
        </Box>
      )}
    </Box>
  );
};
