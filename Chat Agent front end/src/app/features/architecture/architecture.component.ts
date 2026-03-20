import { Component, OnInit } from '@angular/core';
import { ApiService } from '../../core/services/api.service';
import { MatSnackBar } from '@angular/material/snack-bar';

interface ITechEntry {
  service: string;
  purpose: string;
  config: string;
}

interface ICapacityRow {
  metric: string;
  value: string;
  notes: string;
}

interface IServiceLimit {
  service: string;
  limit: string;
  current: string;
  recommended: string;
}

interface IFeature {
  name: string;
  description: string;
  status: 'live' | 'beta' | 'planned';
}

@Component({
  selector: 'app-architecture',
  templateUrl: './architecture.component.html',
  styleUrls: ['./architecture.component.scss'],
})
export class ArchitectureComponent implements OnInit {
  // Live Bedrock data
  liveAgents: any[] = [];
  loadingAgents = true;
  selectedAgent: any = null;
  editingAgent = false;
  editModel = '';
  editInstruction = '';
  editName = '';

  // Orchestrator
  useOrchestrator = false;
  loadingOrchestrator = true;

  // Agent Registry
  registeredAgents: any[] = [];
  loadingRegistry = true;

  // Action Group editing
  editingActionGroup = false;
  agEditName = '';
  agEditDescription = '';
  agEditLambdaArn = '';
  agEditSchema = '';
  agEditId = ''; // empty = create new
  agSaving = false;

  constructor(private api: ApiService, private snackBar: MatSnackBar) {}

  async ngOnInit(): Promise<void> {
    await Promise.all([
      this.loadLiveAgents(),
      this.loadOrchestratorStatus(),
      this.loadRegistry(),
    ]);
  }

  async loadLiveAgents(): Promise<void> {
    this.loadingAgents = true;
    try {
      const res = await this.api.get<any[]>('/agent-config/bedrock/agents');
      this.liveAgents = res.data ?? [];
    } catch (e) {
      console.error('Failed to load agents:', e);
    }
    this.loadingAgents = false;
  }

  async selectAgent(agent: any): Promise<void> {
    const res = await this.api.get<any>(`/agent-config/bedrock/agents/${agent.agentId}`);
    this.selectedAgent = res.data ?? agent;
  }

  startEditAgent(): void {
    if (!this.selectedAgent) return;
    this.editingAgent = true;
    this.editName = this.selectedAgent.agentName;
    this.editModel = this.selectedAgent.foundationModel;
    this.editInstruction = this.selectedAgent.instruction;
  }

  cancelEditAgent(): void {
    this.editingAgent = false;
  }

  async saveAgent(): Promise<void> {
    if (!this.selectedAgent) return;
    const res = await this.api.put<any>(`/agent-config/bedrock/agents/${this.selectedAgent.agentId}`, {
      agentName: this.editName,
      foundationModel: this.editModel,
      instruction: this.editInstruction,
    });
    if (res.data) {
      this.selectedAgent = { ...this.selectedAgent, ...res.data };
      this.editingAgent = false;
      this.snackBar.open('Agent updated and re-prepared', '', { duration: 3000 });
      await this.loadLiveAgents();
    }
  }

  async prepareAgent(agentId: string): Promise<void> {
    await this.api.post<any>(`/agent-config/bedrock/agents/${agentId}/prepare`);
    this.snackBar.open('Agent re-prepared', '', { duration: 2000 });
    await this.loadLiveAgents();
  }

  getStatusColor(status: string): string {
    if (status === 'PREPARED') return '#2e7d32';
    if (status === 'FAILED') return '#c62828';
    return '#f57c00';
  }

  getStatusIcon(status: string): string {
    if (status === 'PREPARED') return 'check_circle';
    if (status === 'FAILED') return 'error';
    return 'pending';
  }

  async loadOrchestratorStatus(): Promise<void> {
    this.loadingOrchestrator = true;
    try {
      const res = await this.api.get<any>('/agent-config/orchestrator');
      this.useOrchestrator = res.data?.useOrchestrator ?? false;
    } catch { /* default off */ }
    this.loadingOrchestrator = false;
  }

  async toggleOrchestrator(): Promise<void> {
    const newVal = !this.useOrchestrator;
    const res = await this.api.put<any>('/agent-config/orchestrator', { useOrchestrator: newVal });
    if (res.data) {
      this.useOrchestrator = res.data.useOrchestrator;
      this.snackBar.open(`Orchestrator ${this.useOrchestrator ? 'enabled' : 'disabled'}`, '', { duration: 2000 });
    }
  }

