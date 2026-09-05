import { describe, expect, it } from 'vitest';
import { ERROR_MESSAGES } from './errors.js';

describe('ERROR_MESSAGES', () => {
  it('covers the spec table plus PR2 extras', () => {
    expect(ERROR_MESSAGES.VALIDATION_ERROR).toBe('请求参数不合法');
    expect(ERROR_MESSAGES.NOT_FOUND).toBe('资源不存在');
    expect(ERROR_MESSAGES.INVALID_CREDENTIALS).toBe('邮箱或密码错误');
    expect(ERROR_MESSAGES.INVALID_TOKEN).toBe('登录已过期');
    expect(ERROR_MESSAGES.RATE_LIMITED).toBe('请求过于频繁，请稍后再试');
    expect(ERROR_MESSAGES.MEDIA_MISMATCH).toBe('上传文件与声明不符');
    expect(ERROR_MESSAGES.INTERNAL_ERROR).toBe('服务器内部错误');
    expect(ERROR_MESSAGES.INVALID_OLD_PASSWORD).toBe('原密码错误');
    expect(ERROR_MESSAGES.EMAIL_ALREADY_REGISTERED).toBe('邮箱已注册');
    expect(ERROR_MESSAGES.ATTACHMENT_NOT_FOUND).toBe('附件不存在');
  });
});
