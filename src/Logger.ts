import 'isomorphic-fetch';
declare global {
  interface Window {
    __kersplunkSingleton?: Logger;
  }
}

export type SplunkMeta = {
  time?: number; // epoch time
  host?: string;
  source?: string;
  sourcetype?: string;
  index?: string;
};

export type SplunkMetaFactory = () => SplunkMeta;
export type BeforeLogHook = (originalDetails: undefined | object) => undefined | object;
export type CustomLogger<TLogTypes extends string> =
  Logger
  & Record<TLogTypes, (eventName: string, details?: object) => void>;

type CoreLoggerConfiguration = {
  splunkUrl: string;
  authToken: string;
  maxBuffer: number;
  throttleDuration: number;
  splunkMeta?: SplunkMeta | SplunkMetaFactory;
  beforeLog?: BeforeLogHook;
  autoRetry: boolean;
  autoRetryDuration?: number;
};

const DEFAULT_CONFIG = {
  maxBuffer: 50,
  throttleDuration: 250,
  autoRetry: true,
  autoRetryDuration: 1000,
};

const DEFAULT_LOG_TYPES = [
  'debug' as 'debug',
  'info' as 'info',
  'warn' as 'warn',
  'error' as 'error',
];

// Only require the user to supply values that are not
// part of the DEFAULT_CONFIG
export type LoggerConfiguration =
  Partial<Pick<CoreLoggerConfiguration, keyof typeof DEFAULT_CONFIG>>
  & Pick<CoreLoggerConfiguration, Exclude<keyof CoreLoggerConfiguration, keyof typeof DEFAULT_CONFIG>>;

export type DefaultLogger = CustomLogger<(typeof DEFAULT_LOG_TYPES)[number]>;

export class Logger {
  public static singleton<TLogTypes extends string[]>(
    config: LoggerConfiguration,
    ...logTypes: TLogTypes
  ): TLogTypes[number] extends never ? DefaultLogger : CustomLogger<TLogTypes[number]> {
    window.__kersplunkSingleton = window.__kersplunkSingleton
      || Logger.custom(config, ...(logTypes.length ? logTypes : DEFAULT_LOG_TYPES));

    return window.__kersplunkSingleton as any;
  }

  public static custom<TLogTypes extends string[]>(
    config: LoggerConfiguration,
    ...logTypes: TLogTypes
  ): TLogTypes[number] extends never ? DefaultLogger : CustomLogger<TLogTypes[number]> {
    const logger = new Logger(config);

    Object.assign(logger, logTypes.reduce((acc, name) => ({
      ...acc,
      [name]: (eventName: string, details?: object) => logger.log(name, eventName, details),
    }), {}));

    return logger as any;
  }

  public static clearSingleton() {
    window.__kersplunkSingleton = undefined;
  }

  private _config: CoreLoggerConfiguration;
  private _buffer: string[] = [];
  private _bufferTimeout?: NodeJS.Timeout;

  constructor(config: LoggerConfiguration) {
    this._config = {...DEFAULT_CONFIG, ...config};
  }

  public log(logType: string, eventName: string, details?: object) {
    const finalDetails = this._config.beforeLog ? this._config.beforeLog(details) : details;
    this._buffer = [
      ...this._buffer,
      JSON.stringify({
        time: Date.now() / 1000,
        sourcetype: '_json',
        ...(typeof this._config.splunkMeta === 'function' ? this._config.splunkMeta() : this._config.splunkMeta),
        event: {
          logType,
          eventName,
          ...finalDetails,
        },
      }),
    ];
    this._startOrResetBufferTimeout();
    if (this._buffer.length >= this._config.maxBuffer) {
      this.flush();
    }
  }

  public async flush() {
    this._clearBufferTimeout();
    if (this._buffer.length === 0) {
      return;
    }
    const body = this._buffer.join('\n');
    this._buffer = [];
    await this._flushBodyWithRetry(body);
  }

  private async _flushBodyWithRetry(body: string) {
    try {
      await fetch( this._config.splunkUrl, {
        method: 'POST',
        headers: {Authorization: `Splunk ${this._config.authToken}`},
        body,
      });
    } catch (e) {
      if (this._config.autoRetry) {
        setTimeout(() => this._flushBodyWithRetry(body), this._config.autoRetryDuration);
      }
    }
  }

  private _startOrResetBufferTimeout() {
    if (this._bufferTimeout) {
      clearTimeout(this._bufferTimeout);
    }
    this._bufferTimeout = setTimeout(() => this.flush(), this._config.throttleDuration);
  }

  private _clearBufferTimeout() {
    if (this._bufferTimeout) {
      clearTimeout(this._bufferTimeout);
      this._bufferTimeout = undefined;
    }
  }
}