  async loadRegistry(): Promise<void> {
    this.loadingRegistry = true;
    try {
      const res = await this.api.get<any[]>('/agent-config/registry');
      this.registeredAgents = res.data ?? [];
    } catch { /* defaults will be used */ }
    this.loadingRegistry = false;
  }

  async toggleAgentEnabled(agent: any): Promise<void> {
    agent.enabled = !agent.enabled;
    await this.api.post<any>('/agent-config/registry', agent);
    this.snackBar.open(`${agent.name} ${agent.enabled ? 'enabled' : 'disabled'}`, '', { duration: 2000 });
  }

  async seedRegistry(): Promise<void> {
    const res = await this.api.post<any>('/agent-config/registry/seed');
    if (res.data) {
      this.snackBar.open(`Seeded ${res.data.seeded} agents`, '', { duration: 2000 });
      await this.loadRegistry();
    }
  }

  async linkBedrockToRegistry(registryAgent: any, bedrockAgent: any): Promise<void> {
    registryAgent.bedrockAgentId = bedrockAgent.agentId;
    registryAgent.bedrockAgentAliasId = 'TSTALIASID';
    await this.api.post<any>('/agent-config/registry', registryAgent);
    this.snackBar.open(`Linked ${registryAgent.name} to Bedrock agent ${bedrockAgent.agentName}`, '', { duration: 3000 });
    await this.loadRegistry();
  }

  // ── Action Group Management ──────────────────────────────────────────────

  startCreateActionGroup(): void {
    this.editingActionGroup = true;
    this.agEditId = '';
    this.agEditName = '';
    this.agEditDescription = '';
    this.agEditLambdaArn = `arn:aws:lambda:us-west-2:780457123717:function:chat-agent-api-dev`;
    this.agEditSchema = '{\n  "openapi": "3.0.0",\n  "info": { "title": "New Action Group", "version": "1.0.0" },\n  "paths": {}\n}';
  }

  async startEditActionGroup(ag: any): Promise<void> {
    if (!this.selectedAgent) return;
    // Fetch full details with schema
    const res = await this.api.get<any>(
      `/agent-config/bedrock/agents/${this.selectedAgent.agentId}/action-groups/${ag.actionGroupId}`
    );
    const detail = res.data ?? ag;
    this.editingActionGroup = true;
    this.agEditId = detail.actionGroupId;
    this.agEditName = detail.actionGroupName;
    this.agEditDescription = detail.description ?? '';
    this.agEditLambdaArn = detail.lambdaArn ?? '';
    this.agEditSchema = detail.apiSchema ?? '{}';
  }

  cancelEditActionGroup(): void {
    this.editingActionGroup = false;
  }

  async saveActionGroup(): Promise<void> {
    if (!this.selectedAgent) return;
    this.agSaving = true;
    const agentId = this.selectedAgent.agentId;

    if (this.agEditId) {
      // Update existing
      await this.api.put<any>(
        `/agent-config/bedrock/agents/${agentId}/action-groups/${this.agEditId}`,
        { name: this.agEditName, description: this.agEditDescription, lambdaArn: this.agEditLambdaArn, apiSchema: this.agEditSchema }
      );
      this.snackBar.open('Action group updated & agent re-prepared', '', { duration: 3000 });
    } else {
      // Create new
      await this.api.post<any>(
        `/agent-config/bedrock/agents/${agentId}/action-groups`,
        { name: this.agEditName, description: this.agEditDescription, lambdaArn: this.agEditLambdaArn, apiSchema: this.agEditSchema }
      );
      this.snackBar.open('Action group created & agent re-prepared', '', { duration: 3000 });
    }

    this.agSaving = false;
    this.editingActionGroup = false;
    // Reload agent details
    await this.selectAgent(this.selectedAgent);
    await this.loadLiveAgents();
  }

  async deleteActionGroup(ag: any): Promise<void> {
    if (!this.selectedAgent) return;
    if (!confirm(`Delete action group "${ag.actionGroupName}"? This cannot be undone.`)) return;

    await this.api.delete<any>(
      `/agent-config/bedrock/agents/${this.selectedAgent.agentId}/action-groups/${ag.actionGroupId}`
    );
    this.snackBar.open('Action group deleted & agent re-prepared', '', { duration: 3000 });
    await this.selectAgent(this.selectedAgent);
    await this.loadLiveAgents();
  }

