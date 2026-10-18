import twilio from "twilio";

export interface TwilioNotificationResult {
  sid: string;
  channel: "SMS" | "VOICE" | "WHATSAPP";
  to: string;
  status: "SENT" | "MOCKED" | "FAILED";
  error?: string;
}

export interface TwilioWhatsAppOptions {
  to: string;
  from?: string;
  body?: string;
  contentSid?: string;
  contentVariables?: string | Record<string, string>;
}

export interface TwilioClientInterface {
  messages: {
    create: (opts: {
      body?: string;
      to: string;
      from: string;
      contentSid?: string;
      contentVariables?: string;
    }) => Promise<{ sid: string }>;
  };
  calls: {
    create: (opts: { twiml: string; to: string; from: string }) => Promise<{ sid: string }>;
  };
}

let customTwilioClient: TwilioClientInterface | null = null;

export function setMockTwilioClient(mockClient: TwilioClientInterface | null): void {
  customTwilioClient = mockClient;
}

export function getTwilioClient(): TwilioClientInterface | null {
  if (customTwilioClient) {
    return customTwilioClient;
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (accountSid && authToken && accountSid.startsWith("AC")) {
    return twilio(accountSid, authToken) as unknown as TwilioClientInterface;
  }
  return null;
}

export async function sendTwilioSms(
  to: string,
  body: string,
): Promise<TwilioNotificationResult> {
  const isMock =
    process.env.MOCK_NOTIFICATIONS === "true" ||
    process.env.NODE_ENV === "test";

  if (customTwilioClient) {
    const from = process.env.TWILIO_PHONE_NUMBER || "+15005550006";
    const res = await customTwilioClient.messages.create({ body, to, from });
    return {
      sid: res.sid,
      channel: "SMS",
      to,
      status: "SENT",
    };
  }

  if (isMock) {
    const mockSid = `SM_mock_${Math.random().toString(36).slice(2, 10)}`;
    console.log(`[MOCK NOTIFICATION][SMS] -> ${to}:\n${body}`);
    return {
      sid: mockSid,
      channel: "SMS",
      to,
      status: "MOCKED",
    };
  }

  const client = getTwilioClient();
  const from = process.env.TWILIO_PHONE_NUMBER;

  if (!client || !from) {
    console.warn("[Twilio SMS] Twilio credentials or TWILIO_PHONE_NUMBER missing. Falling back to mock.");
    return {
      sid: `SM_fallback_${Date.now()}`,
      channel: "SMS",
      to,
      status: "MOCKED",
    };
  }

  try {
    const cleanTo = to.replace(/[^0-9+]/g, "");
    const cleanFrom = from.replace(/[^0-9+]/g, "");
    const formattedTo = cleanTo.startsWith("+") ? cleanTo : `+${cleanTo}`;
    const formattedFrom = cleanFrom.startsWith("+") ? cleanFrom : `+${cleanFrom}`;
    const message = await client.messages.create({ body, to: formattedTo, from: formattedFrom });
    return {
      sid: message.sid,
      channel: "SMS",
      to: formattedTo,
      status: "SENT",
    };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[Twilio SMS] Failed to send SMS to ${to}:`, errMsg);
    return {
      sid: "",
      channel: "SMS",
      to,
      status: "FAILED",
      error: errMsg,
    };
  }
}

export async function sendTwilioVoiceCall(
  to: string,
  spokenMessage: string,
): Promise<TwilioNotificationResult> {
  const isMock =
    process.env.MOCK_NOTIFICATIONS === "true" ||
    process.env.NODE_ENV === "test";

  const twiml = `<Response><Say voice="alice">${escapeXml(spokenMessage)}</Say></Response>`;

  if (customTwilioClient) {
    const from = process.env.TWILIO_PHONE_NUMBER || "+15005550006";
    const res = await customTwilioClient.calls.create({ twiml, to, from });
    return {
      sid: res.sid,
      channel: "VOICE",
      to,
      status: "SENT",
    };
  }

  if (isMock) {
    const mockSid = `CA_mock_${Math.random().toString(36).slice(2, 10)}`;
    console.log(`[MOCK NOTIFICATION][VOICE CALL] -> ${to}:\n"${spokenMessage}"`);
    return {
      sid: mockSid,
      channel: "VOICE",
      to,
      status: "MOCKED",
    };
  }

  const client = getTwilioClient();
  const from = process.env.TWILIO_PHONE_NUMBER;

  if (!client || !from) {
    console.warn("[Twilio Voice] Twilio credentials or TWILIO_PHONE_NUMBER missing. Falling back to mock.");
    return {
      sid: `CA_fallback_${Date.now()}`,
      channel: "VOICE",
      to,
      status: "MOCKED",
    };
  }

  try {
    const call = await client.calls.create({ twiml, to, from });
    return {
      sid: call.sid,
      channel: "VOICE",
      to,
      status: "SENT",
    };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[Twilio Voice] Failed to place voice call to ${to}:`, errMsg);
    return {
      sid: "",
      channel: "VOICE",
      to,
      status: "FAILED",
      error: errMsg,
    };
  }
}

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function sendTwilioWhatsApp(
  optionsOrTo: string | TwilioWhatsAppOptions,
  bodyOrVariables?: string | Record<string, string>,
): Promise<TwilioNotificationResult> {
  const isMock =
    process.env.MOCK_NOTIFICATIONS === "true" ||
    process.env.NODE_ENV === "test";

  let to: string;
  let from: string | undefined;
  let body: string | undefined;
  let contentSid: string | undefined;
  let contentVariables: string | undefined;

  if (typeof optionsOrTo === "string") {
    to = optionsOrTo;
    if (typeof bodyOrVariables === "string") {
      body = bodyOrVariables;
    } else if (bodyOrVariables && typeof bodyOrVariables === "object") {
      contentVariables = JSON.stringify(bodyOrVariables);
      contentSid = process.env.TWILIO_CONTENT_SID;
    }
  } else {
    to = optionsOrTo.to;
    body = optionsOrTo.body;
    contentSid = optionsOrTo.contentSid;
    if (typeof optionsOrTo.contentVariables === "string") {
      contentVariables = optionsOrTo.contentVariables;
    } else if (optionsOrTo.contentVariables && typeof optionsOrTo.contentVariables === "object") {
      contentVariables = JSON.stringify(optionsOrTo.contentVariables);
    }
    if (optionsOrTo.from) {
      from = optionsOrTo.from;
    }
  }

  // Only fallback to TWILIO_CONTENT_SID if no body is provided and caller did not specify
  if (!body && !contentSid && process.env.TWILIO_CONTENT_SID) {
    contentSid = process.env.TWILIO_CONTENT_SID;
  }

  from = from || process.env.TWILIO_WHATSAPP_FROM || "whatsapp:+14155238886";
  const cleanTo = to.replace(/whatsapp:/i, "").replace(/[^0-9+]/g, "");
  const cleanFrom = from.replace(/whatsapp:/i, "").replace(/[^0-9+]/g, "");
  to = `whatsapp:${cleanTo.startsWith("+") ? cleanTo : `+${cleanTo}`}`;
  from = `whatsapp:${cleanFrom.startsWith("+") ? cleanFrom : `+${cleanFrom}`}`;

  if (customTwilioClient) {
    const createOpts: any = { to, from };
    if (contentSid) {
      createOpts.contentSid = contentSid;
      if (contentVariables) createOpts.contentVariables = contentVariables;
    } else {
      createOpts.body = body || "CareConnect WhatsApp Alert";
    }
    const res = await customTwilioClient.messages.create(createOpts);
    return {
      sid: res.sid,
      channel: "WHATSAPP",
      to,
      status: "SENT",
    };
  }

  if (isMock) {
    const mockSid = `WA_mock_${Math.random().toString(36).slice(2, 10)}`;
    console.log(
      `[MOCK NOTIFICATION][WHATSAPP] -> ${to} (from: ${from}):\n${
        contentSid ? `ContentSid: ${contentSid}, Vars: ${contentVariables}` : body
      }`,
    );
    return {
      sid: mockSid,
      channel: "WHATSAPP",
      to,
      status: "MOCKED",
    };
  }

  const client = getTwilioClient();
  if (!client) {
    console.warn("[Twilio WhatsApp] Twilio credentials missing. Falling back to mock.");
    return {
      sid: `WA_fallback_${Date.now()}`,
      channel: "WHATSAPP",
      to,
      status: "MOCKED",
    };
  }

  try {
    const createOpts: any = { to, from };
    if (contentSid) {
      createOpts.contentSid = contentSid;
      if (contentVariables) createOpts.contentVariables = contentVariables;
    } else {
      createOpts.body = body || "CareConnect WhatsApp Alert";
    }

    let message;
    try {
      message = await client.messages.create(createOpts);
    } catch (createErr: any) {
      if (contentSid && (createErr.message?.includes("Content") || createErr.status === 404)) {
        console.warn(
          `[Twilio WhatsApp] Content template '${contentSid}' not found. Falling back to direct text body.`,
        );
        const fallbackOpts: any = {
          to,
          from,
          body: body || "CareConnect Alert: Clinical status update for patient monitoring.",
        };
        message = await client.messages.create(fallbackOpts);
      } else {
        throw createErr;
      }
    }

    console.log(`[Twilio WhatsApp] Successfully sent WhatsApp message SID: ${message.sid} to ${to}`);
    return {
      sid: message.sid,
      channel: "WHATSAPP",
      to,
      status: "SENT",
    };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[Twilio WhatsApp] Failed to send WhatsApp message to ${to}:`, errMsg);
    return {
      sid: "",
      channel: "WHATSAPP",
      to,
      status: "FAILED",
      error: errMsg,
    };
  }
}

