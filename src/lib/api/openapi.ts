export function buildOpenApiSpec(origin: string) {
  const bearer = { ApiKeyAuth: [] as string[] };
  const idParam = {
    name: "id",
    in: "path",
    required: true,
    schema: { type: "string", format: "uuid" },
  };

  const schemas = {
    Error: {
      type: "object",
      properties: {
        error: {
          type: "object",
          properties: {
            status: { type: "integer" },
            message: { type: "string" },
            details: {},
          },
        },
      },
    },
    Agent: {
      type: "object",
      required: ["id", "name", "voice_id"],
      properties: {
        id: { type: "string", format: "uuid" },
        name: { type: "string" },
        voice_id: { type: "string", description: "ElevenLabs voice id" },
        language: { type: "string", example: "en-US" },
        greeting: { type: "string" },
        system_prompt: { type: "string" },
        temperature: { type: "number", minimum: 0, maximum: 1 },
        created_at: { type: "string", format: "date-time" },
      },
    },
    AgentInput: {
      type: "object",
      required: ["name", "voice_id"],
      properties: {
        name: { type: "string" },
        voice_id: { type: "string" },
        language: { type: "string" },
        greeting: { type: "string" },
        system_prompt: { type: "string" },
        temperature: { type: "number" },
      },
    },
    Contact: {
      type: "object",
      required: ["id", "phone"],
      properties: {
        id: { type: "string", format: "uuid" },
        name: { type: "string" },
        phone: { type: "string", example: "+15551234567" },
        email: { type: "string", format: "email" },
        company: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        status: {
          type: "string",
          enum: ["new", "called", "completed", "dnc"],
        },
        created_at: { type: "string", format: "date-time" },
      },
    },
    ContactInput: {
      type: "object",
      required: ["phone"],
      properties: {
        name: { type: "string" },
        phone: { type: "string" },
        email: { type: "string" },
        company: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
      },
    },
    Campaign: {
      type: "object",
      required: ["id", "name", "status"],
      properties: {
        id: { type: "string", format: "uuid" },
        name: { type: "string" },
        agent_id: { type: "string", format: "uuid", nullable: true },
        status: {
          type: "string",
          enum: ["draft", "scheduled", "running", "paused", "completed"],
        },
        concurrency: { type: "integer", minimum: 1, maximum: 100 },
        from_number: { type: "string" },
        script: { type: "string" },
        contact_ids: {
          type: "array",
          items: { type: "string", format: "uuid" },
        },
        created_at: { type: "string", format: "date-time" },
        started_at: { type: "string", format: "date-time", nullable: true },
        completed_at: { type: "string", format: "date-time", nullable: true },
      },
    },
    CampaignInput: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string" },
        agent_id: { type: "string", format: "uuid" },
        concurrency: { type: "integer" },
        from_number: { type: "string" },
        script: { type: "string" },
        contact_ids: {
          type: "array",
          items: { type: "string", format: "uuid" },
        },
      },
    },
    Call: {
      type: "object",
      properties: {
        id: { type: "string", format: "uuid" },
        campaign_id: { type: "string", format: "uuid", nullable: true },
        contact_id: { type: "string", format: "uuid", nullable: true },
        agent_id: { type: "string", format: "uuid", nullable: true },
        from_number: { type: "string" },
        to_number: { type: "string" },
        status: {
          type: "string",
          enum: [
            "queued",
            "ringing",
            "in_progress",
            "completed",
            "failed",
            "no_answer",
            "busy",
          ],
        },
        outcome: { type: "string", nullable: true },
        duration_seconds: { type: "integer" },
        recording_url: { type: "string", nullable: true },
        transcript: {
          type: "array",
          items: {
            type: "object",
            properties: {
              role: { type: "string", enum: ["agent", "user"] },
              text: { type: "string" },
              ts: { type: "integer" },
            },
          },
        },
        provider_call_sid: { type: "string", nullable: true },
        started_at: { type: "string", format: "date-time" },
        ended_at: { type: "string", format: "date-time", nullable: true },
      },
    },
    Automation: {
      type: "object",
      properties: {
        id: { type: "string", format: "uuid" },
        name: { type: "string" },
        trigger: {
          type: "string",
          enum: ["call_completed", "call_failed", "call_no_answer", "appointment_booked", "webhook"],
        },
        action: {
          type: "string",
          enum: ["webhook", "email", "sms", "tag_contact"],
        },
        config: { type: "object", additionalProperties: true },
        enabled: { type: "boolean" },
        created_at: { type: "string", format: "date-time" },
      },
    },
    AutomationInput: {
      type: "object",
      required: ["name", "trigger", "action"],
      properties: {
        name: { type: "string" },
        trigger: {
          type: "string",
          enum: ["call_completed", "call_failed", "call_no_answer", "appointment_booked", "webhook"],
        },
        action: {
          type: "string",
          enum: ["webhook", "email", "sms", "tag_contact"],
        },
        config: { type: "object", additionalProperties: true },
        enabled: { type: "boolean" },
      },
    },
    TranscriptTurn: {
      type: "object",
      properties: {
        role: { type: "string", enum: ["user", "assistant"] },
        content: { type: "string" },
      },
    },
    CallPayload: {
      type: "object",
      description:
        "Full call record delivered to automation webhooks on post-call events.",
      properties: {
        id: { type: "string", format: "uuid" },
        twilio_call_sid: { type: "string" },
        user_id: { type: "string", format: "uuid" },
        agent_id: { type: "string", format: "uuid", nullable: true },
        campaign_id: { type: "string", format: "uuid", nullable: true },
        contact_id: { type: "string", format: "uuid", nullable: true },
        direction: { type: "string", enum: ["inbound", "outbound"], nullable: true },
        phone_to: { type: "string", example: "+15551234567" },
        phone_from: { type: "string", nullable: true, example: "+15559876543" },
        status: {
          type: "string",
          enum: [
            "queued",
            "ringing",
            "in_progress",
            "completed",
            "failed",
            "no_answer",
            "busy",
          ],
        },
        started_at: { type: "string", format: "date-time", nullable: true },
        ended_at: { type: "string", format: "date-time", nullable: true },
        duration_sec: { type: "integer", nullable: true },
        recording_url: { type: "string", nullable: true },
        end_reason: {
          type: "string",
          nullable: true,
          description:
            "Canonical short code (agent_ended, transfer, caller_hangup, no_answer, busy, carrier_failed, voicemail_left, voicemail_hangup, silence_timeout, max_duration, bridge_error, agent_config_error, canceled, other).",
        },
        transcript: {
          type: "array",
          nullable: true,
          items: { $ref: "#/components/schemas/TranscriptTurn" },
        },
        extracted_data: {
          type: "object",
          additionalProperties: true,
          description:
            "Structured fields extracted from the transcript, keyed by the agent's configured data_fields. Absent keys mean the value was not stated.",
        },
      },
    },
    PostCallWebhookPayload: {
      type: "object",
      description:
        "Payload delivered to automation webhooks after a call ends. Emitted by both the bridge (call_completed) and the Twilio status callback (call_completed / call_failed / call_no_answer).",
      required: ["event", "call", "data", "automation"],
      properties: {
        event: {
          type: "string",
          enum: ["call_completed", "call_failed", "call_no_answer"],
        },
        call: { $ref: "#/components/schemas/CallPayload" },
        data: {
          type: "object",
          additionalProperties: true,
          description:
            "Only the agent-defined extracted fields for this call. Same object as call.extracted_data.",
        },
        automation: { type: "string", format: "uuid" },
      },
      example: {
        event: "call_completed",
        automation: "0f6b4b98-3c5d-4a2c-9d3f-2a1e1d3e9c11",
        call: {
          id: "1b2f8e34-4c9a-4a52-a7b6-df6b0c2f4a01",
          twilio_call_sid: "CA1234567890abcdef1234567890abcdef",
          user_id: "0d7d6d6a-1f8e-4a51-8ae5-6f0f4b2d3a10",
          agent_id: "8a5f0b31-2c9d-4b7e-9c88-1a2b3c4d5e6f",
          campaign_id: null,
          contact_id: "2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f",
          direction: "outbound",
          phone_to: "+15551234567",
          phone_from: "+15559876543",
          status: "completed",
          started_at: "2026-07-08T15:04:03.000Z",
          ended_at: "2026-07-08T15:06:41.000Z",
          duration_sec: 158,
          recording_url: "https://api.twilio.com/2010-04-01/Accounts/AC.../Recordings/RE...",
          end_reason: "caller_hangup",
          transcript: [
            { role: "assistant", content: "Hi, this is Ava calling from Acme. Do you have a moment?" },
            { role: "user", content: "Sure, go ahead." },
            { role: "assistant", content: "Great — can I grab your email to send the follow-up?" },
            { role: "user", content: "It's jane@example.com." },
          ],
          extracted_data: {
            full_name: "Jane Doe",
            email: "jane@example.com",
            interested: true,
          },
        },
        data: {
          full_name: "Jane Doe",
          email: "jane@example.com",
          interested: true,
        },
      },
    },
    TwilioCallEvent: {
      type: "object",
      description:
        "Twilio status callback (application/x-www-form-urlencoded also accepted). CallSid is required.",
      properties: {
        CallSid: { type: "string" },
        CallStatus: {
          type: "string",
          enum: [
            "queued",
            "ringing",
            "in-progress",
            "completed",
            "busy",
            "failed",
            "no-answer",
            "canceled",
          ],
        },
        From: { type: "string" },
        To: { type: "string" },
        CallDuration: { type: "string" },
        RecordingUrl: { type: "string" },
      },
    },

  } as const;

  const listResp = (ref: string) => ({
    "200": {
      description: "OK",
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              data: { type: "array", items: { $ref: `#/components/schemas/${ref}` } },
              count: { type: "integer" },
            },
          },
        },
      },
    },
  });

  const itemResp = (ref: string, status = "200", desc = "OK") => ({
    [status]: {
      description: desc,
      content: {
        "application/json": {
          schema: { $ref: `#/components/schemas/${ref}` },
        },
      },
    },
  });

  const errResp = {
    "400": { description: "Bad Request", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
    "401": { description: "Unauthorized", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
    "404": { description: "Not Found", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
  };

  const resource = (name: string, schema: string, inputSchema: string) => ({
    [`/api/${name}`]: {
      get: {
        tags: [name],
        summary: `List ${name}`,
        security: [bearer],
        responses: { ...listResp(schema), ...errResp },
      },
      post: {
        tags: [name],
        summary: `Create ${schema.toLowerCase()}`,
        security: [bearer],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: `#/components/schemas/${inputSchema}` },
            },
          },
        },
        responses: { ...itemResp(schema, "201", "Created"), ...errResp },
      },
    },
    [`/api/${name}/{id}`]: {
      parameters: [idParam],
      get: {
        tags: [name],
        summary: `Get ${schema.toLowerCase()}`,
        security: [bearer],
        responses: { ...itemResp(schema), ...errResp },
      },
      patch: {
        tags: [name],
        summary: `Update ${schema.toLowerCase()}`,
        security: [bearer],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: `#/components/schemas/${inputSchema}` },
            },
          },
        },
        responses: { ...itemResp(schema), ...errResp },
      },
      delete: {
        tags: [name],
        summary: `Delete ${schema.toLowerCase()}`,
        security: [bearer],
        responses: { "204": { description: "Deleted" }, ...errResp },
      },
    },
  });

  return {
    openapi: "3.0.3",
    info: {
      title: "BulkCall AI REST API",
      version: "1.0.0",
      description:
        "Programmatic access to BulkCall AI: agents, contacts, campaigns, calls, automations, and webhook receivers for Twilio call events.",
    },
    servers: [{ url: origin }],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: "apiKey",
          in: "header",
          name: "X-Api-Key",
          description:
            "Workspace API key. In preview mode with no BULKCALL_API_KEY secret set, auth is disabled.",
        },
      },
      schemas,
    },
    security: [bearer],
    tags: [
      { name: "agents" },
      { name: "contacts" },
      { name: "campaigns" },
      { name: "calls" },
      { name: "automations" },
      { name: "webhooks", description: "Public endpoints — signature-verified, no API key." },
    ],
    paths: {
      ...resource("agents", "Agent", "AgentInput"),
      ...resource("contacts", "Contact", "ContactInput"),
      ...resource("campaigns", "Campaign", "CampaignInput"),
      ...resource("automations", "Automation", "AutomationInput"),
      "/api/campaigns/{id}/start": {
        parameters: [idParam],
        post: {
          tags: ["campaigns"],
          summary: "Start a campaign",
          security: [bearer],
          responses: { ...itemResp("Campaign"), ...errResp },
        },
      },
      "/api/campaigns/{id}/pause": {
        parameters: [idParam],
        post: {
          tags: ["campaigns"],
          summary: "Pause a running campaign",
          security: [bearer],
          responses: { ...itemResp("Campaign"), ...errResp },
        },
      },
      "/api/calls": {
        get: {
          tags: ["calls"],
          summary: "List calls",
          security: [bearer],
          parameters: [
            { name: "campaign_id", in: "query", schema: { type: "string" } },
            { name: "status", in: "query", schema: { type: "string" } },
            { name: "limit", in: "query", schema: { type: "integer", default: 50 } },
          ],
          responses: { ...listResp("Call"), ...errResp },
        },
      },
      "/api/calls/{id}": {
        parameters: [idParam],
        get: {
          tags: ["calls"],
          summary: "Get a call",
          security: [bearer],
          responses: { ...itemResp("Call"), ...errResp },
        },
      },
      "/api/public/webhooks/twilio": {
        post: {
          tags: ["webhooks"],
          summary: "Twilio status callback receiver",
          description:
            "Configure this URL as your Twilio statusCallback. Accepts application/json or application/x-www-form-urlencoded. Verifies X-Twilio-Signature when TWILIO_AUTH_TOKEN is configured.",
          security: [],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TwilioCallEvent" },
              },
              "application/x-www-form-urlencoded": {
                schema: { $ref: "#/components/schemas/TwilioCallEvent" },
              },
            },
          },
          responses: {
            "200": { description: "Event accepted" },
            "401": { description: "Invalid signature" },
          },
        },
      },
      "/api/public/webhooks/automations": {
        post: {
          tags: ["webhooks"],
          summary: "Generic inbound automation trigger",
          description:
            "Any POST here with `automation_id` fires the matching automation. Verified with HMAC-SHA256 in `X-Webhook-Signature` when AUTOMATION_WEBHOOK_SECRET is configured.",
          security: [],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["automation_id"],
                  properties: {
                    automation_id: { type: "string", format: "uuid" },
                    payload: { type: "object", additionalProperties: true },
                  },
                },
              },
            },
          },
          responses: {
            "202": { description: "Queued" },
            "401": { description: "Invalid signature" },
            "404": { description: "Automation not found" },
          },
        },
      },
    },
  };
}
