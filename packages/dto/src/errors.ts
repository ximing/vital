export const ERROR_MESSAGES = {
  VALIDATION_ERROR: '请求参数不合法',
  NOT_FOUND: '资源不存在',
  TASK_NOT_FOUND: '任务不存在',
  INBOX_NOT_FOUND: '条目不存在',
  REPORT_NOT_FOUND: '报告不存在',
  INVALID_CREDENTIALS: '邮箱或密码错误',
  INVALID_TOKEN: '登录已过期',
  RATE_LIMITED: '请求过于频繁，请稍后再试',
  REPORT_REVISION_CONFLICT: '报告已被更新，请先同步',
  INTERNAL_ERROR: '服务器内部错误',
  MEDIA_MISMATCH: '上传文件与声明不符',
  RRULE_TOO_DENSE: '重复规则过密',
  RRULE_INVALID: '重复规则不支持',
  RRULE_DUE_REQUIRED: '设置重复需要截止日期',
  COMPLETION_NOT_LATEST: '只能撤销最近一次完成',
  EMAIL_ALREADY_REGISTERED: '邮箱已注册',
  INVALID_OLD_PASSWORD: '原密码错误',
  AUTH_CODE_INVALID: '授权码无效或已过期',
  ATTACHMENT_NOT_FOUND: '附件不存在',
  MEDIA_TOO_LARGE: '文件过大',
  MEDIA_INVALID_STATE: '上传状态不允许此操作',
  MEDIA_PART_INVALID: '分片号不合法',
  MEDIA_PART_MISSING: '缺少分片上传记录',
  LIST_NOT_FOUND: '集合不存在',
  TAG_NOT_FOUND: '标签不存在',
  CHANNEL_NOT_FOUND: '通知渠道不存在',
  CHANNEL_EXISTS: '该类型的通知渠道已存在',
  CHANNEL_TYPE_UNSUPPORTED: '不支持的通知渠道',
  MEOW_NICKNAME_INVALID: 'MeoW 昵称不合法',
  CHANNEL_DELIVERY_FAILED: '通知发送失败',
  LLM_NOT_CONFIGURED: '还没有配置大模型',
  LLM_OUTPUT_TRUNCATED:
    '模型输出被截断，请提高 max_tokens / max_completion_tokens 或降低 reasoning_effort',
  LLM_TIMEOUT: '模型响应超时，请降低推理强度后重试',
  LLM_UNAVAILABLE: '大模型暂时不可用，请检查 API Base、密钥和模型名称',
} as const;

export type ErrorCode = keyof typeof ERROR_MESSAGES;

export interface ErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

export interface ErrorEnvelope {
  error: ErrorBody;
}
