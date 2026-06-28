'use client';

import { createContext, useContext, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Popover from '@mui/material/Popover';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import Alert from '@mui/material/Alert';
import CookieIcon from '@mui/icons-material/Cookie';
import { grant_consent, revoke_consent } from '@/app/actions';
import { CONSENT_COOKIE } from '@/lib/cookie';
import { useAuth } from './AuthContext';

type ConsentState = 'granted' | 'denied' | 'unknown';

interface ConsentContextValue {
  consent: ConsentState;
  openConsent: () => void;
}

const ConsentContext = createContext<ConsentContextValue>({
  consent: 'unknown',
  openConsent: () => {},
});

export const useConsent = () => useContext(ConsentContext);

const read_consent_cookie = (): ConsentState => {
  if (typeof document === 'undefined') {
    return 'unknown';
  }
  const match = document.cookie.split('; ').find((c) => c.startsWith(`${CONSENT_COOKIE}=`));
  if (!match) {
    return 'unknown';
  }
  const val = match.split('=')[1];
  return val === 'granted' ? 'granted' : 'denied';
};

export const ConsentProvider = ({ children }: { children: React.ReactNode }) => {
  const [consent, setConsent] = useState<ConsentState>(read_consent_cookie);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [show_revoke_warning, setShowRevokeWarning] = useState(false);
  const icon_ref = useRef<HTMLButtonElement>(null);
  const router = useRouter();
  const { account, refreshAccount } = useAuth();

  const openConsent = useCallback(() => {
    setAnchor(icon_ref.current);
  }, []);

  const handle_grant = async () => {
    await grant_consent();
    setConsent('granted');
    setAnchor(null);
    router.refresh();
  };

  const handle_revoke_click = () => {
    if (account) {
      setShowRevokeWarning(true);
    } else {
      handle_revoke_confirmed();
    }
  };

  const handle_revoke_confirmed = async () => {
    await revoke_consent();
    setConsent('denied');
    setAnchor(null);
    setShowRevokeWarning(false);
    await refreshAccount();
    window.location.reload();
  };

  const open = Boolean(anchor);

  return (
    <ConsentContext.Provider value={{ consent, openConsent }}>
      {children}
      <IconButton
        ref={icon_ref}
        onClick={() => setAnchor(icon_ref.current)}
        size="small"
        aria-label="Cookie consent settings"
        data-testid="cookie-button"
        sx={{
          position: 'fixed',
          bottom: 12,
          right: 12,
          opacity: 0.35,
          '&:hover': { opacity: 0.8 },
          zIndex: 1200,
        }}
      >
        <CookieIcon fontSize="small" />
      </IconButton>

      <Popover
        open={open}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Box data-testid="consent-popover" sx={{ p: 2, maxWidth: 300 }}>
          <Typography variant="body2" sx={{ mb: 1.5 }}>
            One optional cookie to remember what you saw (to show you new things), likes and clicks
            (to show you similar things). The cookie is not used for any other purpose and it is not
            shared with anybody.{' '}
            <Link href="/privacy" underline="hover" onClick={() => setAnchor(null)}>
              Privacy info
            </Link>
          </Typography>
          {consent === 'granted' ? (
            <>
              {show_revoke_warning && (
                <Alert severity="warning" sx={{ mb: 1.5 }}>
                  <Typography variant="body2">
                    Revoking cookie consent will remove your account.
                    <br /> Your saved likes can no longer be recovered by email.
                    <br /> Are you sure you want to do this?
                  </Typography>
                </Alert>
              )}
              {show_revoke_warning ? (
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Button
                    size="small"
                    variant="contained"
                    color="error"
                    onClick={handle_revoke_confirmed}
                  >
                    Confirm
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => setShowRevokeWarning(false)}
                  >
                    Cancel
                  </Button>
                </Box>
              ) : (
                <Button size="small" color="error" variant="outlined" onClick={handle_revoke_click}>
                  Withdraw consent
                </Button>
              )}
            </>
          ) : (
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button size="small" variant="contained" onClick={handle_grant}>
                Accept
              </Button>
              <Button size="small" variant="outlined" onClick={() => setAnchor(null)}>
                No thanks
              </Button>
            </Box>
          )}
        </Box>
      </Popover>
    </ConsentContext.Provider>
  );
};
