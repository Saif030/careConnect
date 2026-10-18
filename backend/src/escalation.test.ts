process.env.NODE_ENV = "test";

import assert from "node:assert/strict";
import { test, beforeEach, afterEach } from "node:test";
import type { Alert, Medication, VitalsPacket } from "./types.js";
import {
  handleAlertEscalation,
  acknowledgeAlert,
  formatEscalationMessage,
  formatVoiceMessage,
  getActiveEscalation,
  clearAllActiveEscalations,
  resetRateLimits,
} from "./escalation.js";
import {
  setMockTwilioClient,
  TwilioClientInterface,
} from "./notifications/twilio.js";
import {
  getAuditTrail,
  clearInMemoryAuditTrail,
} from "./db/index.js";

// Helper to construct sample alerts
function createRedAlert(overrides?: Partial<Alert>): Alert {
  return {
    event_id: `evt_red_${Math.random().toString(36).slice(2, 8)}`,
    patient_id: "pt_001",
    timestamp: "2026-10-18T03:00:00.000Z",
    severity: "RED",
    type: "VITALS",
    message: "Critical vital sign deviation detected.",
    instructions: ["Stay with the patient.", "Escalate to a clinician."],
    contributing_signals: ["spo2"],
    ...overrides,
  };
}

function sampleVitals(): VitalsPacket {
  return {
    patient_id: "pt_001",
    timestamp: "2026-10-18T03:00:00.000Z",
    heart_rate: 135,
    spo2: 89,
    systolic_bp: 175,
    diastolic_bp: 105,
  };
}

function sampleMeds(): Medication[] {
  return [
    {
      drug_name: "Metoprolol",
      generic_name: "metoprolol tartrate",
      form: "tablet",
      strength: "50 mg",
      frequency: "BID",
      timing: "with meals",
      duration_days: 30,
      confidence: 0.95,
      rxnorm_id: "866418",
    },
    {
      drug_name: "Lisinopril",
      generic_name: "lisinopril",
      form: "tablet",
      strength: "10 mg",
      frequency: "once daily",
      timing: "morning",
      duration_days: 90,
      confidence: 0.98,
      rxnorm_id: "314076",
    },
  ];
}

// In-memory mock Twilio tracker
interface MockTwilioTracker {
  messages: Array<{ to: string; from: string; body: string }>;
  calls: Array<{ to: string; from: string; twiml: string }>;
}

let mockTwilio: MockTwilioTracker;

beforeEach(() => {
  clearAllActiveEscalations();
  resetRateLimits();
  clearInMemoryAuditTrail();

  mockTwilio = {
    messages: [],
    calls: [],
  };

  const client: TwilioClientInterface = {
    messages: {
      create: async (opts) => {
        mockTwilio.messages.push(opts);
        return { sid: `SM_${mockTwilio.messages.length}` };
      },
    },
    calls: {
      create: async (opts) => {
        mockTwilio.calls.push(opts);
        return { sid: `CA_${mockTwilio.calls.length}` };
      },
    },
  };

  setMockTwilioClient(client);
});

afterEach(() => {
  clearAllActiveEscalations();
  setMockTwilioClient(null);
});

test("Message template contains all required fields", () => {
  const alert = createRedAlert();
  const vitals = sampleVitals();
  const meds = sampleMeds();

  const msg = formatEscalationMessage(
    alert,
    {
      patientName: "Jane Doe",
      vitals,
      medications: meds,
    },
    "https://careconnect.example.com",
  );

  assert.ok(msg.includes("Jane Doe"), "Must contain patient name");
  assert.ok(msg.includes(alert.timestamp), "Must contain alert time");
  assert.ok(msg.includes(alert.message), "Must contain summary");
  assert.ok(msg.includes("HR 135 bpm"), "Must contain heart rate");
  assert.ok(msg.includes("SpO2 89%"), "Must contain SpO2");
  assert.ok(msg.includes("BP 175/105 mmHg"), "Must contain blood pressure");
  assert.ok(msg.includes("Metoprolol"), "Must contain medication");
  assert.ok(msg.includes("Lisinopril"), "Must contain medication");
  assert.ok(
    msg.includes("https://careconnect.example.com/patient/pt_001"),
    "Must contain dashboard link",
  );

  const voiceMsg = formatVoiceMessage(alert, { patientName: "Jane Doe", vitals });
  assert.ok(voiceMsg.includes("Jane Doe"));
  assert.ok(voiceMsg.includes("135"));
});

test("Non-RED alerts (GREEN, YELLOW) are ignored by escalation", async () => {
  const greenAlert: Alert = {
    ...createRedAlert(),
    severity: "GREEN",
  };
  const res = await handleAlertEscalation(greenAlert);
  assert.equal(res.status, "IGNORED");
  assert.equal(getActiveEscalation(greenAlert.event_id), undefined);
});

