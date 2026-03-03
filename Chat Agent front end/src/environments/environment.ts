export const environment = {
  production: false,
  appName: 'Bedrock Chat Configurator',
  apiBaseUrl: 'https://2p595psdt1.execute-api.us-west-2.amazonaws.com/dev',
  widgetCdnUrl: 'https://d3srbl2yqx3tra.cloudfront.net/assets/aws-agent-chat.min.js',
  chatApiBaseUrl: 'https://2p595psdt1.execute-api.us-west-2.amazonaws.com/dev',

  aws: {
    region: 'us-west-2',
    cognitoUserPoolId: 'us-west-2_wtRPN8aXd',
    cognitoClientId: '361fvmvoc1siist24u5oojf7bo',
  },

  stripe: {
    publishableKey: 'pk_test_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    starterMonthlyPriceId: 'price_XXXXXXXXXX',
    starterYearlyPriceId: 'price_XXXXXXXXXX',
    proMonthlyPriceId: 'price_XXXXXXXXXX',
    proYearlyPriceId: 'price_XXXXXXXXXX',
  },
};
