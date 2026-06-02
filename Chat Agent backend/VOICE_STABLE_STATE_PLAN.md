# Voice — Stable State Plan

**Date**: 2026-06-02
**Purpose**: Map every voice path currently running, what works, what's broken, and a recommended sequence of decisions — including the option to swap Twilio for SignalWire.

## 1. What is currently running (verified from logs + Twilio API + AWS state)

There are **two independent voice systems** on the same phone numbers today.

### System A — the app's stack (`prc.wubba.ai`)

- **Source**: not in this repo. The Timeline repo references `/api/voice/*` paths but `api/voice/` is empty locally. The AI Assistant Helper Next.js app has `TwilioVoiceAccessor.ts` and `CommunicationManager.ts` but its production endpoints are deployed elsewhere — probably AWS Amplify or a separate service. `nslookup prc.wubba.ai` → `100.23.14.116` (AWS-hosted IP).
- **Triggers**: anywhere the UI invokes "Call me with a reminder" — outbound. Inbound is also routed here historically.
- **What runs during a call** (inferred from observed symptoms):
  - Initial Say uses Twilio's built-in `voice="alice"` (per AI Assistant Helper `CommunicationManager.ts:166`)
  - Follow-up turns hit `/api/voice/ai-call-response` which appears to use Polly or ElevenLabs with a different voice config (hence "another voice comes on")
  - No barge-in: the Say is not nested inside a `<Gather>`
  - Cannot text the caller mid-call: the conversation engine in this stack hasn't wired `sendSms` as a callable tool
- **Telephony**: Twilio
- **Verified state today**: working — your 21:26 test call ran for 40 seconds with conversation

### System B — chat-agent + Nova Sonic 2 bridge (what we built)

- **Source**: this repo, deployed via SAM + CloudFormation. Stack: `chat-agent` (Lambda + DynamoDB), `nova-sonic-bridge-dev` (Fargate + ALB + ECR).
- **Triggers**: inbound calls to `+15806336937` (we flipped the Twilio webhook to point at our chat-agent-voice API earlier today). Also exposes `POST /voice/outbound` for outbound originating from our system.
- **What runs during an inbound call**:
  1. Twilio → `https://v1k97uw533.execute-api.us-west-2.amazonaws.com/dev/voice/inbound`
  2. Lambda handler → `handleInboundCall(voiceBody, baseUrl)`
  3. `isStreamingNumber("+15806336937")` returns true → returns `<Connect><Stream url="wss://nova-sonic.wubba.ai/stream?tenantId=...&direction=inbound">` TwiML
  4. Twilio opens WebSocket to `wss://nova-sonic.wubba.ai/stream`
  5. Fargate task accepts upgrade → opens Bedrock `amazon.nova-2-sonic-v1:0` bidirectional stream
  6. Audio bridged both directions; tool calls go back to `/voice/tool-execute`
- **Telephony**: Twilio (same number)
- **Verified state today**:
  - Step 1–3 ✅ working (Lambda logs confirm correct From/To/CallSid and Stream TwiML returned)
  - Step 4 ❌ failing — Twilio's WebSocket never reaches Fargate. **Call duration: 0 seconds, status: completed.** Multiple attempts.
  - HTTP/2 disabled on ALB earlier today (was the most likely candidate); call 2 STILL failed at 0s after that, so HTTP/2 wasn't the only issue.

## 2. What we know is wrong

### B1 — Twilio Media Streams → Fargate WS not connecting

After three attempts with logging and config changes, the WebSocket from Twilio's media-streams client never produces a `[Server] Accepted WSS upgrade` or `[Session] Stream started` log line in the Fargate task. Every inbound test ends with `duration: 0`.

