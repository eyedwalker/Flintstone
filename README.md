# Flintstone — Bedrock Chat Configurator

A multi-tenant AI chat assistant platform built on AWS Bedrock, Angular 17, and AWS Lambda.

## Structure

```
├── Chat Agent backend/    # AWS SAM + Node.js Lambda API
└── Chat Agent front end/  # Angular 17 admin dashboard
```

## Backend

- **Runtime**: Node.js 20 on AWS Lambda (arm64)
- **API**: AWS HTTP API Gateway v2 with Cognito JWT auth
- **Storage**: DynamoDB (7 tables), S3, S3 Vectors
- **AI**: Amazon Bedrock Agents + Knowledge Bases (S3 Vectors vector store)

### Deploy
```bash
cd "Chat Agent backend"
npm install && npm run build
sam deploy --profile <your-aws-profile>
```

## Frontend

- **Framework**: Angular 17 with Angular Material
- **Auth**: AWS Cognito via custom `CognitoAccessor`
- **API**: All AWS calls proxied through `ApiService` → API Gateway

### Run locally
```bash
cd "Chat Agent front end"
npm install
npx ng serve
```

## Environment

Update `Chat Agent front end/src/environments/environment.ts` with your deployed API URL and Cognito IDs from the SAM stack outputs.
