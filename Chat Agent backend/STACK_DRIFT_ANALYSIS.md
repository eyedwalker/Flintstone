# Chat Agent Backend — Stack Drift Analysis

**Original analysis**: 2026-05-27
**Phase 1 (DynamoDB imports)**: 2026-05-28 ✅ — 12 tables imported
**Phase 2 (Voice HttpApi imports)**: 2026-05-28 ✅ — 8 resources imported (1 API + 5 Routes + 1 Integration + 1 Lambda::Permission)
**Stack**: `chat-agent` in `us-west-2` (account `780457123717`)
**Status**: `IMPORT_COMPLETE`. All major drift remediation complete except orphan S3 buckets (Phase 3 — deferred).

---

## Phase 1 progress (2026-05-28)

CloudFormation IMPORT executed cleanly. The 12 orphan tables are now tracked
by the `chat-agent` stack. Each carries `DeletionPolicy: Retain` so a future
stack delete preserves data:

| Logical | Physical |
|---|---|
| `AssistantKbTable` | `chat-agent-assistant-kb-dev` |
| `AttachmentsTable` | `chat-agent-attachments-dev` |
| `AuditLogTable` | `chat-agent-audit-log-dev` (TTL) |
| `EscalationConfigTable` | `chat-agent-escalation-config-dev` |
| `FinetuningJobsTable` | `chat-agent-finetuning-jobs-dev` |
| `KnowledgeBasesTable` | `chat-agent-knowledge-bases-dev` |
| `RaftIterationsTable` | `chat-agent-raft-iterations-dev` |
| `RegistryTable` | `chat-agent-registry-dev` |
| `SessionsTable` | `chat-agent-sessions-dev` (TTL) |
| `TeamMembersTable` | `chat-agent-team-members-dev` |
| `TrainingDatasetsTable` | `chat-agent-training-datasets-dev` |
| `VoiceSessionsTable` | `chat-agent-voice-sessions-dev` (TTL) |

**Live stack resource count: 26 → 55** (the 29-resource bump beyond +12 is auto-generated sub-resources picked up alongside the import).

**Why the deploy was previously broken**: `EarlyValidation::ResourceExistenceCheck` was rejecting changesets because the local template tried to CREATE `VoiceSessionsTable` while the actual table already existed in AWS. With the table now imported, that conflict is gone — a normal `sam deploy` against the local template should now succeed (modulo any other surface like the orphan HttpApi, see Phase 2 below).

**Original analysis below for reference.**

---

## Original analysis

## TL;DR

The `chat-agent` CloudFormation stack stopped accepting changes in March 2026. Every `sam deploy` since then has failed the `AWS::EarlyValidation::ResourceExistenceCheck` hook. Meanwhile, 12+ DynamoDB tables, 1 entire HttpApi, and several S3 buckets have been created in the AWS account **outside CloudFormation** — they exist in AWS but aren't tracked by the stack. The local `template.yaml` has also drifted, referencing some of those orphan resources via env vars. Today's voice + SMS work cannot deploy via SAM until this is resolved.

## Diagnosis: what triggers the hook

The `EarlyValidation::ResourceExistenceCheck` hook fires during changeset creation. It typically rejects a deploy when:
- A resource the template tries to **create** already exists in AWS with the same physical id
- A resource the template tries to **update** or **reference** doesn't exist in AWS
- A resource has been **manually deleted** from AWS while the stack still tracks it (orphaned reference)

In our case the most-likely culprits are:
1. The local template's `VoiceSessionsTable` (DynamoDB table named `chat-agent-voice-sessions-dev`) — that table **already exists in AWS** but is not in the live stack. SAM tries to CREATE it; the hook says "already exists".
2. Many other dependencies and IAM resources have drifted in similar ways.

The actual rejected resource isn't surfaced in the changeset description; AWS only says "use DescribeEvents" but DescribeEvents returns no detail for early-validation hooks. This is a known AWS gap.

## What's tracked in the live stack (26 resources)