**Possible causes (not yet ruled out)**:
- **Twilio's media-streams subprotocol** — Twilio may negotiate `Sec-WebSocket-Protocol: audio` (or similar). Our `ws` server accepts any subprotocol by default but maybe it's being rejected upstream.
- **ALB doesn't honor the WSS upgrade for non-browser clients** despite HTTP/2 being disabled. ALB v2 supports WebSockets but only under specific listener+target-group config; protocol nuances could be at play.
- **Cert chain compatibility** — ACM-issued certs are RSA 2048 by default. Twilio's TLS client may require a specific chain. Unlikely but possible.
- **Twilio not resolving DNS for `nova-sonic.wubba.ai`** — Route 53 record exists but external DNS propagation can lag. Worth verifying from Twilio's diagnostic endpoint.
- **Bridge code rejects valid Twilio frames** — our `twilio-stream.ts` parser expects specific JSON event names (`start`, `media`, `mark`, `stop`, `dtmf`). If Twilio sends an event we don't handle as the first frame, the server might just drop the connection.

### B2 — App's outbound calls go through `prc.wubba.ai`, not our stack

This is by design (we never wired the app to use our `/voice/outbound`), but the symptoms you described — "no barge-in", "voice changes mid-call", "can't text directions" — all live in code we don't own/see.

### B3 — The `prc.wubba.ai` voice code isn't in our local checkout

We can't read the source. Server `100.23.14.116` runs Express, accepts POSTs, returns TwiML. To fix the system A symptoms we either:
- Find the source repo and patch
- Replace the deployment with ours
- Route the app to our `/voice/outbound` instead

## 3. Option: swap Twilio for SignalWire

SignalWire is API-compatible with Twilio: same TwiML, similar REST API, same `<Connect><Stream>` verb. **You have a SignalWire account; this is on the table.**

### What swapping helps

- **Diagnostic value**: if the WSS-from-Twilio issue is in Twilio's media-streams client specifically (subprotocol, framing, cert preferences), SignalWire's client might just work and confirm the issue is upstream of our code
- **Stated original design**: the nova-sonic-bridge README I built earlier explicitly mentioned SignalWire as the intended telephony — the bridge code was sketched against SignalWire's stream protocol, which is identical to Twilio's in spec but can differ in practice
- **Potential cost**: SignalWire's media-streams pricing is reported lower than Twilio's

### What swapping doesn't help

- **System A still runs on `prc.wubba.ai`** with Twilio. Swapping won't change "alice voice + no barge-in + can't text" unless you also move the app's outbound flow to a SignalWire-aware stack
- **Number porting**: keeping `+15806336937` means a SignalWire port-in (days), or use a fresh SignalWire number for testing
- **Our Twilio integrations** (`integrations.makeCall`, `redirectCallToOffice`, recording-status webhooks, etc.) all assume Twilio. We'd need a thin abstraction or a separate code path for SignalWire

### Recommendation on the swap

**Use SignalWire as a parallel test number first, NOT as a full swap.**

Get a SignalWire number, configure its voice webhook to our `/voice/inbound`, set `NOVA_SONIC_ENABLED_NUMBERS=<signalwire-number>`, and try calling THAT. If it lands cleanly in Fargate logs, we've isolated the problem to Twilio's media-streams client and can plan a real migration. If it ALSO fails at 0s, the problem is in our bridge code or ALB, and we keep debugging there.

This is ~30 minutes of setup with no commitment.

## 4. Decision matrix

