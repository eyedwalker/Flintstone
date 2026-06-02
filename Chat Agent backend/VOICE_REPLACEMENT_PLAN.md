# Voice — Replacement Plan

**Date**: 2026-06-02
**Context**: After weeks of chasing bugs across three different voice stacks (Timeline routes, `prc.wubba.ai`, Nova Sonic 2 Fargate bridge), nothing works end-to-end. The user is frustrated and rightly wants a clean replacement, not more patching. This document is the single rip-and-replace plan.

## Plan in one paragraph

**Throw away the Nova Sonic 2 Fargate bridge. Stop using `prc.wubba.ai` for new voice work. Make `chat-agent-api-dev` Lambda the sole voice endpoint, using Twilio TwiML with Polly Neural voices and proper Gather-based barge-in. Wire `sendSms` into the model's toolset. Use a SINGLE voice configuration end-to-end. This works today, end-to-end testable, no streaming infrastructure required. If you still want bidirectional Nova Sonic 2 later, it goes on top of this stable base — not before it.**

This is not the most exciting plan. It is the plan most likely to give you a working voice this week.

## Why this approach, not Nova Sonic 2

I've spent a lot of time trying to make Nova Sonic 2 work and it hasn't. The honest reason is that the streaming-bridge path requires SIX things to all be right simultaneously — Twilio Media Streams protocol, ALB HTTP/1.1 negotiation, Bedrock bidirectional API event envelopes, Fargate networking, WSS subprotocol acceptance, and our own state-machine logic. Each one is fixable. Together, they're a debugging hellscape with no good fault isolation. Every "duration: 0" hangup could be any of six things, and I can't tell which from logs alone because the call dies before our code even starts logging.

The TwiML + Polly path has a SINGLE moving part — an HTTP webhook returning XML. We've debugged the body-parsing bug. We've added barge-in. We have `sendSms` as a tool. **We just haven't wired your end-to-end flow to use it cleanly because there were too many parallel systems.** Clean that up and you have a working voice system this week.

Nova Sonic 2 stays as a Phase 2 — when you want to try it again, we know exactly what's there and what's needed. But it stops blocking the primary work.

## Concrete scope of "rip it out"

### What we delete or stop using

| Thing | Action | Why |
|---|---|---|
| `nova-sonic-bridge-dev` CloudFormation stack | **Delete** | Doesn't work, costs ~$35/mo |
| `nova-sonic-bridge` ECR repo + image | Delete | Won't be used |
| `nova-sonic.wubba.ai` Route 53 record + ACM cert | Delete | Won't be used |
| `nova-sonic-bridge` CodeBuild project + S3 bucket | Delete | Won't be used |
| `nova-sonic-bridge` subproject in this repo | **Keep in git, mark dormant** | Reference for Phase 2 |
| `NOVA_SONIC_*` env vars on chat-agent Lambda | Unset | No longer routes through bridge |
| `prc.wubba.ai/api/voice/*` routes | Stop using; don't delete | Not our code; just don't send Twilio there |
| Twilio webhook on `+15806336937` | **Point at chat-agent for both voice + SMS** | Single endpoint, no app/Lambda split |
| Outbound calls from the app | Migrate to call our `POST /voice/outbound` | Single endpoint owns the entire call lifecycle |

### What we keep and use

| Thing | Why |
|---|---|
| `chat-agent-api-dev` Lambda | The endpoint that handles every voice webhook |
| TwiML builders in [voice-twiml.ts](src/services/voice-twiml.ts) | Has barge-in via Say-inside-Gather, hints, enhanced recognition |
| Conversation engine in [conversation-engine.ts](src/services/conversation-engine.ts) | Has `sendSms`, `bookAppointment`, etc. as tools |
| SMS opt-out + intent classifier + emergency escalation | Works well, separate from voice debugging |
| Voice call log + call analyzer | Same code works for TwiML-only calls |
| DynamoDB tables (all 28, now stack-managed) | Hold real data |
| Cognito user pool, IAM, KMS, etc. | Not touched by voice rework |
| Twilio account, phone number, SSM-stored credentials | Same telephony, no porting |

## Phase 0 — Decide and clean up (this session)

These are all reversible local changes:

