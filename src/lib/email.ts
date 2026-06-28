import nodemailer from 'nodemailer';

export const send_login_code = async (email: string, code: string): Promise<void> => {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
  if (!SMTP_HOST) {
    console.warn(`[login code] ${email}: ${code}`);
    return;
  }
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT ?? 587),
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  await transporter.sendMail({
    from: SMTP_FROM,
    to: email,
    subject: 'Your login code',
    text: `Your login code is: ${code}\n\nIt expires in 15 minutes.`,
  });
};
