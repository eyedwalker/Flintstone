# AI App Training Architecture: Automated Screen Analysis

## Overview

This document describes an architecture for automatically training the AI assistant on application screens using **Playwright** (headless browser automation) and **Claude Vision** (screenshot analysis). Instead of manually documenting each URL/screen, a crawler visits every screen, captures screenshots and DOM metadata, then uses Claude to produce structured knowledge base documents.

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Route/Sitemap   │────▶│  Playwright      │────▶│  Claude Vision   │
│  Configuration   │     │  Crawler         │     │  Analyzer        │
└─────────────────┘     │                  │     │                  │
                        │  Per page:       │     │  Per screenshot: │
                        │  - Screenshot    │     │  - Screen purpose│
                        │  - Page title    │     │  - User tasks    │
                        │  - Breadcrumb    │     │  - UI elements   │
                        │  - Form fields   │     │  - Workflows     │
                        │  - Button labels │     │  - Help topics   │
                        │  - Visible text  │     └────────┬─────────┘
                        └──────────────────┘              │
                                                          ▼
                        ┌──────────────────┐     ┌─────────────────┐
                        │  Bedrock KB      │◀────│  Document        │
                        │  Ingestion       │     │  Generator       │
                        │                  │     │                  │
                        │  - S3 upload     │     │  - One doc/screen│
                        │  - Data source   │     │  - Structured    │
                        │  - Sync/ingest   │     │  - KB-optimized  │
                        └──────────────────┘     └─────────────────┘
```

## Components

### 1. Route Configuration (`crawl-config.json`)

A JSON file listing all URLs to crawl, organized by module:

```json
{
  "baseUrl": "https://encompass.eyefinity.com",
  "auth": {
    "loginUrl": "/login",
    "officeId": "ENV:CRAWL_OFFICE_ID",
    "username": "ENV:CRAWL_USERNAME",
    "password": "ENV:CRAWL_PASSWORD"
  },
  "routes": [
    {
      "path": "/home",
      "module": "Front Office",
      "name": "Home Dashboard",
      "requiresPatient": false
    },
    {
      "path": "/patient/{id}/demographics",
      "module": "Patient Management",
      "name": "Patient Demographics",
      "requiresPatient": true
    }
  ]
}
```

### 2. Playwright Crawler (`crawl-app.ts`)

Key responsibilities:
- **Authentication**: Log in once, reuse session cookies across pages
- **Navigation**: Visit each URL, wait for page load (network idle + DOM stable)
- **Data capture per page**:
  - Full-page screenshot (PNG)
  - `document.title`
  - Breadcrumb text (from `nav[aria-label="breadcrumb"]` or `.breadcrumb`)
  - All visible form labels and input types
  - All button labels
  - All link text
  - Table headers (if tables present)
  - Modal/dialog content (if any open by default)
- **Patient context**: For screens requiring a patient, navigate to a test patient first
- **Output**: JSON manifest + screenshots directory

```typescript
interface CrawlResult {
  url: string;
  module: string;
  screenName: string;
  pageTitle: string;
  breadcrumb: string;
  screenshotPath: string;
  formFields: { label: string; type: string; required: boolean }[];
  buttons: string[];
  links: string[];
  tableHeaders: string[][];
  visibleText: string; // first 2000 chars of visible text
  timestamp: string;
}
```

### 3. Claude Vision Analyzer (`analyze-screens.ts`)

For each crawled page, sends the screenshot + DOM metadata to Claude:

```typescript
const prompt = `You are analyzing a screen from the Encompass/Eyefinity eye care practice management application.

Screenshot of the "${result.screenName}" screen is attached.

Additional page metadata:
- URL: ${result.url}
- Page Title: ${result.pageTitle}
- Breadcrumb: ${result.breadcrumb}
- Form Fields: ${JSON.stringify(result.formFields)}
- Buttons: ${result.buttons.join(', ')}

Please provide a structured analysis:

1. SCREEN PURPOSE: What is this screen used for? (1-2 sentences)
2. KEY FEATURES: List the main features and capabilities visible on this screen.
3. COMMON USER TASKS: What tasks would a user typically perform here? List 3-5 tasks.
4. STEP-BY-STEP WORKFLOWS: For the most common task, describe the steps.
5. NAVIGATION: How does the user typically get to this screen?
6. RELATED SCREENS: What other screens might the user navigate to from here?
7. TIPS: Any best practices or important notes for using this screen.`;
```

**Model**: Claude Sonnet (cost-effective for vision analysis at scale)
**Rate limiting**: 5 requests/minute to avoid API throttling
**Cost estimate**: ~$0.05-0.10 per screen analysis

### 4. Document Generator (`generate-docs.ts`)

Converts Claude analysis into KB-optimized text documents:

```
ENCOMPASS SCREEN: Patient Demographics
URL PATTERN: /patient/{id}/demographics
MODULE: Patient Management
BREADCRUMB: Home > Patient > Demographics

