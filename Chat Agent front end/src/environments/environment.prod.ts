export const environment = {
  production: true,
  appName: 'Bedrock Chat Configurator',

  // REPLACE_BEFORE_DEPLOY: Use the prod API Gateway URL from `sam deploy` output
  apiBaseUrl: 'REPLACE_BEFORE_DEPLOY',
  widgetCdnUrl: 'https://d3srbl2yqx3tra.cloudfront.net/assets/aws-agent-chat.min.js',
  // REPLACE_BEFORE_DEPLOY: Same as apiBaseUrl for prod
  chatApiBaseUrl: 'REPLACE_BEFORE_DEPLOY',

  aws: {
    // REPLACE_BEFORE_DEPLOY: Region where your prod Cognito pool is deployed
    region: 'us-east-1',
    // REPLACE_BEFORE_DEPLOY: From `sam deploy` output CognitoUserPoolId
    cognitoUserPoolId: 'REPLACE_BEFORE_DEPLOY',
    // REPLACE_BEFORE_DEPLOY: From `sam deploy` output CognitoClientId
    cognitoClientId: 'REPLACE_BEFORE_DEPLOY',
  },

  stripe: {
    // REPLACE_BEFORE_DEPLOY: Stripe live publishable key from dashboard
    publishableKey: 'REPLACE_BEFORE_DEPLOY',
    // REPLACE_BEFORE_DEPLOY: Stripe live price IDs from dashboard
    starterMonthlyPriceId: 'REPLACE_BEFORE_DEPLOY',
    starterYearlyPriceId: 'REPLACE_BEFORE_DEPLOY',
    proMonthlyPriceId: 'REPLACE_BEFORE_DEPLOY',
    proYearlyPriceId: 'REPLACE_BEFORE_DEPLOY',
  },
};
