'use client';

import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import { alpha } from '@mui/material/styles';
import type { SxProps, Theme } from '@mui/material/styles';

/**
 * A single coherent like/dislike voting control, laid out horizontally: an up
 * arrow (left) likes, and a down arrow (right) dislikes. Clicking the segment
 * that matches the current vote clears it back to neutral (the toggle is handled
 * by the caller's `onVote`, which is expected to map a repeat vote to 0).
 */
export const VoteButtons = ({
  like,
  onVote,
  sx,
}: {
  like: -1 | 0 | 1;
  onVote: (value: -1 | 1) => void;
  sx?: SxProps<Theme>;
}) => {
  const segment = (active: boolean, tint: 'success' | 'secondary'): SxProps<Theme> => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    px: 1.25,
    color: active ? `${tint}.contrastText` : 'text.secondary',
    bgcolor: active ? `${tint}.main` : 'transparent',
    transition: (theme) =>
      theme.transitions.create(['background-color', 'color'], { duration: 120 }),
    '&:hover': {
      bgcolor: (theme) =>
        active ? theme.palette[tint].dark : alpha(theme.palette.text.primary, 0.06),
    },
  });

  // Teal-tinted border that picks up the theme primary in both schemes.
  const border_color = (theme: Theme) => ({
    borderColor: alpha(theme.palette.primary.main, 0.35),
  });

  return (
    <Box
      sx={[
        {
          display: 'inline-flex',
          flexDirection: 'row',
          flexShrink: 0,
          // Match the small-chip height so the control sits inline in the tag row.
          height: 24,
          borderRadius: 0.75,
          border: 1,
          overflow: 'hidden',
          bgcolor: 'background.paper',
        },
        border_color,
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      <ButtonBase
        onClick={() => onVote(1)}
        aria-label="Like"
        aria-pressed={like === 1}
        data-testid="vote-up"
        sx={segment(like === 1, 'success')}
      >
        <ArrowUpwardIcon sx={{ fontSize: 16 }} />
      </ButtonBase>
      <ButtonBase
        onClick={() => onVote(-1)}
        aria-label="Dislike"
        aria-pressed={like === -1}
        data-testid="vote-down"
        sx={segment(like === -1, 'secondary')}
      >
        <ArrowDownwardIcon sx={{ fontSize: 16 }} />
      </ButtonBase>
    </Box>
  );
};