PURPOSE:
The Patient Demographics screen is used to view and edit patient contact information,
personal details, and communication preferences.

KEY FEATURES:
- Edit patient name, address, phone, email
- Set communication preferences (text, phone, email)
- Upload patient photo
- Merge duplicate patient records
...

COMMON USER TASKS:
1. Update patient address after a move
2. Add or change patient phone number
3. Set text message preferences for appointment reminders
...
```

One `.txt` file per screen, uploaded to: `s3://wubba-data-sources/{tenantId}/{assistantId}/screen-analysis/`

### 5. Ingestion Pipeline

Reuses existing KB infrastructure:
1. Upload generated docs to S3
2. Create a data source on the KB pointing to the `screen-analysis/` prefix
3. Start ingestion job
4. Verify indexing (should be 0 failures with our nonFilterableMetadataKeys fix)

## Implementation Plan

### Phase 1: Manual Validation (Current)
- Hand-crafted URL mapping document (completed)
- Validate that the agent uses screen context effectively
- Refine the document structure based on real user interactions

### Phase 2: Crawler MVP
- Playwright script targeting 10-20 key screens
- Claude analysis of screenshots
- Compare generated docs against manual mapping for quality
- Estimated effort: 2-3 days

### Phase 3: Full Coverage
- Expand to all ~150 screens
- Add support for state-dependent screens (modals, dropdowns, tabs)
- Schedule periodic re-crawls to catch UI changes
- Estimated effort: 1-2 weeks

### Phase 4: Continuous Training
- Integrate with CI/CD — trigger re-crawl on app releases
- Diff detection — only re-analyze screens that changed
- Version history for screen documentation
- Alert on significant UI changes

## Technology Stack

| Component | Technology | Reason |
|-----------|-----------|--------|
| Crawler | Playwright (Node.js) | Best cross-browser support, handles SPAs well |
| Vision AI | Claude Sonnet via Anthropic API | Excellent vision understanding, cost-effective |
| Storage | S3 | Already used for KB data sources |
| Orchestration | Node.js script (or Lambda) | Can run locally or serverless |
| KB Ingestion | Bedrock Knowledge Base API | Existing infrastructure |

## Cost Estimates

| Item | Per Screen | 150 Screens |
|------|-----------|-------------|
| Claude Vision analysis | ~$0.08 | ~$12 |
| S3 storage | negligible | negligible |
| Bedrock KB ingestion | included | included |
| **Total per full crawl** | | **~$12-15** |

Re-crawls with diff detection would only analyze changed screens, reducing ongoing costs.

## Prerequisites

1. Test account credentials for Encompass (read-only access sufficient)
2. Anthropic API key for Claude Vision calls
3. List of all application routes/URLs (can be extracted from app router config)
4. A test patient record to use for patient-context screens

## Security Considerations

- Crawler credentials stored in environment variables, never committed
- Screenshots may contain PHI — store temporarily, delete after analysis
- Generated documents should be reviewed before KB ingestion
- Use a dedicated test/demo account, not production credentials
- Rate-limit API calls to avoid service disruption
