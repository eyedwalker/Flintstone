# Inbound Voice Path — Code Review

**Context**: Over a multi-session push we added a lot — SMS opt-out, intent classifier, voice tool registry, transfer-to-human, monitoring endpoints, call analyzer, transcription pipeline, signature validation, Nova Sonic 2 bridge, drift remediation across multiple CloudFormation phases. The latest test call (2026-05-29 ~20:03) produced "Application error" on Twilio. Logs show why, plus several other landmines. This document is the holistic review.

## TL;DR

**The blocker for your call: the inbound voice handler can't parse Twilio's form-encoded body.** API Gateway HttpApi delivers form bodies as base64-encoded strings with `event.isBase64Encoded: true`. Our parser does `new URLSearchParams(event.body)` directly. Result: `From`, `To`, `CallSid`, `SpeechResult` are all empty strings on every turn. The handler then makes a session with a random uuid, gets a 401 from Eyefinity on a phone-less patient search, the next Twilio turn callback can't find that session, DDB throws `ValidationException: Key id cannot be empty`, the Lambda returns 5xx, Twilio plays "Application error."

**This is a 3-line fix.** But the path has several other issues worth fixing before the next test, listed below in priority order.

## The call's actual journey (current state of the code, 2026-05-29)

```
Phone +1XXX → Twilio +15806336937
  ↓
POST https://v1k97uw533.../dev/voice/inbound
  body: From=%2B1XXX&To=%2B15806336937&CallSid=CAabc...
  headers: Content-Type: application/x-www-form-urlencoded
           X-Twilio-Signature: ...
  ↓ API Gateway HttpApi (chat-agent-voice, imported)
  ↓ event.body = base64("From=...To=...CallSid=...")
  ↓ event.isBase64Encoded = true       ← NOT HANDLED
  ↓
Lambda chat-agent-api-dev → handler.ts dispatch
  ↓
  /voice/* block at line 103:
    voiceBody = Object.fromEntries(
      new URLSearchParams(event.body).entries()
    )
    // event.body is "RnJvbT0lMkIxNTU1..." (base64, not decoded)
    // URLSearchParams sees no "=" between keys/values
    // voiceBody = {} (empty)
  ↓
  TWILIO_SIGNATURE_VALIDATION=disabled (bypass — fine for now)
  ↓
  handleInboundCall(voiceBody={}, baseUrl)
    callSid = body['CallSid'] ?? uuidv4()   // random uuid because empty
    fromPhone = body['From'] ?? ''           // ""
    toPhone = body['To'] ?? ''               // ""
    isStreamingNumber("") → false            // Sonic 2 path SKIPPED
  ↓
  conversationEngine.createSession(randomUuid, tenantId, 'voice', "", "Emily")
    → integrations.searchPatients(tenant, fromPhone="")
    → Eyefinity API: 401 (or empty result)
  ↓
  buildGreetingTwiml(greeting, baseUrl + /voice/respond)
  ↓ TwiML returned to Twilio (200 OK)
  ↓ Twilio plays greeting, opens Gather for speech
  ↓
[caller says something or stays silent]
  ↓
POST /voice/respond (body again base64-encoded, empty after parse)
  ↓
handleVoiceRespond(voiceBody={}, baseUrl)
  callSid = body['CallSid'] ?? ''   // EMPTY this time, no uuid fallback
  ↓
  conversationEngine.processMessage(callSid="", ...)
    → loadSession({ id: "" })
    → DDB GetItem with empty key
  ↓
  ValidationException: Key id cannot be empty
  ↓ Lambda throws
  ↓ API Gateway returns 5xx
  ↓ Twilio plays "Application error has occurred"
```

## Issues by priority

### Blockers (fix to make the call work)

