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

  if (response.error) {
    console.error("Resend error:", response.error);
    throw new Error(response.error.message || "Resend failed");
  }

  console.log("Email sent:", response);

  return response;
}