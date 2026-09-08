import { describe, expect, it } from 'vitest';
import { ERROR_MESSAGES } from '../src/errors.js';

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
    expect(ERROR_MESSAGES.RRULE_DUE_REQUIRED).toBe('设置重复需要截止日期');
    expect(ERROR_MESSAGES.LIST_NOT_FOUND).toBe('清单不存在');
    expect(ERROR_MESSAGES.TAG_NOT_FOUND).toBe('标签不存在');
    expect(ERROR_MESSAGES.INBOX_NOT_FOUND).toBe('条目不存在');
    expect(ERROR_MESSAGES.REPORT_NOT_FOUND).toBe('报告不存在');
    expect(ERROR_MESSAGES.REPORT_REVISION_CONFLICT).toBe('报告已被更新，请先同步');
    expect(ERROR_MESSAGES.CHANNEL_NOT_FOUND).toBe('通知渠道不存在');
    expect(ERROR_MESSAGES.CHANNEL_DELIVERY_FAILED).toBe('通知发送失败');
    expect(ERROR_MESSAGES.MEOW_NICKNAME_INVALID).toBe('MeoW 昵称不合法');
    expect(ERROR_MESSAGES.AUTH_CODE_INVALID).toBe('授权码无效或已过期');
    expect(ERROR_MESSAGES.LLM_NOT_CONFIGURED).toBe('还没有配置大模型');
    expect(ERROR_MESSAGES.LLM_UNAVAILABLE).toBe(
      '大模型暂时不可用，请检查 API Base、密钥和模型名称',
    );
  });
});
