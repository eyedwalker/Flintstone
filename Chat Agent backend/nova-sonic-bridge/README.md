# Nova Sonic 2 Bridge

WebSocket service that bridges **Twilio Media Streams** and **Bedrock Nova Sonic 2** bidirectional audio. Replaces the synchronous TwiML `<Say>/<Gather>` flow with low-latency, barge-in-capable streaming voice.

```
PSTN call ─► Twilio number ─► Twilio Media Streams (WSS) ─► this bridge ─► Bedrock Nova Sonic 2
                                                                ▲
                                                                │ HTTP
                                                                ▼
                                                       Chat Agent backend HttpApi
                                                       /voice/tool-execute (tool dispatch)
                                                       /voice/tool-schemas (tool definitions)
```

## Status

**Scaffold — not yet deployed.** Code is structurally complete; the Nova Sonic event-shape branches in `nova-sonic-client.ts` are marked `// VERIFY:` and need to be checked against the live service once model access is granted.

## Layout

```
nova-sonic-bridge/
├── src/
│   ├── server.ts             — HTTP + WebSocket server entry
│   ├── session.ts            — orchestrates one call (Twilio ↔ Sonic)
│   ├── twilio-stream.ts      — Twilio Media Streams protocol handler
│   ├── nova-sonic-client.ts  — Bedrock bidirectional stream client
│   ├── tool-bridge.ts        — HTTP client for /voice/tool-* endpoints
│   ├── prompt.ts             — system prompt builder (personalizes for caller)
│   └── audio.ts              — μ-law 8kHz ↔ PCM 16kHz conversion
├── tests/
│   ├── audio.test.ts          — μ-law/PCM round-trips
│   ├── prompt.test.ts         — system prompt cases
│   └── twilio-stream.test.ts  — Twilio Media Streams protocol
├── Dockerfile                — multi-stage build, non-root runtime
├── nova-sonic-fargate.yaml   — ECS Fargate + ALB CloudFormation
└── README.md                 — this file
```

## What the bridge does on each call

1. **Twilio start** — captures `callSid`, `streamSid`, and `fromPhone` from the start event
2. **Parallel boot** — fetches tool schemas from backend AND looks up the caller's patient record by phone (both must complete before Sonic opens)
3. **Personalized system prompt** — if the caller resolves to a unique patient, the prompt greets them by first name and locks tool scope to their patient id from message 1
4. **Sonic stream open** — `sessionStart` + `promptStart` + system message + audio content block
5. **Audio loop** — caller audio is upsampled 8kHz μ-law → 16kHz PCM and pushed; Sonic audio comes back as 16kHz PCM, downsampled to μ-law, and forwarded to Twilio
6. **Barge-in** — when caller audio arrives while the bot is mid-utterance, the bridge sends Twilio `clear` to drop queued outbound audio so the bot doesn't talk over the caller
7. **Tool calls** — Sonic `tool_use` events POST to `/voice/tool-execute`; result becomes a `toolResult` block on the next turn. Tools that act on the live PSTN call (`transferToHuman`) need `callSid` in context; the bridge always passes it
8. **Transfer to human** — `transferToHuman` calls Twilio's Update Call API with new TwiML that `<Dial>`s the office. Twilio terminates our stream automatically
9. **Session cap** — at `NOVA_SONIC_SESSION_TIMEOUT_S` (default 7:50) the bridge cleans up; Nova's hard cap is ~8:00

## Local dev

```bash
cd nova-sonic-bridge
npm install
npm run build
npm test
```

