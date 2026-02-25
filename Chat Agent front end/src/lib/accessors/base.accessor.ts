import { IAccessorResult } from '../models/tenant.model';

/**
 * Base class for all VBD accessors.
 * Provides standard error handling and result wrapping.
 */
export abstract class BaseAccessor {
  /**
   * Wraps an AWS SDK call with standard error handling.
   * @param operation - Async function performing the AWS call
   */
  protected async execute<T>(operation: () => Promise<T>): Promise<IAccessorResult<T>> {
    try {
      const data = await operation();
      return { success: true, data };
    } catch (err: unknown) {
      return this.handleError<T>(err);
    }
  }

  /**
   * Maps AWS SDK errors to standard accessor results.
   */
  private handleError<T>(err: unknown): IAccessorResult<T> {
    const error = err as Record<string, unknown>;
    const name = error?.['name'] as string | undefined;
    const message = (error?.['message'] as string) ?? 'Unknown error';

    const statusMap: Record<string, number> = {
      AccessDeniedException: 403,
      ResourceNotFoundException: 404,
      ThrottlingException: 429,
      ValidationException: 400,
      ConflictException: 409,
      ServiceQuotaExceededException: 402,
    };

    return {
      success: false,
      error: message,
      statusCode: name ? (statusMap[name] ?? 500) : 500,
    };
  }
}
