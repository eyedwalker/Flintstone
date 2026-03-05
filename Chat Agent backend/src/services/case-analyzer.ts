/**
 * AI-powered case analysis — generates smart Subject, Priority, and Summary
 * from a chat transcript. Uses Anthropic Claude via direct API call.
 *
 * Borrowed patterns from salesforce-integration-portable/SupportCaseEngine.ts
 */

const ANTHROPIC_API_KEY = process.env['ANTHROPIC_API_KEY'] ?? '';

export interface ICaseAnalysis {
  subject: string;
  priority: 'Low' | 'Medium' | 'High' | 'Critical';
  category: string;
  summary: string;
}

/**
 * Analyze a chat transcript with Claude and return structured case metadata.
 * Falls back to keyword-based analysis if the AI call fails or no API key.
 */
export async function analyzeTranscript(
  chatHistory: Array<{ role: string; content: string; timestamp?: string }>,
  assistantName: string,
): Promise<ICaseAnalysis> {
  // Build transcript text
  const transcript = chatHistory
    .map(m => `[${m.role}]: ${m.content}`)
    .join('\n');

  // Try AI analysis first
  if (ANTHROPIC_API_KEY) {
    try {
      return await aiAnalyze(transcript, assistantName);
    } catch (err) {
      console.warn('AI case analysis failed, falling back to keyword-based:', err);
    }
  }

  // Fallback: keyword-based analysis
  return keywordAnalyze(transcript, assistantName);
}

/**
 * AI-powered analysis via Claude Sonnet
 */
async function aiAnalyze(transcript: string, assistantName: string): Promise<ICaseAnalysis> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: `Analyze this customer support chat transcript and return a JSON object. The chat is from an AI assistant named "${assistantName}".

TRANSCRIPT:
${transcript.substring(0, 4000)}

Return ONLY valid JSON with these exact keys:
{
  "subject": "A concise 8-12 word subject line describing the user's specific issue",
  "priority": "Low or Medium or High or Critical",
  "category": "Bug or Question or Feature Request or Account Issue or Training or Other",
  "summary": "A 2-3 sentence summary of the issue for a human support agent to quickly understand what happened"
}

Priority guidelines:
- Critical: system down, data loss, security issue, all users affected
- High: user blocked from completing work, no workaround available
- Medium: user impacted but has workaround, intermittent issue
- Low: cosmetic issue, general question, feature request`,
      }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
  }

  const data = await res.json() as { content: Array<{ type: string; text: string }> };
  const text = data.content[0]?.text ?? '';

  // Extract JSON from response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON found in AI response');

  const parsed = JSON.parse(jsonMatch[0]) as ICaseAnalysis;

  // Validate required fields
  if (!parsed.subject || !parsed.priority || !parsed.summary) {
    throw new Error('AI response missing required fields');
  }

  return {
    subject: parsed.subject.substring(0, 255),
    priority: (['Low', 'Medium', 'High', 'Critical'].includes(parsed.priority) ? parsed.priority : 'Medium') as ICaseAnalysis['priority'],
    category: parsed.category || 'Other',
    summary: parsed.summary.substring(0, 1000),
  };
}

/**
 * Keyword-based priority suggestion (fallback).
 * Borrowed from SupportCaseEngine.suggestPriority()
 */
function keywordAnalyze(transcript: string, assistantName: string): ICaseAnalysis {
  const lower = transcript.toLowerCase();

  let priority: ICaseAnalysis['priority'] = 'Medium';
  if (
    lower.includes('cannot access') ||
    lower.includes('system down') ||
    lower.includes('critical') ||
    lower.includes('emergency') ||
    lower.includes('data loss') ||
    lower.includes('security')
  ) {
    priority = 'Critical';
  } else if (
    lower.includes('blocking') ||
    lower.includes('unable to') ||
    lower.includes('broken') ||
    lower.includes('not working') ||
    lower.includes('error')
  ) {
    priority = 'High';
  } else if (
    lower.includes('workaround') ||
    lower.includes('sometimes') ||
    lower.includes('intermittent') ||
    lower.includes('slow')
  ) {
    priority = 'Medium';
  } else if (
    lower.includes('question') ||
    lower.includes('how do i') ||
    lower.includes('feature request') ||
    lower.includes('suggestion')
  ) {
    priority = 'Low';
  }

  // Extract a basic subject from the first user message
  const firstUserMsg = transcript.split('\n').find(l => l.startsWith('[user]:'));
  const userText = firstUserMsg?.replace(/^\[user\]:\s*/, '').substring(0, 80) ?? 'Support request';
  const subject = `${assistantName}: ${userText}`;

  return {
    subject: subject.substring(0, 255),
    priority,
    category: 'Other',
    summary: `User contacted ${assistantName} and requested escalation to a human agent after ${Math.ceil(transcript.split('\n').length / 2)} exchanges.`,
  };
}
