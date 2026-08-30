import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Link from '@mui/material/Link';
import Avatar from '@mui/material/Avatar';

export const metadata = {
  title: 'About: Scrollsurf',
};

const GITHUB_USER = 'cornshakes';
const GITHUB_URL = `https://github.com/${GITHUB_USER}`;
const GITHUB_AVATAR = `${GITHUB_URL}.png`;

const CONTACT_EMAIL = 'michael@cornshakes.at';
const CONTACT_SUBJECT = 'Scrollsurf feedback';
const CONTACT_BODY = "Hi! I've been using Scrollsurf and wanted to say:\n\n";
const CONTACT_MAILTO = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
  CONTACT_SUBJECT
)}&body=${encodeURIComponent(CONTACT_BODY)}`;

const DATASETS: { label: string; url: string }[] = [
  {
    label: 'Wikipedia: Level 5 vital articles',
    url: 'https://en.wikipedia.org/wiki/Wikipedia:Vital_articles/Level/5',
  },
  {
    label: 'Wikipedia: Good articles',
    url: 'https://en.wikipedia.org/wiki/Wikipedia:Good_articles',
  },
  {
    label: 'Wikipedia: Featured articles',
    url: 'https://en.wikipedia.org/wiki/Wikipedia:Featured_articles',
  },
  {
    label: 'Wikipedia: Featured pictures',
    url: 'https://en.wikipedia.org/wiki/Wikipedia:Featured_pictures',
  },
  {
    label: 'Wikipedia: Unusual articles',
    url: 'https://en.wikipedia.org/wiki/Wikipedia:Unusual_articles',
  },
  {
    label: 'Wikimedia Commons: Featured pictures',
    url: 'https://commons.wikimedia.org/wiki/Commons:Featured_pictures',
  },
  {
    label: 'Wikiquote: Quote of the Day',
    url: 'https://en.wikiquote.org/wiki/Wikiquote:QOTD_by_month',
  },
];

export default function AboutPage() {
  return (
    <Box sx={{ maxWidth: 640, mx: 'auto', px: 4, py: 6, textAlign: 'justify' }}>
      <Typography variant="h4" component="h1" gutterBottom>
        About
      </Typography>

      <Typography variant="body1" sx={{ mb: 2 }}>
        Scrollsurf is an infinite feed of curated articles, pictures, and quotes, so that you can
        scroll at your leisure without feeling bad about it. You can find the full source code on{' '}
        <Link
          href={'https://github.com/cornshakes/scrollsurf'}
          target="_blank"
          rel="noopener noreferrer"
          underline="hover"
        >
          github.com/cornshakes/scrollsurf
        </Link>
        . Everything you see comes from one of these curated lists:
      </Typography>

      <Box component="ul" sx={{ mt: 0, mb: 2, pl: 3 }}>
        {DATASETS.map((dataset) => (
          <Typography key={dataset.url} component="li" variant="body1" sx={{ mb: 0.5 }}>
            <Link href={dataset.url} target="_blank" rel="noopener noreferrer" underline="hover">
              {dataset.label}
            </Link>
          </Typography>
        ))}
      </Box>

      <Typography variant="h6" component="h2" gutterBottom sx={{ mt: 3 }}>
        No ads, no tracking
      </Typography>

      <Typography variant="body1" sx={{ mb: 1 }}>
        Scrollsurf is a personal, non-commercial project. There are no ads, no analytics, and no
        third-party tracking. If you accept the optional anonymous cookie, it will be used to store
        only these things about you:
      </Typography>

      <Box component="ul" sx={{ mt: 0, mb: 2, pl: 3 }}>
        <Typography component="li" variant="body1" sx={{ mb: 0.5 }}>
          What you already saw: So it can show you new things.
        </Typography>
        <Typography component="li" variant="body1" sx={{ mb: 0.5 }}>
          What you liked and clicked: So it can show you slightly more of that.
        </Typography>
        <Typography component="li" variant="body1" sx={{ mb: 0.5 }}>
          What you disliked: So it can show you slightly less of that.
        </Typography>
      </Box>

      <Typography variant="body1" sx={{ mb: 2 }}>
        See the{' '}
        <Link href="/privacy" underline="hover">
          privacy info
        </Link>{' '}
        for details.
      </Typography>

      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 2,
          mb: 2,
          mt: 5,
        }}
      >
        <Avatar
          src={GITHUB_AVATAR}
          alt={GITHUB_USER}
          sx={{ width: 56, height: 56 }}
          slotProps={{ img: { loading: 'lazy' } }}
        />
        <Typography variant="body1" sx={{ textAlign: 'right' }}>
          Visit my{' '}
          <Link href={GITHUB_URL} target="_blank" rel="noopener noreferrer" underline="hover">
            github profile
          </Link>
          <br />
          or{' '}
          <Link href={CONTACT_MAILTO} underline="hover">
            send me an email
          </Link>
        </Typography>
      </Box>

      <Typography variant="body2" color="text.secondary" sx={{ mt: 4 }}>
        <Link href="/" underline="hover">
          ← Back to Scrollsurf
        </Link>
      </Typography>
    </Box>
  );
}