Run locally (won't actually serve calls without AWS creds + Bedrock access):

```bash
PORT=8080 \
AWS_REGION=us-east-1 \
CHAT_AGENT_BACKEND_URL=https://<your-stage>.execute-api.us-west-2.amazonaws.com \
VOICE_GATEWAY_SERVICE_TOKEN=<token> \
npm run dev
```

## Required env

| Var | Default | Notes |
|---|---|---|
| `PORT` | `8080` | HTTP/WSS listen port |
| `AWS_REGION` | `us-east-1` | Region with Nova Sonic 2 model access |
| `AWS_BEDROCK_NOVA_SONIC_MODEL_ID` | `amazon.nova-2-sonic-v1:0` | Model id |
| `CHAT_AGENT_BACKEND_URL` | _(required)_ | Base URL of the deployed Chat Agent backend HttpApi |
| `VOICE_GATEWAY_SERVICE_TOKEN` | _(required)_ | Bearer for `/voice/tool-*` — must match the SAM `VoiceGatewayServiceToken` parameter |
| `NOVA_SONIC_SESSION_TIMEOUT_S` | `470` | Soft cap (7:50); Nova hard-caps near 8:00 |
| `NOVA_SONIC_DEFAULT_VOICE` | `tiffany` | Sonic voice id |

## Prerequisites

1. **Bedrock model access**: `amazon.nova-2-sonic-v1:0` must be **Granted** in the AWS Bedrock console for the chosen region. Confirm before deploying.
2. **Chat Agent backend** deployed with `VoiceGatewayServiceToken` parameter set (same value as `VOICE_GATEWAY_SERVICE_TOKEN` here).
3. **ACM certificate** for the public HTTPS endpoint Twilio will hit.
4. **VPC + subnets** — two public for the ALB, two private for the Fargate tasks.

## Deploy

```bash
# 1. Build and push the image
aws ecr get-login-password --region us-west-2 | docker login --username AWS --password-stdin <acct>.dkr.ecr.us-west-2.amazonaws.com
docker build -t nova-sonic-bridge .
docker tag nova-sonic-bridge:latest <acct>.dkr.ecr.us-west-2.amazonaws.com/nova-sonic-bridge:latest
docker push <acct>.dkr.ecr.us-west-2.amazonaws.com/nova-sonic-bridge:latest

# 2. Deploy the stack
aws cloudformation deploy \
  --template-file nova-sonic-fargate.yaml \
  --stack-name nova-sonic-bridge-dev \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides \
    VpcId=vpc-... \
    SubnetIds=subnet-pub-a,subnet-pub-b \
    PrivateSubnetIds=subnet-priv-a,subnet-priv-b \
    ContainerImage=<acct>.dkr.ecr.us-west-2.amazonaws.com/nova-sonic-bridge:latest \
    CertificateArn=arn:aws:acm:us-west-2:<acct>:certificate/... \
    ChatAgentBackendUrl=https://<your-stage>.execute-api.us-west-2.amazonaws.com \
    VoiceGatewayServiceToken=<token> \
    BedrockRegion=us-east-1
```

## Wire the Twilio number

Point the number's voice webhook at a URL that returns:

```xml
<Response>
  <Connect>
    <Stream url="wss://nova-sonic.example.com/stream?tenantId=<TENANT_ID>">
      <Parameter name="fromPhone" value="{{ From }}" />
    </Stream>
  </Connect>
</Response>
```

The existing `POST /voice/inbound` route in Chat Agent backend can serve this — add a feature-flag check to return Stream TwiML for migrated numbers and the existing Say/Gather TwiML for everything else. Roll one number at a time.

## Verify (after deploy)

1. **Health**: `curl https://nova-sonic.example.com/health` → `{"status":"ok"}`
2. **Tool fetch**: from the running container, hit `/voice/tool-schemas` with the bearer — should return the same schemas as a local call.
3. **Live call**: dial the test number; expect:
   - First audio in <500ms
   - Barge-in works (interrupt the bot mid-sentence; it stops)
   - Ask for an appointment lookup → tool_use → tool_result → speak result
4. **8-min cap**: stage a 9-min call; bridge should cleanly close at 7:50.

## Known gaps in this scaffold

- **`// VERIFY:` markers in `nova-sonic-client.ts`** — Nova Sonic 2's exact JSON event envelope may differ from the scaffolded shape. After getting model access, capture a real session and reconcile.
- **No call recording** — Twilio Media Streams audio can be saved to S3 in parallel; not wired here.
- **No DTMF handling** — Twilio Media Streams sends `dtmf` events separately; currently dropped. Add handling once a use case appears.
- **Single-region** — Bridge and Bedrock should live in the same region for latency. If Sonic is `us-east-1` and the rest of the stack is `us-west-2`, accept the cross-region call (~50ms) or move the backend.
- **No cost/latency telemetry** — emit CloudWatch metrics per session: total minutes, tokens, tool calls, p50/p99 first-audio latency.

## Cost (rough)

| Component | Per-minute |
|---|---|
| Twilio Media Streams | $0.004 |
| Bedrock Nova Sonic 2 | $0.017 |
| Fargate (0.5 vCPU, 1GB, prorated) | ~$0.0004 |
| **Total** | **~$0.021/min** |

Compare to today (Twilio + Polly Say + Claude Haiku via Bedrock): ~$0.022–0.033/min.
