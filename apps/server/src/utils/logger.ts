type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function parseLevel(value: string | undefined): Level {
  if (value === 'debug' || value === 'info' || value === 'warn' || value === 'error') return value;
  return 'info';
}

const minLevel = LEVELS[parseLevel(process.env.LOG_LEVEL)];

function serializeMeta(meta: unknown): unknown {
  if (meta instanceof Error) {
    const extra = Object.fromEntries(
      Object.entries(meta).filter(([k]) => k !== 'name' && k !== 'message' && k !== 'stack'),
    );
    return {
      name: meta.name,
      message: meta.message,
      stack: meta.stack,
      ...extra,
    };
  }
  return meta;
}

function emit(level: Level, msg: string, meta?: unknown): void {
  if (LEVELS[level] < minLevel) return;
  const entry = {
    time: new Date().toISOString(),
    level,
    msg,
    ...(meta !== undefined ? { meta: serializeMeta(meta) } : {}),
  };
  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else console.log(line);
}

export const logger = {
  debug: (msg: string, meta?: unknown) => {
    emit('debug', msg, meta);
  },
  info: (msg: string, meta?: unknown) => {
    emit('info', msg, meta);
  },
  warn: (msg: string, meta?: unknown) => {
    emit('warn', msg, meta);
  },
  error: (msg: string, meta?: unknown) => {
    emit('error', msg, meta);
  },
};