  // Tech Stack
  techStack: ITechEntry[] = [
    { service: 'AWS Lambda (Node.js 20, ARM64)', purpose: 'API compute — 3 functions: API (30s), Provision (5min), Test Runner (15min)', config: '512 MB, pay-per-request' },
    { service: 'Amazon DynamoDB', purpose: 'Primary datastore — 18 tables for assistants, tenants, content, metrics, etc.', config: 'On-demand (PAY_PER_REQUEST), PITR, SSE' },
    { service: 'Amazon API Gateway (HTTP API)', purpose: 'REST API gateway with JWT auth and CORS', config: '1,000 req/s rate, 500 burst' },
    { service: 'Amazon Cognito', purpose: 'User authentication — email/password with SRP', config: 'Pool + client, 1hr tokens, 30-day refresh' },
    { service: 'Amazon Bedrock Agents', purpose: 'Agentic AI orchestration — tool selection, multi-turn reasoning, action groups', config: 'Agent: Encompass-Larry, extended thinking enabled' },
    { service: 'Bedrock Knowledge Bases', purpose: 'RAG retrieval with S3 Vectors for semantic search', config: 'Titan Embed Text v2, S3 vector store' },
    { service: 'Snowflake (DEV_ANALYTICS)', purpose: 'Eyecare practice data warehouse — 118 views, 74 datamart tables', config: 'Account: eyefinity-dev, WH: DEV_COMPUTE_WINDSURF' },
    { service: 'EventBridge Scheduler', purpose: 'Timezone-aware cron triggers for scheduled report delivery', config: 'Per-schedule, retry + DLQ, auto-disable on failure' },
    { service: 'Amazon S3', purpose: 'Static frontend, KB content, reports/charts storage', config: 'CloudFront-distributed, 7-day report lifecycle' },
    { service: 'Amazon CloudFront', purpose: 'CDN for frontend (yabba-dabba-do.com) and reports (reports.wubba.ai)', config: 'HTTPS, custom domains, ACM certs' },
    { service: 'Amazon SES', purpose: 'Scheduled report delivery and escalation notifications', config: 'Domain: wubba.ai, DKIM verified, production mode' },
    { service: 'AWS SAM / CloudFormation', purpose: 'Infrastructure as Code — entire stack defined in template.yaml', config: 'Parameterized (dev/prod)' },
    { service: 'Angular 17', purpose: 'Frontend SPA with Material Design, lazy-loaded modules, RBAC', config: '14 feature modules, standalone build' },
  ];

  techColumns = ['service', 'purpose', 'config'];

  // Capacity Estimates
  capacityRows: ICapacityRow[] = [
    { metric: 'Total Workstations', value: '8,000', notes: 'Encompass desktop installations' },
    { metric: 'Concurrent Users (10-15%)', value: '800 – 1,200', notes: 'Users with app open at any moment' },
    { metric: 'Concurrent Chatters (10%)', value: '80 – 120', notes: 'Users actively sending messages' },
    { metric: 'Widget Page Loads / min', value: '~200', notes: 'Screen context lookups (cached via CDN)' },
    { metric: 'Chat Messages / min', value: '~40 – 60', notes: 'Peak Bedrock invocations per minute' },
    { metric: 'API Requests / sec (peak)', value: '~50 – 80', notes: 'All endpoints combined' },
  ];

  capacityColumns = ['metric', 'value', 'notes'];

  // Service Limits
  serviceLimits: IServiceLimit[] = [
    { service: 'API Gateway', limit: 'Throttle rate', current: '1,000 req/s', recommended: '1,000 req/s' },
    { service: 'API Gateway', limit: 'Burst', current: '500', recommended: '500' },
    { service: 'Lambda', limit: 'Concurrent executions', current: '1,000 (default)', recommended: '1,000+' },
    { service: 'Bedrock (Haiku)', limit: 'Invocations/min', current: '50 (default soft)', recommended: '200+ (request increase)' },
    { service: 'Bedrock (Sonnet)', limit: 'Invocations/min', current: '10 (default soft)', recommended: '50+ (request increase)' },
    { service: 'DynamoDB', limit: 'Read/Write capacity', current: 'On-demand (auto)', recommended: 'No change needed' },
    { service: 'CloudFront', limit: 'Requests/sec', current: '250,000', recommended: 'No change needed' },
    { service: 'Cognito', limit: 'Auth requests/sec', current: '120 (default)', recommended: 'Sufficient' },
  ];

  limitsColumns = ['service', 'limit', 'current', 'recommended'];

