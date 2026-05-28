# Booking Gap Analysis — Why SMS works but Voice + Chat don't

**Date**: 2026-05-28
**Symptom**: Appointment booking succeeds when initiated by SMS, fails when initiated by voice or by the chat widget.

## The three channels use two completely different code paths

```
                 ┌─────────────────────────────────────────────┐
   SMS   ────▶   │ conversationEngine.processMessage()         │  ✅ works
   Voice ────▶   │   (channel-agnostic, local tool surface)    │  ❌ fails
                 │   src/services/conversation-engine.ts       │
                 └─────────────────────────────────────────────┘

                 ┌─────────────────────────────────────────────┐
   Chat  ────▶   │ bedrockChat.invokeAgent()                   │  ❌ fails
                 │   (Bedrock Agents, OpenAPI action group)    │
                 │   src/services/bedrock-chat.ts              │
                 └─────────────────────────────────────────────┘
```

SMS and voice share an engine. Chat is a completely separate system. The reasons each fails are different.

## Why SMS works

[handleSmsInbound](src/routes/voice.ts) calls `conversationEngine.processMessage(sessionId, messageBody, tenantId, 'sms', fromPhone, ...)`. Inside the engine:

- `bookAppointment` is in [buildToolDefinitions](src/services/conversation-engine.ts) with this schema:
  ```js
  required: ['officeId', 'providerId', 'date', 'time']
  ```
- Claude Haiku decides to call the tool, [executeLocalTool](src/services/conversation-engine.ts) dispatches to [integrations.bookAppointment](src/services/integrations.ts) which hits the live Eyefinity API
- `DEFAULT_TENANT_ID` is hardcoded → Eyefinity OAuth creds load correctly from SSM

SMS works **because text input is precise**: the patient types "Tuesday June 3rd at 2pm" and the model parses it cleanly into the required args.

## Why voice fails

Same code path as SMS — same tool definitions, same Claude model. So why does it fail? Three compounding reasons:

### 1. Speech-to-text mangles the booking parameters

Twilio's STT (even with `enhanced="true"` we added today) routinely produces:
- "Tuesdee" instead of "Tuesday"
- "Doctor smith" instead of "Dr. Smith"
- "Two PM" instead of "2:00 PM"
- "May 28th" instead of "2026-05-28"

The model has to normalize these to canonical forms (officeId, providerId, ISO date, HH:MM time). When STT is ambiguous, the model asks again — and the conversation drifts before it actually gets to call `bookAppointment`.

### 2. The system prompt actively discourages multi-step booking

[buildSystemPrompt](src/services/conversation-engine.ts) has:
```
CRITICAL VOICE RULES:
- Keep responses SHORT — 2-3 sentences maximum, under 15 seconds when spoken.
- Output ONLY the words to be spoken.
```
The prompt is voice-tuned but applied to **all channels** (no branching on `session.channel`). Over voice, the model is being told "be brief" while the booking tool description says "Always confirm details with the patient first." Booking by voice typically takes 5–6 turns (which office? which doctor? which day? what time? confirm? book) — and the "be brief" instruction pushes the model toward shortcutting that confirmation step.

### 3. `max_tokens: 200` truncates booking-result confirmations

[callClaude](src/services/conversation-engine.ts) sets `max_tokens: 200`. After `bookAppointment` returns a confirmation payload, the follow-up Claude call has to summarize it back to the caller — and 200 tokens is borderline for "Got it, you're booked Tuesday June 3rd at 2pm with Dr. Smith at Main office. Confirmation number ABC123. Anything else?". The model often truncates mid-sentence, and the caller hears half a confirmation.

### 4. `shouldEndCall` heuristic ends the call early

[shouldEndCall](src/services/conversation-engine.ts) checks for phrases like `"i'm good"`, `"thanks"`, `"that's all"`. If the caller says "Tuesday is good for me" mid-booking, the substring `"is good"` ≠ `"i'm good"` so this is safe — but `"thanks"` mid-flow ("Thanks, two PM works") could match `'thanks bye'` (no — needs the "bye"). Actually the current phrases are reasonably scoped, but worth verifying with real call transcripts.

### 5. Twilio Gather timeout interleaves with model latency

If Claude takes >5s to respond (with tool calls it can), Twilio's Gather expires → the call falls through to the "Are you still there?" fallback → the user thinks the bot died → they hang up. The booking conversation never completes.

## Why chat fails — totally different reasons

Chat uses **Bedrock Agents**, not the conversation engine. The booking path is:

```
widget → handleWidgetChat (route)
  → bedrockChat.invokeAgent(agentId, ..., job.tenantId)
    → AWS Bedrock Agent (e.g. Front-Office-Assistant, IYVTI2D2VJ)
       → action group "front-office-actions" (PWXTCNWLPH)
          OpenAPI schema includes POST /bookAppointment ✓
          executor: arn:aws:lambda:us-west-2:780457123717:function:chat-agent-api-dev
             → handler.ts detects actionGroup event
                → handleActionGroup (front-office-actions.ts)
                   → handleBookAppointment
                      → integrations.bookAppointment (same as SMS)
                         → Eyefinity API
```

The booking pipe is intact. The OpenAPI schema includes `bookAppointment`. The action group's Lambda points at the right function. tenantId flows through `sessionAttributes`. **So what breaks?**

### Most likely cause: the chat widget isn't routed to `Front-Office-Assistant`

