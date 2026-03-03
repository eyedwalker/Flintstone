import { z } from 'zod';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/**
 * Validate arbitrary data against a Zod schema and return a discriminated
 * result with a human-readable error string on failure.
 */
export function validate<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
): { success: true; data: T } | { success: false; error: string } {
  const result = schema.safeParse(data);
  if (result.success) return { success: true, data: result.data };
  const issues = result.error.issues
    .map((i) => `${i.path.join('.')}: ${i.message}`)
    .join('; ');
  return { success: false, error: issues };
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

/** Widget (public) chat request body. */
export const WidgetChatSchema = z.object({
  message: z.string().min(1),
  sessionId: z.string().optional(),
  userId: z.string().optional(),
  nodeId: z.string().optional(),
  image: z.string().optional(),
  context: z.record(z.string(), z.string()).optional(),
});
export type WidgetChatBody = z.infer<typeof WidgetChatSchema>;

/** Internal / admin chat request body. */
export const ChatSchema = z.object({
  message: z.string().min(1),
  sessionId: z.string().optional(),
  userId: z.string().optional(),
  nodeId: z.string().optional(),
  testRoleLevel: z.number().int().optional(),
});
export type ChatBody = z.infer<typeof ChatSchema>;

// ---------------------------------------------------------------------------
// Assistants
// ---------------------------------------------------------------------------

/** Create a new assistant. */
export const CreateAssistantSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
});
export type CreateAssistantBody = z.infer<typeof CreateAssistantSchema>;

/** Update an existing assistant (partial / generic object). */
export const UpdateAssistantSchema = z.object({}).passthrough();
export type UpdateAssistantBody = z.infer<typeof UpdateAssistantSchema>;

/** Upload an asset (e.g. avatar image) for an assistant. */
export const UploadAssetSchema = z.object({
  fileName: z.string().min(1),
  contentType: z.string().min(1),
});
export type UploadAssetBody = z.infer<typeof UploadAssetSchema>;

/** AI-generate CSS for the widget. */
export const GenerateCssSchema = z.object({
  prompt: z.string().min(1),
  currentCss: z.string().optional(),
});
export type GenerateCssBody = z.infer<typeof GenerateCssSchema>;

/** AI-generate UI code for a widget component. */
export const GenerateUiSchema = z.object({
  component: z.enum(['launcher', 'chat']),
  prompt: z.string().optional(),
  image: z.string().optional(),
  currentCode: z.string().optional(),
});
export type GenerateUiBody = z.infer<typeof GenerateUiSchema>;

/** Link a knowledge base to an assistant. */
export const LinkKbSchema = z.object({
  knowledgeBaseId: z.string().min(1),
});
export type LinkKbBody = z.infer<typeof LinkKbSchema>;

// ---------------------------------------------------------------------------
// Knowledge Base
// ---------------------------------------------------------------------------

/** Request a pre-signed upload URL for a KB document. */
export const UploadUrlSchema = z.object({
  fileName: z.string().min(1),
  contentType: z.string().min(1),
  assistantId: z.string().min(1),
  knowledgeBaseId: z.string().min(1),
  scope: z.string().min(1),
  minRoleLevel: z.number().int().min(0).optional(),
  fileSize: z.number().int().min(0).optional(),
});
export type UploadUrlBody = z.infer<typeof UploadUrlSchema>;

/** Trigger a sync / re-ingestion for a single KB content item. */
export const SyncContentSchema = z.object({
  contentId: z.string().min(1),
  knowledgeBaseId: z.string().min(1),
  assistantId: z.string().min(1),
  useBDA: z.boolean().optional(),
});
export type SyncContentBody = z.infer<typeof SyncContentSchema>;

/** Ingest a web page URL into a knowledge base. */
export const IngestUrlSchema = z.object({
  url: z.string().url(),
  assistantId: z.string().min(1),
  knowledgeBaseId: z.string().min(1),
  title: z.string().optional(),
  scope: z.string().optional(),
  minRoleLevel: z.number().int().min(0).optional(),
  crawlDepth: z.number().int().min(0).optional(),
  maxPages: z.number().int().min(1).optional(),
  useBDA: z.boolean().optional(),
});
export type IngestUrlBody = z.infer<typeof IngestUrlSchema>;

/** Ingest a video URL into a knowledge base. */
export const IngestVideoSchema = z.object({
  url: z.string().url(),
  assistantId: z.string().min(1),
  knowledgeBaseId: z.string().min(1),
  scope: z.string().optional(),
  minRoleLevel: z.number().int().min(0).optional(),
  useBDA: z.boolean().optional(),
});
export type IngestVideoBody = z.infer<typeof IngestVideoSchema>;

/** Browse Vimeo videos for a given assistant. */
export const VimeoBrowseSchema = z.object({
  assistantId: z.string().min(1),
  page: z.number().int().min(1).optional(),
  perPage: z.number().int().min(1).optional(),
  query: z.string().optional(),
});
export type VimeoBrowseBody = z.infer<typeof VimeoBrowseSchema>;