  // Features
  features: IFeature[] = [
    { name: 'AI Chat (Bedrock Agents)', description: 'Multi-turn conversational AI with RAG knowledge retrieval and guardrails', status: 'live' },
    { name: 'Knowledge Bases', description: 'Upload documents, auto-sync to Bedrock KB with S3 vector store for semantic search', status: 'live' },
    { name: 'Screen Mappings', description: 'AI-generated URL-to-content mappings — contextual videos, articles, and questions per screen', status: 'live' },
    { name: 'Embeddable Widget', description: 'Drop-in JS widget with screen-context awareness, escalation, file attachments', status: 'live' },
    { name: 'Test Suites', description: 'Automated AI response quality testing with pass/fail evaluation and scoring', status: 'live' },
    { name: 'Hierarchy & RBAC', description: 'Multi-level org hierarchy with role-based access (admin, editor, viewer)', status: 'live' },
    { name: 'Escalation / Support Cases', description: 'Salesforce case creation, status tracking, file attachments, case comments', status: 'live' },
    { name: 'Team Management', description: 'Invite/manage team members with role assignments per tenant', status: 'live' },
    { name: 'Snowflake Analytics Agent', description: 'Natural language queries against eyecare data warehouse — revenue, patients, appointments, products', status: 'live' },
    { name: 'Report Generation', description: 'On-demand Excel/CSV reports and inline SVG charts via chat — delivered through CloudFront CDN', status: 'live' },
    { name: 'Scheduled Report Delivery', description: 'EventBridge-powered cron schedules delivering reports via SES email with secure download links (HIPAA)', status: 'live' },
    { name: 'Analytics Dashboard', description: 'Conversation metrics, usage trends, resolution rates, satisfaction scores', status: 'live' },
    { name: 'Widget Presets', description: 'Customizable widget themes, placement, behavior, and branding per assistant', status: 'live' },
    { name: 'API Documentation', description: 'Interactive OpenAPI 3.0.3 spec with Swagger UI', status: 'live' },
    { name: 'Multi-Tenant Isolation', description: 'Tenant-scoped data with API key authentication for widget endpoints', status: 'live' },
  ];

  featureColumns = ['name', 'description', 'status'];

  // Agent & LLM Architecture
  llmModels = [
    { model: 'Claude Sonnet 4.6', provider: 'Anthropic (via Bedrock)', id: 'us.anthropic.claude-sonnet-4-6', usage: 'Bedrock Agent orchestration — tool selection, reasoning, response generation', thinking: 'Extended thinking (1024 budget tokens)' },
    { model: 'Amazon Titan Embed Text v2', provider: 'Amazon (Bedrock)', id: 'amazon.titan-embed-text-v2:0', usage: 'Document embedding for RAG knowledge base retrieval', thinking: 'N/A — embedding model' },
    { model: 'Mixtral 8x7B', provider: 'Snowflake Cortex', id: 'mixtral-8x7b (Snowflake-hosted)', usage: 'In-database LLM inference and text summarization', thinking: 'N/A — called via SQL' },
  ];
  llmColumns = ['model', 'provider', 'usage', 'thinking'];

  agentTools = [
    { category: 'Schema Discovery', tools: 'list_tables, describe_table', source: 'Snowflake Lambda', description: 'Browse tables, views, columns in the data warehouse' },
    { category: 'Query Execution', tools: 'run_query', source: 'Snowflake Lambda', description: 'Execute read-only SQL against Snowflake (SELECT only)' },
    { category: 'Pre-Built Analytics', tools: 'revenue_summary, patient_summary, top_products, appointment_utilization', source: 'Snowflake Lambda', description: 'Business KPIs with parameterized date ranges and filters' },
    { category: 'Report Generation', tools: 'generate_report, generate_chart', source: 'Snowflake Lambda', description: 'Excel/CSV exports and SVG chart visualizations → S3 + CDN' },
    { category: 'Report Scheduling', tools: 'schedule_report', source: 'API Lambda (forwarded)', description: 'Create recurring reports delivered via email/SMS (EventBridge Scheduler)' },
    { category: 'Knowledge Base', tools: 'RAG retrieval', source: 'Bedrock KB (CSJA2NKXQS)', description: 'Semantic search over Encompass help docs, how-to guides, VSP policies' },
  ];
  toolColumns = ['category', 'tools', 'source', 'description'];