[Live Bedrock agents in this account](https://console.aws.amazon.com/bedrock):
- Analytics-Agent
- Encompass-Larry
- **Front-Office-Assistant** ← has bookAppointment
- Jira-Assistant
- Support-Escalation

The widget calls `invokeAgent(agentId, ...)` where `agentId` defaults to `job.agentId` from the assistant record's `bedrockAgentId`. **If that assistant points at a different agent (Encompass-Larry, Analytics-Agent, etc.), bookAppointment isn't in scope and chat will never book.**

There's an orchestrator that can re-route to Front-Office-Assistant on intent — but only when the tenant has `useOrchestrator: true` set. Without that flag, chat is stuck with whichever agent the widget assistant defaults to.

**To verify**: in DynamoDB `chat-agent-assistants-dev`, find the assistant the widget uses, check its `bedrockAgentId`. If it's not `IYVTI2D2VJ`, that's the bug.

### Secondary cause: stale Lambda code

The CloudFormation stack last deployed 2026-03-17. The Lambda function code (`chat-agent-api-dev`) was directly updated 2026-05-08 via some non-SAM path. So:
- Pre-May-8 fixes: deployed
- Post-May-8 fixes (notably commit `46df425` "FIX: chat agent slot search returns empty for 'any provider'" landed 2026-05-26): **NOT deployed**

If the chat user picks "any provider" when asked, `getAvailableSlots` returns empty (the pre-fix bug), the model can't pick a slot, booking never happens. This affects chat the same way it would affect voice/SMS — but the user reports voice/SMS work and chat doesn't, so this isn't the primary cause for the chat-vs-SMS gap. (It WILL be a bug for everyone once you fix the booking flow and start using "any provider" in production.)

### Tertiary cause: action group event-shape mismatch (unlikely but possible)

The TypeScript interface for the action group event in [front-office-actions.ts:39-42](src/services/front-office-actions.ts) declares:
```ts
requestBody?: {
  content: {
    'application/json': { body: string };
  };
};
```
But the handler reads `event.requestBody?.content?.['application/json']?.properties` (note: `properties`, not `body`). The runtime shape Bedrock actually sends is the `properties` form (an array of `{ name, value }` pairs), so the code works — but the type lies. If a Bedrock update ever changed the shape, this would break silently with empty params and "officeId required" errors in the response. Worth fixing the interface to match runtime.

## How to confirm each hypothesis (fastest first)

**For chat (10 minutes):**
1. In the widget, ask the bot to book an appointment.
2. CloudWatch Logs → `/aws/lambda/chat-agent-api-dev` → search recent logs for `[FrontOffice]` lines. If you see `[FrontOffice] front-office-actions/bookAppointment` → the action group IS being called; check the response. If you DON'T → the agent isn't routing to Front-Office-Assistant.
3. If routing is wrong: `aws dynamodb get-item --table-name chat-agent-assistants-dev --key '{"id":{"S":"<the assistant id>"}}'` — check `bedrockAgentId` field. Set it to `IYVTI2D2VJ` for booking-capable chat.

**For voice (15 minutes):**
1. Make a test call, ask to book an appointment.
2. CloudWatch Logs → `/aws/lambda/chat-agent-api-dev` → look for `[ConversationEngine] Tool call:` lines. If `bookAppointment` appears → the model IS calling the tool over voice; check why the confirmation doesn't reach the caller (max_tokens / Gather timeout / shouldEndCall). If it never appears → the model is getting stuck before deciding to call the tool (STT issues / prompt issues).
3. Repeat 5–6 times — the variance between calls is itself diagnostic.

## Recommended fixes (in dependency order)

### Quick wins (no deploy required)
None. Everything below needs the Lambda updated, which is blocked by the [stack drift](STACK_DRIFT_ANALYSIS.md).

### Once the deploy path is unblocked

**1. Channel-aware system prompt** (~10 lines change in conversation-engine.ts):
- Don't apply "CRITICAL VOICE RULES" to SMS or email
- SMS responses can be longer and more detailed
- Voice keeps the brevity rule but loosens for tool-confirmation responses

**2. Raise `max_tokens` for voice tool-result responses** (~3 lines):
- 200 is fine for question-answering
- After a `bookAppointment` tool_result, bump to 400 for the follow-up call so confirmation isn't truncated

**3. Force the orchestrator (or default to Front-Office-Assistant) for chat**:
- Either set `useOrchestrator: true` on the default tenant
- Or set the default widget assistant's `bedrockAgentId` to `IYVTI2D2VJ`
- Test path: open widget → "I want to book an appointment" → look for action group invocation in logs

**4. Fix the TypeScript interface for action group events** (~5 lines, [front-office-actions.ts](src/services/front-office-actions.ts)):
- Change `body: string` to `properties: Array<{ name: string; value: string }>` so the type matches runtime
- Prevents silent bugs if the event shape ever changes again

**5. Add booking-flow-specific instructions to the system prompt**:
- "When booking: ask for office, then provider (or 'any'), then date, then preferred time"
- "After confirming details, call bookAppointment and read back the confirmation"
- This shortens variance across voice calls

**6. Add an end-to-end booking test for each channel**:
- Voice: call the test number, follow the booking flow, verify the appointment lands in Eyefinity
- SMS: text booking dialog, verify
- Chat: same in the widget
- Each becomes a smoke test for the deploy verifier

## What about the stack drift?

This analysis assumes [STACK_DRIFT_ANALYSIS.md](STACK_DRIFT_ANALYSIS.md) gets resolved so deploys can happen. Without that:
- The Lambda code can still be updated directly (`aws lambda update-function-code`) — that's how it got to 2026-05-08
- But new IAM permissions, new env vars, new EventBridge rules, new API Gateway routes need CloudFormation

For the booking-flow fixes above: items #1, #2, #4, #5 are pure code changes that ship via direct Lambda update. #3 is an AWS console / DynamoDB tweak. #6 is testing.

So the booking gap is fixable **even without resolving the stack drift first** — just by direct Lambda update.
