/**
 * Report Delivery Service
 *
 * Delivers generated reports via email (SES) and SMS (Twilio).
 * HIPAA-compliant: only sends secure download links, never PHI.
 */

import { sendEmail, sendSms } from './integrations';
import type { IReportSchedule } from './report-scheduler';

const DOWNLOAD_BASE = process.env['REPORT_BUCKET']
  ? `https://${process.env['CDN_DOMAIN'] || 'd27xjsxupy2iu2.cloudfront.net'}`
  : '';

export interface IDeliveryResults {
  email?: Array<{ to: string; success: boolean; messageId?: string; error?: string }>;
  sms?: Array<{ to: string; success: boolean; messageId?: string; error?: string }>;
}

export async function deliverReport(
  schedule: IReportSchedule,
  reportUrl: string,
): Promise<IDeliveryResults> {
  const results: IDeliveryResults = {};

  if (!reportUrl) {
    console.warn(`No report URL for schedule ${schedule.id}, skipping delivery`);
    return results;
  }

  // Email delivery
  if (schedule.delivery.email?.recipients?.length) {
    const subject = schedule.delivery.email.subject || `Report Ready: ${schedule.name}`;
    const htmlBody = buildEmailHtml(schedule.name, reportUrl);
    const textBody = buildEmailText(schedule.name, reportUrl);

    results.email = [];
    for (const to of schedule.delivery.email.recipients) {
      const res = await sendEmail(schedule.tenantId, to, subject, textBody, htmlBody);
      results.email.push({
        to,
        success: res.success,
        messageId: res.messageId,
        error: res.error,
      });
    }
  }

  // SMS delivery
  if (schedule.delivery.sms?.recipients?.length) {
    const message = `Your report "${schedule.name}" is ready. Download: ${reportUrl}`;
    results.sms = [];
    for (const to of schedule.delivery.sms.recipients) {
      const res = await sendSms(schedule.tenantId, to, message);
      results.sms.push({
        to,
        success: res.success,
        messageId: res.messageId,
        error: res.error,
      });
    }
  }

  return results;
}

function buildEmailHtml(reportName: string, downloadUrl: string): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: #0066cc; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
    <h2 style="margin: 0;">📊 Scheduled Report Ready</h2>
  </div>
  <div style="background: #f8f9fa; padding: 20px; border: 1px solid #dee2e6; border-top: none; border-radius: 0 0 8px 8px;">
    <p>Your scheduled report <strong>${escapeHtml(reportName)}</strong> has been generated and is ready for download.</p>
    <p style="text-align: center; margin: 24px 0;">
      <a href="${escapeHtml(downloadUrl)}"
         style="display: inline-block; background: #0066cc; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600;">
        Download Report
      </a>
    </p>
    <p style="color: #6c757d; font-size: 13px;">
      This link provides access to your report file. Reports are retained for 7 days.
    </p>
    <hr style="border: none; border-top: 1px solid #dee2e6; margin: 16px 0;">
    <p style="color: #6c757d; font-size: 12px;">
      This is an automated message from Encompass Assist. Do not reply to this email.
    </p>
  </div>
</body>
</html>`.trim();
}

function buildEmailText(reportName: string, downloadUrl: string): string {
  return [
    `Scheduled Report Ready: ${reportName}`,
    '',
    `Your scheduled report "${reportName}" has been generated.`,
    '',
    `Download: ${downloadUrl}`,
    '',
    'Reports are retained for 7 days.',
    '',
    '— Encompass Assist',
  ].join('\n');
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
