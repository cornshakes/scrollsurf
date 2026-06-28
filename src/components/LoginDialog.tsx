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
import { request_login_code, submit_login_code } from '@/app/actions';

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

  const reset = () => {
    setStep('email');
    setEmail('');
    setCode('');
    setError(null);
    setLoading(false);
  };

  const handle_close = () => {
    reset();
    onClose();
  };

  const handle_send_code = async () => {
    setError(null);
    setLoading(true);
    const result = await request_login_code(email);
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
    const result = await submit_login_code(email, code);
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
            {error && (
              <Alert severity="error" sx={{ mt: 1.5 }}>
                {error}
              </Alert>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={handle_close}>Cancel</Button>
            <Button variant="contained" onClick={handle_send_code} disabled={loading || !email}>
              Send code
            </Button>
          </DialogActions>
        </>
      ) : (
        <>
          <DialogTitle>Enter code</DialogTitle>
          <DialogContent>
            <Typography variant="body2" sx={{ mb: 2 }}>
              We sent a 6-digit code to {email}.
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