test("Acknowledgment cancel path: cancels timer before Step 1 and logs it", async () => {
  const alert = createRedAlert();
  const res = await handleAlertEscalation(alert, {
    patientName: "John Smith",
    vitals: sampleVitals(),
  }, {
    step1DelayMs: 50, // 50ms fast test timer
    step2DelayMs: 50,
  });

  assert.equal(res.status, "SCHEDULED");
  assert.ok(getActiveEscalation(alert.event_id) !== undefined);

  // Acknowledge before 50ms timer fires
  const ackRes = await acknowledgeAlert(alert.event_id, {
    acknowledged_by: "Nurse Joy",
    notes: "Patient checked and stabilized",
  });

  assert.equal(ackRes.success, true);
  assert.equal(ackRes.timer_cancelled, true);
  assert.equal(getActiveEscalation(alert.event_id), undefined);

  // Wait long enough for timer to have elapsed if it hadn't been cancelled
  await new Promise((resolve) => setTimeout(resolve, 80));

  // Verify that NO Twilio calls or messages were dispatched
  assert.equal(mockTwilio.messages.length, 0, "No SMS should be sent when acknowledged");
  assert.equal(mockTwilio.calls.length, 0, "No Voice calls should be sent when acknowledged");

  // Verify audit trail contains the acknowledgment and timer cancellation
  const audit = await getAuditTrail({ alert_id: alert.event_id });
  const ackEntry = audit.find((e) => e.entry_type === "ACKNOWLEDGMENT");
  const cancelEntry = audit.find((e) => e.action === "TIMER_CANCELLED");

  assert.ok(ackEntry, "Audit trail must include acknowledgment");
  assert.equal(ackEntry.recipient, "Nurse Joy");
  assert.ok(cancelEntry, "Audit trail must include TIMER_CANCELLED event");
});

test("Timing: Step 1 sends SMS + Voice to primary caregiver, Step 2 notifies secondary contact", async () => {
  const alert = createRedAlert();
  const vitals = sampleVitals();
  const meds = sampleMeds();

  const primaryPhone = "+15551112222";
  const secondaryPhone = "+15553334444";

  await handleAlertEscalation(
    alert,
    {
      patientName: "Alice Walker",
      vitals,
      medications: meds,
      primaryCaregiver: { name: "Dr. Bob", phone: primaryPhone },
      secondaryCaregiver: { name: "Dr. Charlie", phone: secondaryPhone },
    },
    {
      step1DelayMs: 40,
      step2DelayMs: 40,
    },
  );

  // Before Step 1 delay (20ms): no calls yet
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(mockTwilio.messages.length, 0);
  assert.equal(mockTwilio.calls.length, 0);

  // After Step 1 delay (~50ms total): primary caregiver notified
  await new Promise((resolve) => setTimeout(resolve, 45));
  const smsMessages = mockTwilio.messages.filter((m) => !m.to.startsWith("whatsapp:"));
  assert.equal(smsMessages.length, 1, "Step 1 should send 1 SMS");
  assert.equal(mockTwilio.calls.length, 1, "Step 1 should place 1 Voice call");
  assert.equal(smsMessages[0].to, primaryPhone);
  assert.equal(mockTwilio.calls[0].to, primaryPhone);
  assert.ok(smsMessages[0].body.includes("Alice Walker"));
  assert.ok(mockTwilio.calls[0].twiml.includes("Alice Walker"));

  // After Step 2 delay: secondary caregiver notified
  await new Promise((resolve) => setTimeout(resolve, 150));
  const smsMessagesStep2 = mockTwilio.messages.filter((m) => !m.to.startsWith("whatsapp:"));
  assert.equal(smsMessagesStep2.length, 2, "Step 2 should send second SMS");
  assert.equal(mockTwilio.calls.length, 2, "Step 2 should place second Voice call");
  assert.equal(smsMessagesStep2[1].to, secondaryPhone);
  assert.equal(mockTwilio.calls[1].to, secondaryPhone);

  // Verify full audit trail
  const audit = await getAuditTrail({ alert_id: alert.event_id });
  const step1Sms = audit.find((e) => e.action === "STEP_1_SMS");
  const step1Voice = audit.find((e) => e.action === "STEP_1_VOICE");
  const step1Fcm = audit.find((e) => e.action === "STEP_1_FCM" || e.action === "STEP_1_Supabase");
  const step2Sms = audit.find((e) => e.action === "STEP_2_SMS");
  const step2Voice = audit.find((e) => e.action === "STEP_2_VOICE");

  assert.ok(step1Sms, "Must log Step 1 SMS in audit trail");
  assert.ok(step1Voice, "Must log Step 1 Voice in audit trail");
  assert.ok(step1Fcm, "Must log Step 1 FCM / Supabase in audit trail");
  assert.ok(step2Sms, "Must log Step 2 SMS in audit trail");
  assert.ok(step2Voice, "Must log Step 2 Voice in audit trail");
});

