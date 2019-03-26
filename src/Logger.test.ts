import 'isomorphic-fetch';
import { Logger, LoggerConfiguration } from './Logger';

type InterceptedLogs = {
  url: string;
  requestConfig: any,
  logs: any[];
};

const interceptLogs = () => {
  const collection: InterceptedLogs[] = [];
  jest.spyOn(window, 'fetch').mockImplementation((urlOrConfig, config) => {
    const url = typeof urlOrConfig === 'string' ? urlOrConfig : urlOrConfig.url;
    const requestConfig = typeof urlOrConfig === 'string' ? config : urlOrConfig;
    const body = requestConfig && requestConfig.body;
    const stringBody = body && body.toString() || 'null';

    collection.push({
      url,
      requestConfig,
      logs: stringBody.split('\n').map((line) => JSON.parse(line)),
    });
    return Promise.resolve({} as any);
  });

  return collection;
};

describe('Logger', () => {
  let logs: InterceptedLogs[];
  const expectToHaveLogged = (...expectedLogs: object[][]) => {
    expect(logs).toEqual(
      expectedLogs.map((log) =>
        expect.objectContaining({
          logs: log.map((groupedLog) => expect.objectContaining({
            event: expect.objectContaining(groupedLog),
          })),
        }),
      ),
    );
  };

  beforeEach(() => {
    logs = interceptLogs();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  const config: LoggerConfiguration = {
    splunkUrl: 'http://my-splunk-endpoint',
    authToken: 'MY-TOKEN',
    maxBuffer: 100,
    throttleDuration: 10000,
  };

  describe('create', () => {
    it('creates a logger with custom log types', async () => {
      const logger = Logger.create(config, 'fooLevel', 'barLevel');
      logger.fooLevel('FOO');
      logger.barLevel('BAR');
      await logger.flush();

      expectToHaveLogged([
        { logType: 'fooLevel', eventName: 'FOO' },
        { logType: 'barLevel', eventName: 'BAR' },
      ]);
    });

    it('creates a logger with the default log types', async () => {
      const logger = Logger.create(config);
      logger.info('FOO');
      logger.debug('BAR');
      await logger.flush();

      expectToHaveLogged([
        { logType: 'info', eventName: 'FOO' },
        { logType: 'debug', eventName: 'BAR' },
      ]);
    });
  });

  describe('singleton', () => {
    afterEach(() => Logger.clearSingleton());

    it('returns the same logger each time', async () => {
      const loggerOne = Logger.singleton(config);
      const loggerTwo = Logger.singleton(config);

      expect(loggerOne).toBe(loggerTwo);
    });

    it('creates the default types', () => {
      const logger = Logger.singleton(config);
      logger.info('fooEvent');
      logger.flush();

      expectToHaveLogged([{logType: 'info', eventName: 'fooEvent'}]);
    });

    it('can create a logger with custom log types', async () => {
      const logger = Logger.singleton(config, 'foo');
      logger.foo('fooEvent');
      await logger.flush();

      expectToHaveLogged([ {logType: 'foo', eventName: 'fooEvent'} ]);
    });
  });

  describe('clearSingleton', () => {
    it('clears the singleton', async () => {
      const loggerOne = Logger.singleton(config);
      Logger.clearSingleton();
      const loggerTwo = Logger.singleton(config);

      expect(loggerOne).not.toBe(loggerTwo);
    });
  });

  describe('flush', () => {
    it('submits to the collector endpoint', async () => {
      const logger = Logger.create({...config, splunkUrl: 'http://foo-bar'});
      logger.info('barEvent', {baz: 'bat'});
      await logger.flush();

      expect(logs).toEqual([
        expect.objectContaining({ url: 'http://foo-bar' }),
      ]);
    });

    it('authenticates with the hecToken', async () => {
      const logger = Logger.create({...config, authToken: 'FOO-TOKEN'});
      logger.info('barEvent', {baz: 'bat'});
      await logger.flush();

      expect(logs[0].requestConfig).toEqual(
        expect.objectContaining({headers: {Authorization: 'Splunk FOO-TOKEN'}}),
      );
    });

    it('does not submit when buffer is empty', async () => {
      const logger = Logger.create({...config, maxBuffer: 2});
      await logger.flush();

      expect(logs.length).toBe(0);
    });
  });

  describe('logging', () => {
    it('serializes the details immediately so later mutations do not affect older logs', async () => {
      const logger = Logger.create(config);
      const details = {foo: 'foo'};
      logger.info('one', details);
      details.foo = 'new foo';
      logger.info('two', details);
      await logger.flush();

      expectToHaveLogged(
        [
          { eventName: 'one', foo: 'foo' },
          { eventName: 'two', foo: 'new foo' },
        ],
      );
    });

    it('incudes static splunkMeta properties', async () => {
      const logger = Logger.create({...config, splunkMeta: {time: 123, host: 'my host'}});
      logger.info('foo');
      await logger.flush();

      expect(logs[0].logs[0]).toEqual(expect.objectContaining({
        time: 123, host: 'my host',
      }));
    });

    it('provides a timestamp with <sec>.<ms> by default', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(12345);
      const logger = Logger.create(config);
      logger.info('foo');
      await logger.flush();

      expect(logs[0].logs[0]).toEqual(expect.objectContaining({
        time: 12.345,
      }));
    });

    it('incudes dynamic splunkMeta properties', async () => {
      const logger = Logger.create({
        ...config,
        splunkMeta: () => ({time: 123, host: 'my host'}),
      });
      logger.info('foo');
      await logger.flush();

      expect(logs[0].logs[0]).toEqual(expect.objectContaining({
        time: 123, host: 'my host',
      }));
    });
  });

  describe('interceptors', () => {
    it('modifies the outgoing log details with intercept return', async () => {
      const logger = Logger.create({
        ...config,
        interceptor: (originalDetails) => ({...originalDetails, newDetails: 'bar'}),
      });
      logger.info('one', {originalDetails: 'foo'});
      await logger.flush();

      expectToHaveLogged([
        {eventName: 'one', originalDetails: 'foo', newDetails: 'bar'},
      ]);
    });

    it('can be set after the logger is created', async () => {
      const logger = Logger.create(config);
      logger.interceptor = (originalDetails) => ({...originalDetails, newDetails: 'bar'});
      logger.info('one', {originalDetails: 'foo'});
      await logger.flush();

      expectToHaveLogged([
        {eventName: 'one', originalDetails: 'foo', newDetails: 'bar'},
      ]);
    });
  });

  describe('buffering', () => {
    it('automatically flushes logs when the buffer is full', () => {
      const logger = Logger.create({...config, maxBuffer: 3});
      logger.info('group1:one');
      logger.info('group1:two');
      logger.info('group1:three');
      // Buffer max hit
      logger.info('group2:four');
      logger.info('group2:five');
      logger.info('group2:six');

      expectToHaveLogged(
        [
          {eventName: 'group1:one'},
          {eventName: 'group1:two'},
          {eventName: 'group1:three'},
        ],
        [
          {eventName: 'group2:four'},
          {eventName: 'group2:five'},
          {eventName: 'group2:six'},
        ],
      );
    });
  });

  describe('throttling', () => {
    it('automatically flushes logs when the the throttleDuration is met', () => {
      const logger = Logger.create({...config, throttleDuration: 2000,  maxBuffer: 3});
      logger.info('one');
      logger.info('two');
      jest.advanceTimersByTime(2001);

      expectToHaveLogged([
        { eventName: 'one' },
        { eventName: 'two' },
      ]);
    });

    it('does not log before the buffer is full or the duration is met', () => {
      const logger = Logger.create({...config, throttleDuration: 2000,  maxBuffer: 3});
      logger.info('nope:one');
      logger.info('nope:two');
      jest.advanceTimersByTime(1000);

      expect(logs.length).toBe(0);
    });

    it('resets the timer when a new log entry is made', () => {
      const logger = Logger.create({...config, throttleDuration: 2000,  maxBuffer: 3});
      logger.info('nope:one');
      jest.advanceTimersByTime(1500);
      logger.info('nope:two');
      jest.advanceTimersByTime(1500);

      expect(logs.length).toBe(0);
    });

    it('resets the timer when flushed', async () => {
      const logger = Logger.create({...config, throttleDuration: 2000,  maxBuffer: 3});
      logger.info('yup:one');
      logger.info('yup:two');
      jest.advanceTimersByTime(1000);
      await logger.flush();
      logger.info('nope:one'); // Should not be logged yet
      jest.advanceTimersByTime(1900);

      expectToHaveLogged([
        { eventName: 'yup:one' },
        { eventName: 'yup:two' },
      ]);
    });
  });

  describe('autoRetry', () => {
    it('retries the flush when fetch fails', async () => {
      const logger = Logger.create({...config, autoRetryDuration: 1000});
      jest.spyOn(window, 'fetch').mockRejectedValueOnce('Oops, no network!');
      logger.info('yup:one');
      await logger.flush();
      logs.length = 0;
      jest.advanceTimersByTime(1000);

      expectToHaveLogged([
        { eventName: 'yup:one' },
      ]);
    });

    it('stops retrying when fetch succeeds', async () => {
      const logger = Logger.create({...config, autoRetryDuration: 1000});
      jest.spyOn(window, 'fetch').mockRejectedValueOnce('Oops, no network!');
      logger.info('yup:one');
      await logger.flush();
      logs.length = 0;
      jest.advanceTimersByTime(1000);
      jest.advanceTimersByTime(1000);
      jest.advanceTimersByTime(1000);

      expectToHaveLogged([
        { eventName: 'yup:one' },
      ]);
    });

    it('does not retry when autoRetry is false', async () => {
      const logger = Logger.create({...config, autoRetry: false, autoRetryDuration: 1000});
      jest.spyOn(window, 'fetch').mockRejectedValueOnce('Oops, no network!');
      logger.info('yup:one');
      await logger.flush();
      logs.length = 0;
      jest.advanceTimersByTime(1000);
      await Promise.resolve();

      expect(logs.length).toBe(0);
    });
  });
});
