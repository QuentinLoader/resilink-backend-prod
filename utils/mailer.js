import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendEmail({ to, subject, html }) {
  if (!to) {
    throw new Error("Missing recipient email");
  }

  const response = await resend.emails.send({
    from: process.env.EMAIL_FROM,
    to,
    subject,
    html
  });

  return response;
}