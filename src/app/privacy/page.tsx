import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Link from '@mui/material/Link';

export const metadata = {
  title: 'Privacy — Scrollsurf',
};

export default function PrivacyPage() {
  return (
    <Box sx={{ maxWidth: 640, mx: 'auto', px: 4, py: 6 }}>
      <Typography variant="h4" component="h1" gutterBottom>
        Privacy
      </Typography>

      <Typography variant="body1" sx={{ mb: 2 }}>
        Scrollsurf is a personal, non-commercial project. It does not use analytics, advertising, or
        any third-party tracking services.
      </Typography>

      <Typography variant="h6" component="h2" gutterBottom sx={{ mt: 3 }}>
        Cookie
      </Typography>

      <Typography variant="body1" sx={{ mb: 2 }}>
        One optional cookie (<code>ss_uid</code>) is set only if you choose to accept it. It stores
        a random identifier that links your likes, dislikes, and dataset preferences to your
        browser. Nothing else is stored — no name, no IP address, no browsing history outside this
        site.
      </Typography>

      <Typography variant="body1" sx={{ mb: 2 }}>
        The cookie is only used to remember your choices within Scrollsurf. It is never shared with
        third parties.
      </Typography>

      <Typography variant="h6" component="h2" gutterBottom sx={{ mt: 3 }}>
        Retention
      </Typography>

      <Typography variant="body1" sx={{ mb: 2 }}>
        After a period of inactivity (about two weeks) the link between your cookie and any stored
        preferences is automatically severed. The cookie then behaves as if it were never set.
      </Typography>

      <Typography variant="h6" component="h2" gutterBottom sx={{ mt: 3 }}>
        Withdrawing consent
      </Typography>

      <Typography variant="body1" sx={{ mb: 2 }}>
        Click the cookie icon{' '}
        <Box component="span" sx={{ fontSize: '0.9em' }}>
          (bottom-right corner of the page)
        </Box>{' '}
        and choose <em>Withdraw consent</em>. Your <code>ss_uid</code> cookie will be deleted
        immediately. You can also clear cookies for this site in your browser settings at any time.
      </Typography>

      {/* contact email optional */}

      <Typography variant="body2" color="text.secondary" sx={{ mt: 4 }}>
        <Link href="/" underline="hover">
          ← Back to Scrollsurf
        </Link>
      </Typography>
    </Box>
  );
}