  dataStores = [
    { store: 'Snowflake (DEV_ANALYTICS)', type: 'Data Warehouse', content: '118 business views + 74 datamart tables — patients, orders, billing, appointments, insurance, products', retention: 'Persistent' },
    { store: 'DynamoDB (18+ tables)', type: 'NoSQL', content: 'Assistants, tenants, metrics, schedules, runs, team, hierarchy, content, test suites', retention: 'PITR + SSE' },
    { store: 'S3 (snowflake-eyecare-reports-dev)', type: 'Object Storage', content: 'Generated Excel/CSV reports and SVG charts', retention: '7-day lifecycle' },
    { store: 'S3 (wubba-data-sources)', type: 'Object Storage', content: 'Knowledge base documents, OpenAPI schemas', retention: 'Persistent' },
    { store: 'S3 Vectors', type: 'Vector Store', content: 'Embedded document chunks for RAG retrieval', retention: 'Persistent' },
    { store: 'Secrets Manager', type: 'Secrets', content: 'Snowflake credentials (snowflake/dev-windsurf)', retention: 'Encrypted, rotatable' },
    { store: 'SSM Parameter Store', type: 'Config', content: 'Email from-address, Twilio credentials, Stripe keys per tenant', retention: 'Per-tenant scoped' },
  ];
  dataColumns = ['store', 'type', 'content', 'retention'];

  // Multi-Agent Registry
  agents = [
    {
      id: 'analytics',
      name: 'Encompass Larry',
      type: 'Bedrock Agent',
      model: 'Claude Sonnet 4.6',
      status: 'active',
      bedrockAgentId: 'KBAQR27COL',
      description: 'Snowflake analytics, charts, reports, and VSP knowledge base lookups',
      capabilities: ['Snowflake SQL queries', 'Chart generation (SVG)', 'Excel/CSV reports', 'Report scheduling', 'Knowledge base RAG'],
      toolCount: 11,
      icon: 'ac_unit',
    },
    {
      id: 'front-office',
      name: 'Front Office Assistant',
      type: 'Bedrock Agent',
      model: 'Claude Sonnet 4.6',
      status: 'active',
      bedrockAgentId: 'IYVTI2D2VJ',
      description: 'Appointment scheduling, patient lookup, SMS/email, orders — powered by Eyefinity EPM v2 API + Schedule Manager',
      capabilities: ['Patient search & creation', 'Appointment booking (Schedule Manager)', 'Provider/office lookup', 'SMS via Twilio', 'Email via SES', 'Order tracking', 'Appointment confirmations'],
      toolCount: 15,
      icon: 'calendar_today',
    },
    {
      id: 'claims',
      name: 'Insurance Claims Agent',
      type: 'Planned',
      model: 'TBD',
      status: 'planned',
      bedrockAgentId: '',
      description: 'Insurance claims lookup, status tracking, submission assistance',
      capabilities: ['Claims status lookup', 'Eligibility verification', 'Authorization tracking'],
      toolCount: 0,
      icon: 'verified_user',
    },
  ];

  orchestratorLayers = [
    { layer: 'Security Agent', icon: 'shield', description: 'PII detection/redaction, prompt injection blocking, HIPAA audit logging', status: 'Built' },
    { layer: 'Orchestrator', icon: 'route', description: 'Keyword-based routing + session affinity. Routes to the right specialist agent.', status: 'Built' },
    { layer: 'Agent Registry', icon: 'inventory_2', description: 'Defines available agents, capabilities, routing keywords, and priority.', status: 'Built' },
    { layer: 'Feature Flag', icon: 'toggle_on', description: 'useOrchestrator on tenant — when false, direct-to-Larry (zero change).', status: 'Ready' },
  ];

  // Security items
  securityItems = [
    { icon: 'lock', title: 'Authentication', detail: 'Amazon Cognito with SRP protocol, JWT tokens (1hr access, 30-day refresh), email-verified accounts' },
    { icon: 'admin_panel_settings', title: 'Authorization (RBAC)', detail: 'Role-based access control with admin, editor, viewer roles enforced at API and UI levels' },
    { icon: 'vpn_key', title: 'API Key Isolation', detail: 'Widget endpoints authenticated via per-assistant API keys, scoped to tenant data' },
    { icon: 'shield', title: 'Data Encryption', detail: 'DynamoDB SSE (AES-256), S3 SSE, HTTPS/TLS for all API and CDN traffic' },
    { icon: 'domain', title: 'Multi-Tenant Segregation', detail: 'All queries filtered by tenantId — no cross-tenant data leakage possible' },
    { icon: 'gpp_good', title: 'AI Guardrails', detail: 'Bedrock Guardrails for content filtering, PII detection, and topic restrictions per assistant' },
    { icon: 'history', title: 'Audit & Recovery', detail: 'DynamoDB Point-in-Time Recovery enabled, audit log table for admin actions' },
    { icon: 'verified_user', title: 'Infrastructure as Code', detail: 'Entire stack defined in SAM template — reproducible, auditable, version-controlled deployments' },
  ];
}
