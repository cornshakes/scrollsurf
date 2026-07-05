'use client';

import { useState } from 'react';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Link from '@mui/material/Link';
import { request_login_code, submit_login_code } from '@/app/actions';
import { read_consent_cookie } from './CookieConsent';

interface LoginDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const LoginDialog = ({ open, onClose, onSuccess }: LoginDialogProps) => {
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [agreed, setAgreed] = useState(false);
  // Login already grants consent server-side, so the checkbox only matters when
  // consent hasn't been given yet. Reading the cookie during render is safe: the
  // dialog body only renders client-side (open starts false), so there is no
  // SSR/client hydration mismatch.
  const needs_consent = open && read_consent_cookie() !== 'granted';

  const reset = () => {
    setStep('email');
    setEmail('');
    setCode('');
    setError(null);
    setLoading(false);
    setAgreed(false);
  };

  const handle_close = () => {
    reset();
    onClose();
  };

  const handle_send_code = async () => {
    setError(null);
    setLoading(true);
    const result = await request_login_code({ email });
    setLoading(false);
    if (!result.ok) {
      setError(result.error ?? 'Something went wrong');
      return;
    }
    setStep('code');
  };

  const handle_verify = async () => {
    setError(null);
    setLoading(true);
    const result = await submit_login_code({ email, code });
    setLoading(false);
    if (!result.ok) {
      setError(result.error ?? 'Something went wrong');
      return;
    }
    reset();
    onSuccess();
  };

  return (
    <Dialog open={open} onClose={handle_close} maxWidth="xs" fullWidth>
      {step === 'email' ? (
        <>
          <DialogTitle>Log in</DialogTitle>
          <DialogContent>
            <Typography variant="body2" sx={{ mb: 2 }}>
              Enter your email to receive a 6-digit login code.
            </Typography>
            <TextField
              autoFocus
              label="Email"
              type="email"
              fullWidth
              value={email}
              onChange={(evt) => setEmail(evt.target.value)}
              onKeyDown={(evt) => {
                if (evt.key === 'Enter') {
                  handle_send_code();
                }
              }}
              disabled={loading}
            />
            <Typography variant="body2" color="text.secondary" sx={{ mt: 2, textAlign: 'justify' }}>
              Scrollsurf will store a cookie to keep you signed in and remember your likes and
              clicks so it can personalize your feed. You can withdraw consent and delete your data
              anytime from the menu or the cookie button on the bottom right. If you log in with
              your e-mail address, you&apos;ll be able to get back to your account even after your
              browser deletes the cookie, and you&apos;ll be able to use your account on other
              devices too.
              <br />
              <Link href="/privacy" underline="hover">
                Privacy info
              </Link>
            </Typography>
            {needs_consent && (
              <FormControlLabel
                sx={{ mt: 1, alignItems: 'flex-start' }}
                control={
                  <Checkbox
                    checked={agreed}
                    onChange={(evt) => setAgreed(evt.target.checked)}
                    disabled={loading}
                    sx={{ pt: 0 }}
                  />
                }
                label={
                  <Typography variant="body2" sx={{ pt: 0.5 }}>
                    I agree
                  </Typography>
                }
              />
            )}
            {error && (
              <Alert severity="error" sx={{ mt: 1.5 }}>
                {error}
              </Alert>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={handle_close}>Cancel</Button>
            <Button
              variant="contained"
              onClick={handle_send_code}
              disabled={loading || !email || (needs_consent && !agreed)}
            >
              Send code
            </Button>
          </DialogActions>
        </>
      ) : (
        <>
          <DialogTitle>Enter code</DialogTitle>
          <DialogContent>
            <Typography variant="body2" sx={{ mb: 2 }}>
              Scrollsurf sent a 6-digit code to {email}.
            </Typography>
            <TextField
              autoFocus
              label="6-digit code"
              fullWidth
              value={code}
              onChange={(evt) => setCode(evt.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={(evt) => {
                if (evt.key === 'Enter') {
                  handle_verify();
                }
              }}
              slotProps={{ htmlInput: { inputMode: 'numeric', maxLength: 6 } }}
              disabled={loading}
            />
            {error && (
              <Alert severity="error" sx={{ mt: 1.5 }}>
                {error}
              </Alert>
            )}
          </DialogContent>
          <DialogActions>
            <Button
              onClick={() => {
                setStep('email');
                setError(null);
                setCode('');
              }}
            >
              Back
            </Button>
            <Button
              variant="contained"
              onClick={handle_verify}
              disabled={loading || code.length !== 6}
            >
              Verify
            </Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  );
};
