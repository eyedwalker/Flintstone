export const environment = {
  production: true,
  appName: 'Bedrock Chat Configurator',
  apiBaseUrl: 'https://your-api-id.execute-api.us-east-1.amazonaws.com', // fill in after sam deploy
  widgetCdnUrl: 'https://your-cdn.cloudfront.net/aws-agent-chat.min.js',
  chatApiBaseUrl: 'https://your-api-id.execute-api.us-east-1.amazonaws.com/Prod',

  aws: {
    region: 'us-east-1',
    cognitoUserPoolId: 'us-east-1_PROD_POOL_ID',
    cognitoClientId: 'PROD_CLIENT_ID',
  },

  stripe: {
    publishableKey: 'pk_live_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    starterMonthlyPriceId: 'price_PROD_STARTER_MONTHLY',
    starterYearlyPriceId: 'price_PROD_STARTER_YEARLY',
    proMonthlyPriceId: 'price_PROD_PRO_MONTHLY',
    proYearlyPriceId: 'price_PROD_PRO_YEARLY',
  },
};
