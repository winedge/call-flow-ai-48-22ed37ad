import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/api/public/twilio-status')({
  server: {
    handlers: {
      GET: async () => {
        const sid = process.env.TWILIO_ACCOUNT_SID;
        const token = process.env.TWILIO_AUTH_TOKEN;

        return new Response(
          JSON.stringify({
            live: !!(sid && token),
            timestamp: Date.now(),
          }),
          {
            headers: {
              'Content-Type': 'application/json',
            },
          }
        );
      },
    },
  },
});
