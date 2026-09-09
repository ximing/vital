# 模型调用参数

在「设置 → 模型」填写 OpenAI Chat Completions 兼容接口的 API Base、密钥和模型名称。网页端提供 thinking、reasoning_effort 快捷设置；网页端和移动端都支持编辑完整参数 JSON。参数保存在当前用户配置中，同时用于连接测试和新建任务的意图解析。

GLM-5.3-Flash 可使用：

```json
{
  "thinking": { "type": "enabled" },
  "reasoning_effort": "low",
  "max_tokens": 4096
}
```

GLM-5.3-Flash 强制思考，支持 low、high、max。DeepSeek 等服务商同样可以通过 JSON 设置其支持的参数；具体取值取决于模型，不会根据 API Base 自动转换或移除参数。切换模型后请检查参数并重新保存、测试。

快捷设置只修改对应字段，保留其他 JSON 参数。可添加 temperature、top_p、do_sample 或服务商扩展的嵌套参数。空文本或 `{}` 清空参数；未设置的采样和思考参数不发送，由服务商决定。JSON 编辑错误会阻止保存；有未保存的修改时不能测试旧配置。

参数通过 `PATCH /api/v1/auth/me` 的 `llm.parameters` 整体替换；省略该字段保留原值，`null` 清空。普通用户资料返回参数，但不返回 API 密钥。JSON 最大 16 KB，不能覆盖应用管理的 model、messages、stream、response_format、tools 等字段，也不能放入 API 密钥或请求头。任务解析的 JSON 响应格式由应用设置。

连接测试默认最多生成 1024 token，用户填写的 max_tokens 或 max_completion_tokens 优先，二者不能同时设置。测试和任务调用超时均为 60 秒。输出因 token 预算不足被截断时，会提示增加预算或降低推理强度，不再提示检查密钥。不会把 reasoning_content 当作任务正文。

数据库变更：部署新代码前运行 `pnpm --filter @vital/server migrate`，应用 `0016_llm_parameters.sql`。已有用户的参数默认为 `{}`。

参考：[智谱核心参数](https://docs.bigmodel.cn/cn/guide/start/concept-param#thinking)、[DeepSeek 思考模式](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode/)。