```
Type                                Logical (Physical)
--------------------------------    ---------------------------------------------------------
AWS::Lambda::Function               ApiFunction (chat-agent-api-dev)
AWS::Lambda::Function               ProvisionFunction (chat-agent-provision-dev)
AWS::Lambda::Function               TestRunnerFunction (chat-agent-test-runner-dev)
AWS::ApiGatewayV2::Api              HttpApi (2p595psdt1)
AWS::ApiGatewayV2::Stage            HttpApiStage (dev)
AWS::Cognito::UserPool              UserPool (us-west-2_wtRPN8aXd)
AWS::Cognito::UserPoolClient        UserPoolClient (361fvmvoc1siist24u5oojf7bo)
AWS::IAM::Role                      LambdaExecutionRole (chat-agent-lambda-dev)
AWS::IAM::Role                      BedrockKbRole (chat-agent-bedrock-kb-dev)
AWS::IAM::Role                      BedrockAgentRole (chat-agent-bedrock-agent-dev)
AWS::IAM::Role                      SchedulerExecutionRole (chat-agent-scheduler-dev)
AWS::DynamoDB::Table x 16           AssistantsTable, ChatJobsTable, ContentTable,
                                    HierarchyDefinitionsTable, HierarchyNodesTable,
                                    MetricsTable, NodeUsersTable, ReportRunsTable,
                                    ReportSchedulesTable, ScreenMappingsTable, TenantsTable,
                                    TestCasesTable, TestResultsTable, TestRunsTable,
                                    TestSuitesTable, WidgetPresetsTable
+ 15 AWS::Lambda::Permission entries (auto-generated from HttpApi events)
```

## What's in AWS but NOT in the stack (orphan resources)

### Orphan DynamoDB tables (12)
```
chat-agent-assistant-kb-dev          — referenced as ASSISTANT_KB_TABLE env var
chat-agent-attachments-dev           — referenced as ATTACHMENTS_TABLE env var
chat-agent-audit-log-dev             — referenced as AUDIT_LOG_TABLE env var
chat-agent-escalation-config-dev     — referenced as ESCALATION_CONFIG_TABLE env var
chat-agent-finetuning-jobs-dev       — used by RAFT/fine-tuning code paths
chat-agent-knowledge-bases-dev       — referenced as KNOWLEDGE_BASES_TABLE env var
chat-agent-raft-iterations-dev       — used by RAFT training
chat-agent-registry-dev              — purpose unclear from code
chat-agent-sessions-dev              — appears to be widget/chat sessions
chat-agent-team-members-dev          — referenced as TEAM_MEMBERS_TABLE env var
chat-agent-training-datasets-dev     — used by RAFT training
chat-agent-voice-sessions-dev        — referenced as VoiceSessionsTable in local template — LIKELY THE BLOCKER
```

### Orphan API Gateway
```
chat-agent-voice (v1k97uw533, HTTP)  — separate HttpApi with 5 voice routes:
  POST /voice/sms-inbound
  POST /voice/inbound
  POST /voice/respond
  POST /voice/status
  GET  /voice/outbound-twiml
```
This API was created outside SAM and is what Twilio webhooks currently hit.

### Orphan S3 buckets
```
chat-agent-hipaa-dev               — referenced as HIPAA_BUCKET env var
chat-agent-training-data-dev       — RAFT training data
snowflake-eyecare-reports-dev      — referenced as REPORT_BUCKET env var
wubba-backups
wubba-db-dumps-780457123717
wubba-db-dumps-780457123717-dr
wubba-sites-cmltgki6i0001r201pms
wubba-voice-deploy                 — possibly related to voice gateway / bridge
```

## What's in the local template (28 resources)

Adds two beyond the live stack:
- **`VoiceSessionsTable`** — duplicate of orphan `chat-agent-voice-sessions-dev`
- **`TranscribeCompletionFunction`** — brand new, no AWS counterpart yet

Plus a large number of new HttpApi events on `ApiFunction` for the routes built this session (`/voice/tool-schemas`, `/voice/tool-execute`, `/voice/call-event`, `/voice/active-calls`, `/voice/call/{callSid}`, `/voice/call/{callSid}/reanalyze`, `/voice/recording-status`, `/voice/transcript-ready`).

The template also references many orphan tables and buckets via Lambda env vars (`HIPAA_BUCKET`, `TEAM_MEMBERS_TABLE`, etc.) without declaring them as Resources. That works at runtime but means they're not part of any IaC.

## Remediation options

### Option A: Import orphans into the stack (most durable, slowest)

For each orphan resource, run a CloudFormation **resource import** changeset. The general flow:
1. Add the resource declaration to `template.yaml` with `DeletionPolicy: Retain`
2. `aws cloudformation create-change-set --change-set-type IMPORT --resources-to-import file://imports.json ...`
3. `aws cloudformation execute-change-set ...`
4. Repeat until every orphan is tracked
5. Then do a normal `sam deploy` for the new resources

