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

  describe('custom', () => {
    it('creates a logger with custom log types', async () => {
      const logger = Logger.custom(config, 'fooLevel', 'barLevel');
      logger.fooLevel('FOO');
      logger.barLevel('BAR');
      logger.flush();

      expectToHaveLogged([
        { logType: 'fooLevel', eventName: 'FOO' },
        { logType: 'barLevel', eventName: 'BAR' },
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

    it('can create a logger with custom log types', () => {
      const logger = Logger.singleton(config, 'foo');
      logger.foo('fooEvent');
      logger.flush();

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
      const logger = new Logger({...config, splunkUrl: 'http://foo-bar'});
      logger.log('fooType', 'barEvent', {baz: 'bat'});
      await logger.flush();

      expect(logs).toEqual([
        expect.objectContaining({ url: 'http://foo-bar' }),
      ]);
    });

    it('authenticates with the hecToken', async () => {
      const logger = new Logger({...config, authToken: 'FOO-TOKEN'});
      logger.log('fooType', 'barEvent', {baz: 'bat'});
      await logger.flush();

      expect(logs[0].requestConfig).toEqual(
        expect.objectContaining({headers: {Authorization: 'Splunk FOO-TOKEN'}}),
      );
    });

    it('does not submit when buffer is empty', async () => {
      const logger = new Logger({...config, maxBuffer: 2});
      await logger.flush();

      expect(logs.length).toBe(0);
    });
  });

  describe('log', () => {
    it('serializes the details immediately so later mutations do not affect older logs', async () => {
      const logger = new Logger(config);
      const details = {foo: 'foo'};
      logger.log('group1', 'one', details);
      details.foo = 'new foo';
      logger.log('group1', 'two', details);
      await logger.flush();

      expectToHaveLogged(
        [
          { logType: 'group1', eventName: 'one', foo: 'foo' },
          { logType: 'group1', eventName: 'two', foo: 'new foo' },
        ],
      );
    });

    it('incudes static splunkMeta properties', async () => {
      const logger = new Logger({...config, splunkMeta: {time: 123, host: 'my host'}});
      logger.log('group1', 'one');
      await logger.flush();

      expect(logs[0].logs[0]).toEqual(expect.objectContaining({
        time: 123, host: 'my host',
      }));
    });

    it('provides a timestamp with <sec>.<ms> by default', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(12345);
      const logger = new Logger(config);
      logger.log('group1', 'one');
      await logger.flush();

      expect(logs[0].logs[0]).toEqual(expect.objectContaining({
        time: 12.345,
      }));
    });

    it('incudes dynamic splunkMeta properties', async () => {
      const logger = new Logger({
        ...config,
        splunkMeta: () => ({time: 123, host: 'my host'}),
      });
      logger.log('group1', 'one');
      await logger.flush();

      expect(logs[0].logs[0]).toEqual(expect.objectContaining({
        time: 123, host: 'my host',
      }));
    });
  });

  describe('beforeLog', () => {
    it('modifies the outgoing log details with beforeLog return', async () => {
      const logger = new Logger({
        ...config,
        beforeLog: (originalDetails) => ({...originalDetails, newDetails: 'bar'}),
      });
      logger.log('group1', 'one', {originalDetails: 'foo'});
      await logger.flush();

      expectToHaveLogged([
        {logType: 'group1', eventName: 'one', originalDetails: 'foo', newDetails: 'bar'},
      ]);
    });
  });

  describe('buffering', () => {
    it('automatically flushes logs when the buffer is full', () => {
      const logger = new Logger({...config, maxBuffer: 3});
      logger.log('group1', 'one');
      logger.log('group1', 'two');
      logger.log('group1', 'three');
      // Buffer max hit
      logger.log('group2', 'four');
      logger.log('group2', 'five');
      logger.log('group2', 'six');

      expectToHaveLogged(
        [
          { logType: 'group1', eventName: 'one' },
          { logType: 'group1', eventName: 'two' },
          { logType: 'group1', eventName: 'three' },
        ],
        [
          { logType: 'group2', eventName: 'four' },
          { logType: 'group2', eventName: 'five' },
          { logType: 'group2', eventName: 'six' },
        ],
      );
    });
  });

  describe('throttling', () => {
    it('automatically flushes logs when the the throttleDuration is met', () => {
      const logger = new Logger({...config, throttleDuration: 2000,  maxBuffer: 3});
      logger.log('yup', 'one');
      logger.log('yup', 'two');
      jest.advanceTimersByTime(2001);

      expectToHaveLogged([
        { logType: 'yup', eventName: 'one' },
        { logType: 'yup', eventName: 'two' },
      ]);
    });

    it('does not log before the buffer is full or the duration is met', () => {
      const logger = new Logger({...config, throttleDuration: 2000,  maxBuffer: 3});
      logger.log('nope', 'one');
      logger.log('nope', 'two');
      jest.advanceTimersByTime(1000);

      expect(logs.length).toBe(0);
    });

    it('resets the timer when a new log entry is made', () => {
      const logger = new Logger({...config, throttleDuration: 2000,  maxBuffer: 3});
      logger.log('nope', 'one');
      jest.advanceTimersByTime(1500);
      logger.log('nope', 'two');
      jest.advanceTimersByTime(1500);

      expect(logs.length).toBe(0);
    });

    it('resets the timer when flushed', async () => {
      const logger = new Logger({...config, throttleDuration: 2000,  maxBuffer: 3});
      logger.log('yup', 'one');
      logger.log('yup', 'two');
      jest.advanceTimersByTime(1000);
      await logger.flush();
      logger.log('nope', 'one'); // Should not be logged yet
      jest.advanceTimersByTime(1900);

      expectToHaveLogged([
        { logType: 'yup', eventName: 'one' },
        { logType: 'yup', eventName: 'two' },
      ]);
    });
  });

  describe('autoRetry', () => {
    it('retries the flush when fetch fails', async () => {
      const logger = new Logger({...config, autoRetryDuration: 1000});
      jest.spyOn(window, 'fetch').mockRejectedValueOnce('Oops, no network!');
      logger.log('yup', 'one');
      await logger.flush();
      logs.length = 0;
      jest.advanceTimersByTime(1000);

      expectToHaveLogged([
        { logType: 'yup', eventName: 'one' },
      ]);
    });

    it('stops retrying when fetch succeeds', async () => {
      const logger = new Logger({...config, autoRetryDuration: 1000});
      jest.spyOn(window, 'fetch').mockRejectedValueOnce('Oops, no network!');
      logger.log('yup', 'one');
      await logger.flush();
      logs.length = 0;
      jest.advanceTimersByTime(1000);
      jest.advanceTimersByTime(1000);
      jest.advanceTimersByTime(1000);

      expectToHaveLogged([
        { logType: 'yup', eventName: 'one' },
      ]);
    });

    it('does not retry when autoRetry is false', async () => {
      const logger = new Logger({...config, autoRetry: false, autoRetryDuration: 1000});
      jest.spyOn(window, 'fetch').mockRejectedValueOnce('Oops, no network!');
      logger.log('yup', 'one');
      await logger.flush();
      logs.length = 0;
      jest.advanceTimersByTime(1000);
      await Promise.resolve();

      expect(logs.length).toBe(0);
    });
  });
});