**B1. `event.isBase64Encoded` is ignored** ([handler.ts:106-112](src/handler.ts#L106))

```typescript
// Current:
const ct = event.headers['content-type'] ?? '';
if (ct.includes('application/x-www-form-urlencoded') && event.body) {
  const params = new URLSearchParams(event.body);
  voiceBody = Object.fromEntries(params.entries());
}
```

API Gateway HttpApi base64-encodes form bodies. Need:

```typescript
if (ct.includes('application/x-www-form-urlencoded') && event.body) {
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf-8')
    : event.body;
  voiceBody = Object.fromEntries(new URLSearchParams(raw).entries());
}
```

Same applies to `parseBody` for the JSON path in [auth.ts:169](src/auth.ts#L169) — bridge endpoints send JSON, and API Gateway leaves `application/json` unencoded BUT only sometimes; safer to always decode if `isBase64Encoded` is true.

**B2. `handleVoiceRespond` has no fallback for empty callSid** ([routes/voice.ts:145](src/routes/voice.ts#L145))

```typescript
const callSid = body['CallSid'] ?? '';
// ... later ...
await conversationEngine.processMessage(callSid, ...)
  → ddb.getItem({ id: callSid })   // throws when id=""
```

Should return a graceful hangup TwiML when callSid is empty, not crash the Lambda.

**B3. Same for `handleInboundCall` indirectly** ([routes/voice.ts:91](src/routes/voice.ts#L91))

`callSid = body['CallSid'] ?? uuidv4()` masks the body-parse failure by inventing a uuid. The session gets created with that random uuid, then the next `/voice/respond` callback uses the REAL CallSid from Twilio (which is finally decoded if we fix B1, or empty if we don't) — either way the session can't be found. Should fail fast if CallSid is missing instead of silently generating one.

### Real bugs (fix to harden)

**R1. `event.requestContext.http` can be undefined** ([handler.ts:80](src/handler.ts#L80))

`const method = event.requestContext.http.method.toUpperCase();` throws `TypeError: Cannot read properties of undefined (reading 'http')` when invoked with an event shape that lacks it. We've seen this fire ~4 times today from unknown invokers. The check at line 67 only covers ONE alternative event shape (Bedrock action group).

Fix: add a defensive early return:

```typescript
if (!event.requestContext?.http) {
  return { statusCode: 400, body: 'Unsupported event shape' };
}
```

**R2. Eyefinity OAuth returning 401 on patient search** (Eyefinity itself)

`[Eyefinity] Patient search returned 401`. Not from our code — Eyefinity rejected the call. Token may be expired, or the credentials in the tenant DDB record need refreshing. Unrelated to the body-parse issue but will also need attention.

**R3. The signature URL reconstruction may not match what Twilio signs** ([twilio-signature.ts:reconstructWebhookUrl](src/services/twilio-signature.ts))

When validation is re-enabled, the reconstructed URL is `https://${host}${stage}${rawPath}`. If `rawPath` already includes the stage (HttpApi V2 named-stage behavior), we double-prefix `/dev/dev/voice/inbound`. The handler strips stage from rawPath at line 85 BEFORE passing to validation, so reconstruction should be ok — but worth verifying with a logged URL comparison against Twilio's expected URL the first time we turn validation back on.

**R4. Bridge endpoints use `body` (JSON-only) while Twilio webhooks use `voiceBody`** ([handler.ts:161-170](src/handler.ts#L161))

```typescript
if (rawPath === '/voice/tool-execute' && method === 'POST') {
  return handleToolExecute(body as Record<string, unknown>, ...);
}
```

If isBase64Encoded ever applies to a JSON request, `body` is null. The bridge endpoints don't get a body. Same root cause as B1 — parse failure on base64.

### Design issues (not bugs, but accumulating risk)

**D1. The `/voice/` dispatcher is doing too much** ([handler.ts:103-178](src/handler.ts#L103))

- Body parsing
- Stage detection
- Module import (dynamic)
- Signature validation (with separate path allowlist)
- Method check
- Route dispatch (12 separate handlers)
- baseUrl construction

That's 7 concerns in one block. After ~10 changes today the block is hard to reason about. Extracting `handleVoiceDispatch(event)` into its own function would let it grow cleanly.

**D2. `body` vs `voiceBody` confusion**

Half the voice handlers take `voiceBody` (form-parsed) and half take `body` (JSON-parsed). The line between them isn't obvious from reading. Easy to wire something wrong on the next change.

**D3. Stage detection in two places** ([handler.ts:85, 115](src/handler.ts#L85))

```typescript
const rawPath = event.rawPath.replace(/^\/dev|^\/prod/, '');     // line 85
const stage = event.rawPath.startsWith('/dev') ? '/dev' : ...;   // line 115
```

Same detection, different uses. If a new stage is added (`uat`, `staging`), both have to be updated in lock-step. Should be one helper.

**D4. The regex `^\/dev|^\/prod` is ambiguous**

`^` only binds to the first alternative. The regex matches `^\/dev` OR `\/prod` (anywhere). Works today because nothing else in our paths has `/prod`, but fragile. Should be `^(?:\/dev|\/prod)`.

**D5. Signature path allowlist is duplicated** ([handler.ts:128-132](src/handler.ts#L128))

```typescript
const TWILIO_PATHS = new Set([
  '/voice/inbound', '/voice/respond',
  '/voice/sms-inbound', '/voice/status',
  '/voice/recording-status',
]);
```

If you add a Twilio path later, you have to remember to add it here too. The list of paths is also implicit in the route dispatch below it. Two places to keep in sync.

**D6. `parseBody` is JSON-only despite being used for form-encoded webhook bodies**

[auth.ts:169](src/auth.ts#L169) does `JSON.parse(raw)`. For the form-encoded webhook path it returns null. The downstream code happens to not need it because `voiceBody` is separately parsed — but a new dev adding a route could easily reach for `body` thinking it's parsed and get null.

### Spaghetti / dead code

**S1. The 5 imported voice routes on VoiceHttpApi are managed entirely outside this code**

`POST /voice/inbound`, `/respond`, `/sms-inbound`, `/status`, `GET /voice/outbound-twiml` — all hit `ApiFunction` (chat-agent-api-dev Lambda) via the imported `VoiceLambdaIntegration` on `VoiceHttpApi`. The handler dispatches them correctly. No actual code duplication, but there's a subtle dependency: if someone deletes the explicit routes I added today (`VoiceRouteSmsInbound` etc), the imported ones from Phase 2 keep the path alive — silent state. Worth documenting in the template.

**S2. `NOVA_SONIC_*` env vars are set but never read this call** (because body parse failed → toPhone empty → routing skipped)

This is the latent state issue: when the body bug is fixed, `NOVA_SONIC_ENABLED_NUMBERS=+15806336937` and `NOVA_SONIC_STREAM_URL=wss://nova-sonic.wubba.ai/stream` immediately take effect and route the next call to the bridge. That's intended, but you should know that fixing B1 alone will move the failure mode from "Application error" to "whatever the bridge does or doesn't do" — possibly more `// VERIFY:` debugging on the Sonic event envelope.

**S3. The voice bridge's `transferToHuman` action expects `callSid` in context**

The bridge's tool dispatch ([nova-sonic-bridge/src/session.ts](nova-sonic-bridge/src/session.ts)) passes the Twilio CallSid through. But if the bridge itself fails to parse the start frame from Twilio, the CallSid never makes it through. Worth a parallel review of `twilio-stream.ts` to make sure the JSON Twilio sends on stream connect matches what we parse. (This is independent of B1 — separate parser.)

**S4. Several env vars on the Lambda are stale or duplicated**

A quick `aws lambda get-function-configuration --function-name chat-agent-api-dev` shows 44 env vars. Some that may not be needed anymore: `SNOWFLAKE_*`, `FRONTEND_URL`, `ALLOWED_ORIGINS`. None broken; just clutter.

**S5. The handler.ts dispatcher uses dynamic `import()` for routes/voice and twilio-signature**

```typescript
const { handleInboundCall, ... } = await import('./routes/voice');
```

Dynamic imports are good for cold-start optimization but bad for stack traces (they don't appear until first call). For a path that's called every webhook, the cold-start benefit is dubious. Could be a static import without measurable impact.

### What was the right call vs over-engineering

**Right calls** in this session:
- TCPA STOP/START handling, SMS opt-out — clean and necessary
- voice-tool-registry as a separate service so the bridge can call it via HTTP
- Importing the drift (the stack was actually broken; that needed fixing)
- The basic shape of nova-sonic-bridge — Fargate is genuinely the right architecture

**Over-engineered or premature** this session:
- Twilio signature validation — added too early; we'd been disabling it most of the day. Should have shipped with `disabled` baseline and turned on after rest of the path was stable
- Recording pipeline (Twilio → S3 → Transcribe → EventBridge → re-analyze) — five moving parts before we'd seen a single end-to-end call succeed
- CloudWatch EMF metrics — added value once the system works, but added complexity to a system that wasn't yet working
- Nova Sonic 2 bridge deploy — needed Sonic-routing to work end-to-end via TwiML first to validate the architecture, then layer streaming. We did them in the wrong order.

## Recommended sequence to actually get a call working

1. **Fix B1 (body parse) + B2 (graceful empty-callSid hangup) + R1 (defensive event-shape check)** — 3 changes, ~20 lines total. Deploy. Test inbound call.
2. **At that point** the call hits handleInboundCall with real From/To/CallSid. If `+15806336937` is in NOVA_SONIC_ENABLED_NUMBERS, it returns Stream TwiML and Twilio opens a WebSocket to the bridge. We hit the `// VERIFY:` markers in nova-sonic-client.ts — that's the next debug iteration.
3. **Don't fix anything else** until step 2 is producing audio. Then we layer signature validation, recording, analytics back in one at a time.

## What I'd suggest leaving alone for now

- The drift remediation (Phases 1–3) is sound. Stack is clean. Don't touch.
- The Nova Sonic 2 Fargate stack is up and the bridge is responding to health checks. Don't redeploy it during voice-path debugging — separate variable.
- The SMS path (intent classifier + emergency escalation) — entirely separate from voice; not affected by these bugs.
- Tests — 321 passing across both projects. Don't break them while fixing the body parser. Add tests for `isBase64Encoded` decoding at the same time.

## Recommended cleanup after the call works

1. Extract `handleVoiceDispatch(event): Promise<APIGatewayProxyResultV2>` and move all the /voice/ logic out of handler.ts into a focused file
2. Have one `parseWebhookEvent(event)` helper that handles base64 + content-type detection for all routes (form + JSON)
3. Single stage helper: `getStage(event): { stage, rawPath, baseUrl }`
4. Replace the TWILIO_PATHS allowlist with a per-route flag: each route declares whether it's a Twilio webhook
5. Remove stale env vars from the Lambda config