Estimated effort: 4–8 hours for the table imports + extra IAM work, plus careful testing on the HttpApi import (a separate API can't be simply "merged" into the existing one — you'd either keep both or migrate routes).

Pros: stack reflects reality. Future deploys work. No data loss.
Cons: Lots of careful manual work. Easy to get one of the import templates wrong.

### Option B: Start a fresh stack (cleanest, but route Twilio webhooks)

Deploy as `chat-agent-v2` with the full current template. Migrate Twilio webhook URLs to point at the new HttpApi. Eventually delete the old stack + orphans.

Pros: Single deploy. Tested template. Clean state.
Cons: DDB tables in the old stack stay tied to old stack — either duplicate (re-create empty in new stack and run a data backfill) or import them later. Twilio + the front-end need their URLs updated.

Estimated effort: 2–4 hours for the parallel deploy + DDB import work + Twilio re-pointing + verification.

### Option C: Bypass CloudFormation for code-only changes (quickest, technical debt accrues)

Update Lambda function code + env vars directly via the AWS CLI. Skips CloudFormation. The SMS intent classifier + emergency path becomes live without any IaC change.

```bash
cd "Chat Agent backend"
npm run build
cd dist && zip -r ../lambda.zip . && cd ..
aws lambda update-function-code --function-name chat-agent-api-dev \
  --zip-file fileb://lambda.zip \
  --profile eyentelligence --region us-west-2

aws lambda update-function-configuration --function-name chat-agent-api-dev \
  --environment "Variables={...all existing... ,VOICE_GATEWAY_SERVICE_TOKEN=<token>,VOICE_SESSIONS_TABLE=chat-agent-voice-sessions-dev,HIPAA_BUCKET=chat-agent-hipaa-dev,TWILIO_SIGNATURE_VALIDATION=disabled}" \
  --profile eyentelligence --region us-west-2
```

What works after this:
- SMS intent classification, emergency escalation, opt-out, call-log writes (the `chat-agent-voice-sessions-dev` table works for both calls + SMS log entries)
- Existing `/voice/sms-inbound`, `/voice/inbound`, `/voice/respond` on the orphan API keep routing to the updated Lambda

