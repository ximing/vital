import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { ERROR_MESSAGES } from '@vital/dto';
import { AppError } from '../errors.js';
import { logger } from '../utils/logger.js';

function send(
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
  details?: unknown,
): void {
  const error = details !== undefined ? { code, message, details } : { code, message };
  void reply.status(status).send({ error });
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | Error, _req: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof ZodError || error.name === 'ZodError') {
      const issues = error instanceof ZodError ? error.issues : undefined;
      send(reply, 400, 'VALIDATION_ERROR', ERROR_MESSAGES.VALIDATION_ERROR, issues);
      return;
    }
    if (error instanceof AppError) {
      send(reply, error.status, error.code, error.message, error.details);
      return;
    }
    const statusCode = 'statusCode' in error ? error.statusCode : undefined;
    if (statusCode === 429) {
      logger.info('rate_limited_total');
      send(reply, 429, 'RATE_LIMITED', ERROR_MESSAGES.RATE_LIMITED);
      return;
    }
    const code = 'code' in error ? error.code : undefined;
    if (statusCode === 413 || code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      send(reply, 413, 'VALIDATION_ERROR', ERROR_MESSAGES.VALIDATION_ERROR);
      return;
    }
    if (statusCode === 400 || error.name === 'FastifyError') {
      if (code === 'FST_ERR_CTP_INVALID_JSON' || code === 'FST_ERR_VALIDATION') {
        send(reply, 400, 'VALIDATION_ERROR', ERROR_MESSAGES.VALIDATION_ERROR);
        return;
      }
    }
    logger.error('unhandled error', error);
    send(reply, 500, 'INTERNAL_ERROR', ERROR_MESSAGES.INTERNAL_ERROR);
  });

  app.setNotFoundHandler((_req, reply) => {
    send(reply, 404, 'NOT_FOUND', ERROR_MESSAGES.NOT_FOUND);
  });
}
