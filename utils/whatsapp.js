// utils/whatsapp.js
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = require('twilio')(accountSid, authToken);

exports.sendPaymentConfirmation = async (toPhone, userName, eventTitle, amount) => {
  const message = `🎉 Payment received for "${eventTitle}"!
Name: ${userName}
Amount: €${amount}
Your registration is now confirmed.
– DBDS Ireland`;

  try {
    await client.messages.create({
      from: 'whatsapp:+353894627216', // your Twilio WhatsApp number
      to: `whatsapp:${toPhone}`,
      body: message
    });
    console.log(`WhatsApp sent to ${toPhone}`);
  } catch (err) {
    console.error('WhatsApp error:', err.message);
  }
};