test("Acknowledgment between Step 1 and Step 2 cancels Step 2 secondary notification", async () => {
  const alert = createRedAlert();
  const primaryPhone = "+15551112222";
  const secondaryPhone = "+15553334444";

  await handleAlertEscalation(
    alert,
    {
      patientName: "David Miller",
      primaryCaregiver: { name: "Dr. Bob", phone: primaryPhone },
      secondaryCaregiver: { name: "Dr. Charlie", phone: secondaryPhone },
    },
    {
      step1DelayMs: 30,
      step2DelayMs: 50,
    },
  );

  // Wait for Step 1 to fire (40ms)
  await new Promise((resolve) => setTimeout(resolve, 40));
  const smsMessagesAck = mockTwilio.messages.filter((m) => !m.to.startsWith("whatsapp:"));
  assert.equal(smsMessagesAck.length, 1);
  assert.equal(mockTwilio.calls.length, 1);

  // Acknowledge before Step 2 fires
  const ack = await acknowledgeAlert(alert.event_id, {
    acknowledged_by: "Dr. Bob",
    notes: "Got the SMS, taking care of David now.",
  });
  assert.equal(ack.timer_cancelled, true);

  // Wait past Step 2 window
  await new Promise((resolve) => setTimeout(resolve, 60));

  // Secondary contact must NOT have received any notification
  const smsMessagesAfterAck = mockTwilio.messages.filter((m) => !m.to.startsWith("whatsapp:"));
  assert.equal(smsMessagesAfterAck.length, 1, "Secondary contact must not receive SMS");
  assert.equal(mockTwilio.calls.length, 1, "Secondary contact must not receive Voice call");
});

test("Rate limiting: max 1 notification per patient per alert type per 5 minutes", async () => {
  const alert1 = createRedAlert({ patient_id: "pt_rate_test", type: "VITALS" });
  const alert2 = createRedAlert({ patient_id: "pt_rate_test", type: "VITALS" });
  const alertOtherType = createRedAlert({ patient_id: "pt_rate_test", type: "COMPOUND" });

  const res1 = await handleAlertEscalation(
    alert1,
    {},
    {
      step1DelayMs: 20,
      step2DelayMs: 20,
      rateLimitWindowMs: 5000, // 5s rate limit window
    },
  );
  assert.equal(res1.status, "SCHEDULED");

  // Wait for Step 1 notification to fire so rate limit is recorded
  await new Promise((resolve) => setTimeout(resolve, 30));

  // Second alert for same patient and same alert type should be rate limited
  const res2 = await handleAlertEscalation(
    alert2,
    {},
    {
      step1DelayMs: 20,
      step2DelayMs: 20,
      rateLimitWindowMs: 5000,
    },
  );
  assert.equal(res2.status, "RATE_LIMITED");
  assert.ok(res2.reason?.includes("Rate limit exceeded"));

  // Alert for a different alert type (COMPOUND) should NOT be rate limited
  const res3 = await handleAlertEscalation(
    alertOtherType,
    {},
    {
      step1DelayMs: 20,
      step2DelayMs: 20,
      rateLimitWindowMs: 5000,
    },
  );
  assert.equal(res3.status, "SCHEDULED");
});

test("Mock mode (MOCK_NOTIFICATIONS=true) logs cleanly without twilio or keys", async () => {
  setMockTwilioClient(null);
  const oldEnv = process.env.MOCK_NOTIFICATIONS;
  process.env.MOCK_NOTIFICATIONS = "true";

  try {
    const alert = createRedAlert();
    await handleAlertEscalation(
      alert,
      {
        patientName: "Demo Patient",
        vitals: sampleVitals(),
      },
      {
        step1DelayMs: 20,
        step2DelayMs: 20,
      },
    );

    await new Promise((resolve) => setTimeout(resolve, 60));

    const audit = await getAuditTrail({ alert_id: alert.event_id });
    const notifications = audit.filter((e) => e.entry_type === "NOTIFICATION");
    assert.ok(notifications.length >= 3);
    for (const n of notifications) {
      assert.equal(n.status, "MOCKED");
    }
  } finally {
    process.env.MOCK_NOTIFICATIONS = oldEnv;
  }
});
