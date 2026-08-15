# Call Whisper

Create a production-ready SaaS application called "BulkCall AI".

The platform should allow users to create and launch AI-powered outbound calling campaigns at scale using Twilio for telephony and ElevenLabs for AI voices. The application should be modern, responsive, production-ready, and use React, TypeScript, Tailwind CSS, Supabase Authentication, PostgreSQL, and Edge Functions.

The platform should NOT include a CRM. It should focus entirely on AI calling campaigns.

========================================

AUTHENTICATION

========================================

- Sign Up

- Login

- Forgot Password

- Email Verification

- Multi-tenant organizations

- Team members

- Role-based permissions

========================================

DASHBOARD

========================================

Display:

- Active campaigns

- Calls made today

- Calls answered

- Calls completed

- AI minutes used

- Success rate

- Appointments booked

- Live calls

- Failed calls

Include charts and analytics.

========================================

CONTACT LISTS

========================================

Allow users to:

- Upload CSV

- Import Excel

- Manual contact entry

- Bulk delete

- Bulk edit

- Contact tags

- Duplicate detection

- Contact validation

Each contact should support:

- Name

- Company

- Phone

- Email

- Custom variables

- Notes

========================================

AI AGENTS

========================================

Allow unlimited AI agents.

Each AI agent should have:

- Name

- Voice

- Language

- Greeting

- Prompt

- System Prompt

- Business knowledge

- Personality

- Temperature

- Call objective

- Qualification questions

- Transfer rules

- Voicemail handling

- End call conditions

- Retry logic

========================================

VOICE

========================================

Integrate directly with ElevenLabs.

Support:

- Voice selection

- Voice cloning

- Streaming TTS

- Multiple languages

- Low latency audio

========================================

PHONE

========================================

Integrate directly with Twilio.

Support:

- Outbound calling

- Inbound calling

- Local numbers

- Toll-free numbers

- Caller ID

- Call recording

- Voicemail detection

- AMD (Answering Machine Detection)

- Status callbacks

- Media Streams

- ConversationRelay

========================================

AI

========================================

Integrate OpenAI GPT.

Support:

- Real-time conversations

- Function calling

- Memory

- Context

- Structured outputs

========================================

CAMPAIGNS

========================================

Users should be able to:

Create Campaign

Select AI Agent

Select Contact List

Select Twilio Number

Choose Time Zone

Choose Calling Hours

Set Calls Per Minute

Configure Retry Rules

Configure Voicemail Rules

Launch Campaign

Pause Campaign

Resume Campaign

Duplicate Campaign

Stop Campaign

========================================

CAMPAIGN ANALYTICS

========================================

Show:

- Total Calls

- Completed Calls

- Connected Calls

- No Answer

- Busy

- Failed

- Voicemail

- Average Duration

- Cost

- AI Minutes

- Success Rate

========================================

LIVE CALLS

========================================

Real-time dashboard showing:

- Current calls

- AI speaking

- Customer speaking

- Live transcript

- Call timer

- End call

- Transfer call

========================================

CALL HISTORY

========================================

Every call should include:

- Recording

- Transcript

- AI Summary

- Outcome

- Duration

- Cost

- Sentiment

- Appointment booked

- Download transcript

========================================

APPOINTMENT BOOKING

========================================

Allow AI to:

- Book appointments

- Reschedule

- Cancel

- Send confirmation SMS

- Send confirmation email

========================================

AUTOMATIONS

========================================

After a call:

- Send SMS

- Send Email

- Call webhook

- Export data

- Trigger API

- Update Google Sheets

========================================

SETTINGS

========================================

Users can configure:

- Twilio SID

- Twilio Token

- Twilio Numbers

- ElevenLabs API Key

- OpenAI API Key

- Webhooks

- SMTP

- Time Zone

========================================

BILLING

========================================

Track:

- Minutes used

- AI usage

- Twilio cost

- ElevenLabs cost

- OpenAI cost

- Monthly usage

- Subscription plans

========================================

API

========================================

Create a REST API for every feature.

Generate OpenAPI documentation.

Support webhooks.

========================================

ADMIN PANEL

========================================

Manage:

Users

Organizations

Subscriptions

API Keys

Usage

Call Logs

Campaigns

System Logs

========================================

UI

========================================

Create a beautiful modern SaaS interface inspired by:

- Bland AI

- Vapi

- Synthflow

- Retell AI

Use a clean sidebar layout, dark mode, responsive design, loading states, and real-time updates.

Generate complete production-quality code with proper database schema, authentication, reusable components, validation, error handling, and scalable architecture. Do not generate placeholder pages.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://call-flow-ai-48.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/c2d455c6-ca10-450b-8639-635c2ce68556).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