| Path | Effort | Risk | What it fixes |
|---|---|---|---|
| **A. Continue debugging Twilio-WSS-to-Fargate** with packet capture + ALB access logs + `ws` server debug | 1–3 hrs | Could hit unfix­able Twilio quirk | Sonic 2 inbound works |
| **B. Try SignalWire as a parallel test number** | ~30 min setup + a few tests | Low | Isolates whether the issue is Twilio-specific |
| **C. Find prc.wubba.ai source + patch its TwiML** to add barge-in, sendSms tool, consistent voice | Unknown (source location) | Med — touching live production | Fixes system A symptoms without Sonic 2 |
| **D. Modify the app to call our `/voice/outbound` with `useStreaming: true`** | ~1–2 hrs of app code | Low if app source is accessible | App outbounds get Sonic 2 once bridge works |
| **E. Build a Twilio-style ConversationRelay path** (Twilio's managed bidirectional, no Fargate) | Days | Med — depends on Twilio's Bedrock support | Sonic 2 outbound + inbound on serverless, no WS infra |
| **F. Step back and stay on the working TwiML+Polly stack**, fix the three bugs there | ~half day | Low | Today's UX issues fixed, no Sonic 2 |

## 5. Recommended sequence

If your goal is **getting voice quality to where you want it as fast as possible**:

1. **B (SignalWire test, 30 min)** — fastest signal on whether Twilio is the blocker
2. Branch on the result:
   - **If SignalWire's WS connects to the bridge** → we have a working Sonic 2 path. Continue with SignalWire for the new flow; document the Twilio quirk; plan whether to port `+15806336937` to SignalWire long-term
   - **If SignalWire ALSO fails at duration=0** → the bridge code or ALB has a real bug. Switch to A (deep WS debug)
3. Whatever the answer to (2), **C in parallel** — fix the existing app's voice flow (find prc.wubba.ai source, patch the three bugs) so the production user experience improves immediately
4. **D once bridge is proven** — wire the app to call our `/voice/outbound` for new reminders

If your goal is **stop spending time on Sonic 2 right now**, do F: leave the bridge running (~$35/mo idle) and focus on C. Come back to Sonic 2 when SignalWire is in place.

## 6. Open questions to answer before proceeding

- **Where is the `prc.wubba.ai` source repo?** (Vercel project? Separate GitHub repo? In a private branch?)
- **Who else uses `+15806336937` for production calls?** Flipping its Twilio webhook to chat-agent-voice may have already affected production users
- **Was the duration-0 inbound call (21:29 today) made after the HTTP/2 fix landed?** Check timestamps; if before, we haven't actually tested the HTTP/2 fix yet
- **Do you want to maintain Twilio + SignalWire side-by-side, or eventually consolidate?** Affects whether we build a telephony abstraction layer in the bridge

## 7. What's safe to leave in place while we decide

- **chat-agent stack** — clean, deployed, all drift remediated. Lambda code update from today fixed the body parser. No further changes needed for stability.
- **Nova Sonic bridge Fargate task** — idle but healthy. Costs ~$35/mo until we either prove it works or tear it down.
- **Twilio number `+15806336937` webhook flip** — currently points at our chat-agent-voice API. If you want to revert (so it goes back to prc.wubba.ai while we figure things out), the original URL is saved at `~/.chat-agent-deploys/twilio-15806336937-original-voice-url`. One curl can restore it.
- **`NOVA_SONIC_ENABLED_NUMBERS=+15806336937`** env var on the Lambda — same revert applies. Setting it to empty makes the inbound flow fall back to the old Say/Gather path (not that we want to keep that long-term).

## 8. Sources for this document

- Lambda CloudWatch logs `/aws/lambda/chat-agent-api-dev` 2026-06-02 21:26–21:30 UTC
- Twilio API `/Calls` + `/Calls/{SID}/Events.json` for both calls
- Fargate CloudWatch logs `/ecs/nova-sonic-dev` (notably empty for the inbound test)
- ALB attributes, ECS service state, ECR repo, ACM cert all verified live
- Files reviewed: [src/handler.ts](src/handler.ts), [src/routes/voice.ts](src/routes/voice.ts), [src/services/twilio-signature.ts](src/services/twilio-signature.ts), [nova-sonic-bridge/src/server.ts](nova-sonic-bridge/src/server.ts), [nova-sonic-bridge/src/twilio-stream.ts](nova-sonic-bridge/src/twilio-stream.ts), [nova-sonic-bridge/nova-sonic-fargate.yaml](nova-sonic-bridge/nova-sonic-fargate.yaml)
