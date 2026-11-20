import { ArgumentsHost, Catch, HttpException, Logger, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';

const isOverload = (e: unknown): boolean => {
  for (let x: unknown = e, i = 0; x && i < 5; x = (x as { cause?: unknown }).cause, i++)
    if (x instanceof Error && /timeout exceeded when trying to connect/i.test(x.message)) return true;
  return false;
};

/** Uniform error body; internal errors never leak details to the client. */
@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  private readonly log = new Logger('HttpError');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const payload = typeof body === 'string' ? { message: body } : (body as Record<string, unknown>);
      res.status(status).json({ statusCode: status, ...payload });
      return;
    }
    // Overload (no free database connection in time): temporary – the app retries automatically.
    if (isOverload(exception)) {
      this.log.warn('database pool exhausted – answering 503');
      res.setHeader('Retry-After', '5');
      res
        .status(503)
        .json({ statusCode: 503, message: 'Server ausgelastet – wird automatisch erneut versucht' });
      return;
    }
    this.log.error(exception instanceof Error ? exception.stack : String(exception));
    if (process.env.DEBUG_ERRORS) console.error(exception);
    res.status(500).json({ statusCode: 500, message: 'Interner Fehler' });
  }
}
