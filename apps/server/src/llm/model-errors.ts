import { AppError } from '../errors.js';

/** Provider details stay out of persisted errors; only stable categories escape. */
export function modelResponseError(stopReason: string, detail = ''): AppError {
  if (stopReason === 'aborted') return AppError.of(504, 'LLM_TIMEOUT');
  if (stopReason === 'length') return AppError.of(502, 'LLM_OUTPUT_TRUNCATED');
  if (/\b(401|403)\b|unauthorized|invalid.{0,15}api.?key|authentication failed/i.test(detail)) {
    return new AppError(401, 'LLM_AUTH_FAILED', '模型身份验证失败，请检查密钥');
  }
  if (/\b400\b|model.{0,30}not found|unknown model/i.test(detail)) {
    return new AppError(400, 'LLM_REQUEST_INVALID', '模型配置或请求参数无效');
  }
  return AppError.of(502, 'LLM_UNAVAILABLE');
}
