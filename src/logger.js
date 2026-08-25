/** Tiny structured logger — no external dependency. */
const ts = () => new Date().toISOString();

const fmt = (level, msg, meta) => {
  const base = `${ts()} ${level} ${msg}`;
  if (meta && Object.keys(meta).length) {
    try {
      return `${base} ${JSON.stringify(meta)}`;
    } catch {
      return base;
    }
  }
  return base;
};

const logger = {
  info: (msg, meta) => console.log(fmt('INFO ', msg, meta)),
  warn: (msg, meta) => console.warn(fmt('WARN ', msg, meta)),
  error: (msg, meta) => console.error(fmt('ERROR', msg, meta)),
  debug: (msg, meta) => {
    if (process.env.DEBUG) console.log(fmt('DEBUG', msg, meta));
  },
};

export default logger;
