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
export type LogInterceptor = (originalDetails: undefined | object) => undefined | object;
export type CustomLogger<TLogTypes extends string[]> =
  Logger
  & Record<
    TLogTypes[number] extends never ? (typeof DEFAULT_LOG_TYPES)[number] : TLogTypes[number],
    (eventName: string, details?: object) => void
  >;

type CoreLoggerConfiguration = {
  splunkUrl: string;
  authToken: string;
  maxBuffer: number;
  throttleDuration: number;
  splunkMeta?: SplunkMeta | SplunkMetaFactory;
  interceptor?: LogInterceptor;
  autoRetry: boolean;
  autoRetryDuration: number;
  enabled: boolean;
  logToConsole: boolean;
};

const DEFAULT_CONFIG = {
  maxBuffer: 50,
  throttleDuration: 250,
  autoRetry: true,
  autoRetryDuration: 1000,
  enabled: true,
  logToConsole: false,
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

export class Logger {
  public static singleton<TLogTypes extends string[]>(
    config: LoggerConfiguration,
    ...logTypes: TLogTypes
  ): CustomLogger<TLogTypes> {
    window.__kersplunkSingleton = window.__kersplunkSingleton || Logger.create(config, ...logTypes);

    return window.__kersplunkSingleton as any;
  }

  public static create<TLogTypes extends string[]>(
    config: LoggerConfiguration,
    ...logTypes: TLogTypes
  ): CustomLogger<TLogTypes> {
    const logger = new Logger(config);
    const finalLogTypes: string[] = logTypes.length ? logTypes : DEFAULT_LOG_TYPES;

    Object.assign(logger, finalLogTypes.reduce((acc, logType) => ({
      ...acc,
      [logType]: (eventName: string, details?: object) => logger._log(logType, eventName, details),
    }), {}));

    return logger as any;
  }

  public static clearSingleton() {
    window.__kersplunkSingleton = undefined;
  }

  public interceptor?: LogInterceptor;
  private _config: CoreLoggerConfiguration;
  private _buffer: string[] = [];
  private _bufferTimeout?: NodeJS.Timeout;

  private constructor(config: LoggerConfiguration) {
    this._config = {...DEFAULT_CONFIG, ...config};
    this.interceptor = config.interceptor;
  }

  public enable() {
    this._config.enabled = true;
  }

  public disable() {
    this._config.enabled = false;
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

  private _log(logType: string, eventName: string, details?: object) {
    if (this._config.logToConsole) {
      console.log(logType, eventName, details || ''); // tslint:disable-line no-console
    }
    if (!this._config.enabled) {
      return;
    }
    const event = {
      logType,
      eventName,
      ...details,
    };
    const finalEvent = this.interceptor ? this.interceptor(event) : event;
    this._buffer = [
      ...this._buffer,
      JSON.stringify({
        time: Date.now() / 1000,
        sourcetype: '_json',
        ...(typeof this._config.splunkMeta === 'function' ? this._config.splunkMeta() : this._config.splunkMeta),
        event: finalEvent,
      }),
    ];
    this._startOrResetBufferTimeout();
    if (this._buffer.length >= this._config.maxBuffer) {
      this.flush();
    }
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
