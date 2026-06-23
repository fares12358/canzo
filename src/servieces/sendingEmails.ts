

type emailData = {
  to: string;
  subject: string;
  html: string;
}
async function sendEmail(apiKey: string, data: emailData,senderEmail:string) {
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": apiKey
    },
    body: JSON.stringify({
      sender: { name: "Canzo", email: senderEmail },
      to: [{ email: data.to }],
      subject: data.subject,
      htmlContent: data.html
    })
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(`Brevo error: ${JSON.stringify(error)}`)
  }
}
export {sendEmail,type emailData};