/** Bulk-ingest Vimeo videos into a knowledge base. */
export const VimeoBulkIngestSchema = z.object({
  assistantId: z.string().min(1),
  knowledgeBaseId: z.string().min(1),
  videoIds: z.array(z.string().min(1)).min(1),
  scope: z.string().optional(),
  minRoleLevel: z.number().int().min(0).optional(),
  useBDA: z.boolean().optional(),
});
export type VimeoBulkIngestBody = z.infer<typeof VimeoBulkIngestSchema>;

/** Check ingestion status for an assistant's knowledge base content. */
export const CheckStatusSchema = z.object({
  assistantId: z.string().min(1),
});
export type CheckStatusBody = z.infer<typeof CheckStatusSchema>;

/** Bulk-delete KB content items. */
export const BulkDeleteSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
});
export type BulkDeleteBody = z.infer<typeof BulkDeleteSchema>;

/** Edit metadata on a single KB content item. */
export const EditContentMetadataSchema = z.object({
  title: z.string().optional(),
  tags: z.array(z.string()).optional(),
  scope: z.string().optional(),
  minRoleLevel: z.number().int().min(0).optional(),
});
export type EditContentMetadataBody = z.infer<typeof EditContentMetadataSchema>;

// ---------------------------------------------------------------------------
// Team
// ---------------------------------------------------------------------------

const TeamRole = z.enum(['admin', 'editor', 'viewer']);

/** Invite a new team member. */
export const TeamInviteSchema = z.object({
  email: z.string().email(),
  role: TeamRole,
  name: z.string().optional(),
});
export type TeamInviteBody = z.infer<typeof TeamInviteSchema>;

/** Change an existing team member's role. */
export const TeamRoleChangeSchema = z.object({
  role: z.enum(['admin', 'editor', 'viewer', 'owner']),
});
export type TeamRoleChangeBody = z.infer<typeof TeamRoleChangeSchema>;

// ---------------------------------------------------------------------------
// Escalation
// ---------------------------------------------------------------------------

/** Configure Salesforce escalation settings for a tenant. */
export const EscalationConfigSchema = z.object({
  enabled: z.boolean(),
  salesforceInstanceUrl: z.string().url(),
  salesforceConsumerKey: z.string().min(1),
  salesforceUsername: z.string().min(1),
  privateKey: z.string().optional(),
  triggerMode: z.enum(['manual', 'auto', 'both']),
  autoTriggers: z.object({
    keywords: z.array(z.string()),
    sentimentThreshold: z.number().min(0).max(1).optional(),
    maxTurns: z.number().int().min(1).optional(),
  }),
  caseDefaults: z.object({
    priority: z.string().min(1),
    origin: z.string().min(1),
    status: z.string().min(1),
    recordTypeId: z.string().optional(),
  }),
});
export type EscalationConfigBody = z.infer<typeof EscalationConfigSchema>;

/** Widget-initiated escalation request. */
export const WidgetEscalationSchema = z.object({
  chatHistory: z.array(
    z.object({
      role: z.string().min(1),
      content: z.string(),
      timestamp: z.string().optional(),
    }),
  ),
  sessionId: z.string().optional(),
  context: z.record(z.string(), z.string()).optional(),
  userInfo: z
    .object({
      name: z.string().optional(),
      email: z.string().email().optional(),
      phone: z.string().optional(),
    })
    .optional(),
  reason: z.string().optional(),
  attachmentIds: z.array(z.string()).optional(),
});
export type WidgetEscalationBody = z.infer<typeof WidgetEscalationSchema>;

/** Widget check whether escalation should be triggered. */
export const WidgetCheckEscalationSchema = z.object({
  messages: z.array(
    z.object({
      role: z.string().min(1),
      content: z.string(),
    }),
  ),
  turnCount: z.number().int().min(0).optional(),
});
export type WidgetCheckEscalationBody = z.infer<typeof WidgetCheckEscalationSchema>;

// ---------------------------------------------------------------------------
// Hierarchy
// ---------------------------------------------------------------------------

/** Create a hierarchy node. */
export const HierarchyNodeCreateSchema = z.object({
  name: z.string().min(1),
  levelId: z.string().min(1),
  depth: z.number().int().min(0),
  parentNodeId: z.string().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
});
export type HierarchyNodeCreateBody = z.infer<typeof HierarchyNodeCreateSchema>;

/** Assign a user to a hierarchy node. */
export const HierarchyUserAssignSchema = z.object({
  userId: z.string().min(1),
  nodeId: z.string().min(1),
  organizationId: z.string().min(1),
  role: z.string().min(1),
  email: z.string().email(),
  name: z.string().min(1),
});
export type HierarchyUserAssignBody = z.infer<typeof HierarchyUserAssignSchema>;
