import { APIGatewayProxyResultV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

/** Narrow APIGatewayProxyResultV2 to the structured version for assertions */
export function asResult(result: APIGatewayProxyResultV2): APIGatewayProxyStructuredResultV2 {
  if (typeof result === 'string') throw new Error('Unexpected string result');
  return result;
}