What WON'T work (no API Gateway routes):
- `/voice/tool-execute`, `/voice/tool-schemas` (Nova Sonic bridge endpoints — not needed until the bridge deploys)
- `/voice/transcript-ready` (Amazon Transcribe completion delivery — not needed until Transcribe is set up)
- `/voice/active-calls`, `/voice/call/{callSid}` (admin dashboard endpoints)
- `/voice/recording-status` (Twilio recording webhook — voicemails won't be captured until this exists)

Pros: 5 minutes to deploy SMS today. Tests the new code in production.
Cons: Adds another orphan operation. The new endpoints stay unreachable. Drift gets worse.

Estimated effort: 15 minutes.

### Option D: Pause new feature deploys, work on stack hygiene next session

Don't deploy anything new until drift is resolved (Option A or B). Keeps the production stable. Treats the drift as a project to plan.

## Recommended path

If shipping SMS today matters more than IaC hygiene: **Option C now, Option A as background work over the next sprint.**

If you have a window: **Option B** — a fresh stack is cleaner than trying to import 12 tables + an HttpApi.

If neither is on fire: **Option D** — schedule the stack hygiene work properly.

## Open questions

1. Who created the orphan resources? (`chat-agent-voice` HttpApi, `chat-agent-voice-sessions-dev`, the HIPAA bucket — were these manual or another tool?)
2. Is anyone else deploying to this account? (Are there active branches besides `main` that have been pushed live via different paths?)
3. Is the org-level CloudFormation hook the same `EarlyValidation::ResourceExistenceCheck` that AWS surfaces, or is there a custom Service Control Policy?
4. Is there an IaC tool other than SAM in use here? (CDK? Terraform? Manual console?)

Knowing these would change the remediation path. If, say, a teammate is deploying via Terraform for the voice infra, then Option B (parallel SAM stack) is wrong — we'd want to consolidate around Terraform.

## Phase 2 outcome (2026-05-28)

The orphan `chat-agent-voice` HttpApi (`v1k97uw533`) is now under CloudFormation management. 8 resources imported:

| Logical | Physical | Type |
|---|---|---|
| `VoiceHttpApi` | `v1k97uw533` | AWS::ApiGatewayV2::Api |
| `VoiceLambdaIntegration` | `3abnsoq` | AWS::ApiGatewayV2::Integration |
| `VoiceRouteSmsInbound` | `3u5d8q6` | AWS::ApiGatewayV2::Route |
| `VoiceRouteInbound` | `vasnleo` | AWS::ApiGatewayV2::Route |
| `VoiceRouteRespond` | `cc8i8pm` | AWS::ApiGatewayV2::Route |
| `VoiceRouteOutboundTwiml` | `4t3pn2e` | AWS::ApiGatewayV2::Route |
| `VoiceRouteStatus` | `bl1x323` | AWS::ApiGatewayV2::Route |
| `VoiceInvokePermission` | `voice-api-gateway` | AWS::Lambda::Permission |

**Caveat**: `AWS::ApiGatewayV2::Stage` is not supported by CloudFormation Import, so the `dev` stage on this API stays orphan. The stage is functional; just can't be managed via the template. If a future cleanup needs to consolidate to a single voice API, the migration plan would be to delete + recreate the stage.

**No traffic was interrupted** — Twilio webhooks continued hitting the same URL throughout. Import is a metadata operation; routes/integrations stayed exactly as they were.

A new stack output, `VoiceApiUrl`, exports the voice API URL so other stacks / docs can reference it.

## Phase 2 plan — orphan `chat-agent-voice` HttpApi (kept for reference)

The DynamoDB import is done. The next-largest piece of drift is the separate `chat-agent-voice` HttpApi (`v1k97uw533`) — created outside SAM, with 5 voice routes pointing at the same Lambda (`chat-agent-api-dev`). This is what Twilio currently calls.

The local `template.yaml` ALSO defines those same 5 routes as events on `ApiFunction`, plus the new monitoring/bridge routes added today. If we just do a normal `sam deploy` now, CloudFormation will create those routes on the main `chat-agent` HttpApi (id `2p595psdt1`) — DUPLICATING what's on the orphan API. That's not wrong per se, but it's two APIs doing the same thing.

Three viable paths for Phase 2:

### Option 2A — Import the orphan API (preserves Twilio URLs)
- Import `v1k97uw533` + each of its 5 routes + each integration as CloudFormation resources
- Remove the duplicate voice route declarations from `template.yaml` so they only live on the imported API
- Twilio webhooks keep pointing at the same URLs — zero-downtime
- Most work (HttpApi + 5 Route + 5 Integration + Stage = ~12 imports), but cleanest end-state

### Option 2B — Cut over to the main `chat-agent` HttpApi (delete the orphan)
- Let `sam deploy` create the voice routes on the main API
- Update the Twilio number's webhook URLs to the main API
- Delete the orphan `chat-agent-voice` HttpApi
- Simpler (no imports), but requires a brief Twilio webhook flip and risks a few minutes of misrouted calls

### Option 2C — Leave it, deploy as-is
- Just do `sam deploy` — the main API gets the new routes, the orphan stays
- Two APIs co-exist. Twilio keeps using the orphan. New monitoring/bridge endpoints live on the main.
- Acceptable interim state but doubles future maintenance

**Recommendation**: 2A. The orphan is small (one HttpApi + 5 routes + 5 integrations) and import is now a known-working pattern after Phase 1.

## Phase 3 plan — S3 buckets

The HIPAA bucket (`chat-agent-hipaa-dev`) and the training data bucket (`chat-agent-training-data-dev`) are orphan but referenced as env vars. They're stable enough to defer. The `snowflake-eyecare-reports-dev` and `wubba-*` buckets look like they belong to other workstreams and probably shouldn't be in this stack at all.

Lowest-effort Phase 3:
- Import `chat-agent-hipaa-dev` and `chat-agent-training-data-dev` only
- Document the `snowflake-eyecare-reports-dev` and `wubba-*` buckets as "intentionally external" with a comment in the template

## What's safe to do without deploying

- The git push from this session is **already live in `origin/main`** (commit `0d6b47d`) — code is preserved
- The Nova Sonic bridge subproject in [nova-sonic-bridge/](nova-sonic-bridge/) is standalone — can be built + ECR-pushed independently once we have a deploy plan
- The local test suite (321 tests) keeps passing — `npm test` works regardless of deploy state
- Documentation in `/Users/daviwa2@vsp.com/.claude/plans/we-need-to-analyze-eventual-beaver.md` captures the architecture for the next session
