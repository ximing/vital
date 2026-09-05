import {
  changePasswordInputSchema,
  loginInputSchema,
  refreshInputSchema,
  registerInputSchema,
  updateMeInputSchema,
  updateOnboardingInputSchema,
  type AuthMode,
} from '@vital/dto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { AppError } from '../errors.js';
import { requireAuth } from '../plugins/auth.js';
import {
  limitChangePassword,
  limitLogin,
  limitRefresh,
  limitRegister,
} from '../plugins/rate-limit.js';
import {
  changePassword,
  getProfile,
  loginUser,
  registerUser,
  updateMe,
  updateOnboarding,
} from './auth.service.js';
import {
  clearRefreshCookie,
  deviceInfoFrom,
  isCookieMode,
  readRefreshCookie,
  setRefreshCookie,
} from './cookies.js';
import { rotateRefreshToken, revokeRefreshToken, signAccessToken } from './token.service.js';

function modeOf(req: FastifyRequest): AuthMode {
  return isCookieMode(req) ? 'cookie' : 'bearer';
}

function resolveRefreshRaw(
  req: FastifyRequest,
): { raw: string; expectedMode: AuthMode } | undefined {
  const cookieRaw = readRefreshCookie(req);
  if (cookieRaw !== undefined) {
    return { raw: cookieRaw, expectedMode: 'cookie' };
  }
  const body = refreshInputSchema.parse(req.body ?? {});
  if (body.refreshToken === undefined) return undefined;
  return { raw: body.refreshToken, expectedMode: 'bearer' };
}

export function registerAuthRoutes(app: FastifyInstance): void {
  app.post('/api/v1/auth/register', { preHandler: [limitRegister] }, async (req, reply) => {
    const input = registerInputSchema.parse(req.body);
    const mode = modeOf(req);
    const { response, refreshToken } = await registerUser(input, mode, deviceInfoFrom(req));
    if (mode === 'cookie') setRefreshCookie(reply, refreshToken);
    return reply.code(201).send(response);
  });

  app.post('/api/v1/auth/login', { preHandler: [limitLogin] }, async (req, reply) => {
    const input = loginInputSchema.parse(req.body);
    const mode = modeOf(req);
    const { response, refreshToken } = await loginUser(input, mode, deviceInfoFrom(req));
    if (mode === 'cookie') setRefreshCookie(reply, refreshToken);
    return reply.send(response);
  });

  app.post('/api/v1/auth/refresh', { preHandler: [limitRefresh] }, async (req, reply) => {
    const resolved = resolveRefreshRaw(req);
    if (!resolved) throw AppError.of(401, 'INVALID_TOKEN');
    try {
      const rotated = await rotateRefreshToken(resolved.raw, resolved.expectedMode);
      const user = await getProfile(rotated.userId);
      const accessToken = signAccessToken(rotated.userId);
      if (resolved.expectedMode === 'cookie') {
        setRefreshCookie(reply, rotated.refreshToken);
        return await reply.send({
          user,
          tokens: { accessToken, expiresIn: config.ACCESS_TOKEN_TTL_SECONDS },
        });
      }
      return await reply.send({
        user,
        tokens: {
          accessToken,
          refreshToken: rotated.refreshToken,
          expiresIn: config.ACCESS_TOKEN_TTL_SECONDS,
        },
      });
    } catch (err) {
      clearRefreshCookie(reply);
      throw err;
    }
  });

  app.post('/api/v1/auth/logout', async (req: FastifyRequest, reply: FastifyReply) => {
    const resolved = resolveRefreshRaw(req);
    if (resolved) await revokeRefreshToken(resolved.raw);
    clearRefreshCookie(reply);
    return reply.code(204).send();
  });

  app.get('/api/v1/auth/me', { preHandler: [requireAuth] }, async (req) => {
    // requireAuth guarantees req.user
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    return getProfile(user.id);
  });

  app.patch('/api/v1/auth/me', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    return updateMe(user.id, updateMeInputSchema.parse(req.body));
  });

  app.patch('/api/v1/auth/onboarding', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    return updateOnboarding(user.id, updateOnboardingInputSchema.parse(req.body));
  });

  app.post(
    '/api/v1/auth/change-password',
    { preHandler: [limitChangePassword, requireAuth] },
    async (req, reply) => {
      const user = req.user;
      if (!user) throw AppError.of(401, 'INVALID_TOKEN');
      await changePassword(user.id, changePasswordInputSchema.parse(req.body));
      clearRefreshCookie(reply);
      return reply.code(204).send();
    },
  );
}