1. **Approve this plan** (you, decide; doc gets committed regardless of approval as a discussion artifact)
2. **Delete the Nova Sonic infrastructure** in this order:
   - `aws cloudformation delete-stack --stack-name nova-sonic-bridge-dev`
   - Delete ECR images, then the repo
   - Delete the Route 53 alias for `nova-sonic.wubba.ai`
   - Delete the ACM cert (it's free; deleting it is housekeeping)
   - Delete the CodeBuild project + S3 source bucket
   - Unset `NOVA_SONIC_*` env vars on `chat-agent-api-dev`
   - Remove `NovaSonic*` SAM parameters from `template.yaml` (or keep with empty defaults for forward-compatibility)
3. **Restore (or confirm) the Twilio webhook on `+15806336937`** to the desired single endpoint. New target: `https://v1k97uw533.execute-api.us-west-2.amazonaws.com/dev/voice/inbound`. SMS webhook to: `https://v1k97uw533.../dev/voice/sms-inbound`. The `prc.wubba.ai` webhooks STAY in Twilio config for any other numbers but `+15806336937` becomes our number end-to-end.

Estimated time: 30 min.

## Phase 1 — Inbound voice on Polly Neural with barge-in, sendSms, consistent voice

The infrastructure is already there. What we change is configuration and a couple of small bugs:

1. **Lock the voice config to a single Polly Neural voice** for the entire conversation:
   - Default: `Polly.Joanna-Neural` (warm female, US English) — but **make it tenant-configurable** via a new `voiceName` field on the tenant DDB record (we already have `getOfficePhone` patterned for this)
   - Same voice for greeting AND for every conversation turn — fixes "another voice comes on"
2. **Verify barge-in actually works** by ensuring every Say is nested inside a Gather (currently true in `buildGreetingTwiml` and `buildGatherTwiml`). Add `bargeIn="true"` to the Say tag for belt-and-suspenders.
3. **Test that `sendSms` is in the model's tool list** for voice calls (currently true in `buildToolDefinitions`). When the user says "text me directions to your office," the model should pick the tool, get the office address via `getOffices`, and send an SMS to `fromPhone`.
4. **Tighten the system prompt** so the model knows it can send SMS during the call — currently the prompt has booking-flow guidance but doesn't explicitly mention "you can text the caller directions / confirmation / etc."
5. **Single end-to-end test**: dial `+15806336937`, ask three things — "what are your hours," "what offices do you have," "text me directions to the [closest one]." Verify same voice throughout, interrupt-mid-sentence works, SMS lands on your phone.

Estimated time: 1–2 hours implementation + testing.

## Phase 2 — Outbound voice through OUR endpoint

The app currently calls Twilio API directly with `prc.wubba.ai` TwiML. We change this:

1. **Find the app code** that places outbound calls. We've confirmed it's either AI Assistant Helper or another Encompass component — needs locating.
2. **Replace its Twilio call with a `POST` to** `https://v1k97uw533.../dev/voice/outbound` with body `{ to, message?, useStreaming: false, goal? }`. Our `handleOutboundCall` already exists and uses `integrations.makeCall` which inlines TwiML with `Polly.Joanna-Neural` (assuming we update the default voice as part of Phase 1).
3. **Migrate the appointment reminder flow** to use this. The reminder copy becomes the `goal` parameter; our system prompt frames the call appropriately (the prompt builder already has outbound framing).
4. **Test**: trigger a reminder. Same single voice, barge-in works, the model can text the caller.

Estimated time: 2–4 hours depending on where the app code lives + access.

## Phase 3 — Nova Sonic 2 (only after Phases 1+2 are stable)

When you have a working voice system AND want to upgrade the experience:

1. **Don't rebuild the Fargate bridge ourselves.** Wait for one of two things to mature:
   - **Twilio ConversationRelay** with Bedrock Nova Sonic 2 support — Twilio's managed bidirectional product. Would let Sonic 2 work via HTTP webhooks, no WebSocket infrastructure on our side. Check Twilio's release notes monthly.
   - **An AWS-published reference architecture** for Nova Sonic 2 + Twilio Media Streams. AWS will eventually publish one; we wait.
2. **Alternatively**: spin up a SignalWire test number and the parallel-test approach from the previous plan. Cheaper than full Twilio replacement; could prove the bridge code works with a different telephony provider.
3. **Or accept that streaming-Sonic 2 isn't the right next investment** — the TwiML+Polly experience after Phase 1 may be good enough, especially after barge-in and consistent-voice fixes.

No timeline. Trigger when you want it.

## What I will NOT do this round

To avoid the spaghetti that got us here:

- **No new infrastructure** without proving the existing path doesn't suffice
- **No multi-stack architectures** — one Lambda, one HttpApi, one phone number, one voice
- **No "what if we ALSO supported..."** — every additional path doubles the bug surface
- **No changes to `prc.wubba.ai`** — we don't own that code; we just stop sending traffic to it
- **No partial deploys** — every change runs through `npm run build && sam build && update-function-code` and is verified with a grep against the deployed `dist/`. I will not claim something is deployed without grepping the actual bytes in S3 or the function code download.

## Single ask before I touch anything

Three concrete decisions I need from you. I'm not going to ask four options; pick what you want for each:

1. **Delete the Fargate bridge today?** Yes / No / Leave for now
2. **Confirm `+15806336937` is OK to be our owned-end-to-end number** (currently is for voice; SMS still points to `prc.wubba.ai`). Yes / No / Use a different number
3. **Where is the app code that places outbound reminder calls?** Pointer to the repo + file, or "I'll get this to you"

When I have those answers, I'll execute Phase 0 + Phase 1 in one session — no fragmented patches. We'll test on a real call before declaring Phase 1 done.

## What gets committed regardless of approval

This plan. So we have a record of the decision and the rationale.
