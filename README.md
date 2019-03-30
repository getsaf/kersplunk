# kersplunk

Splunk logging for JavaScript

[![Build Status](https://travis-ci.com/getsaf/kersplunk.svg?branch=master)](https://travis-ci.com/getsaf/kersplunk)

See the [Splunk HEC Docs](https://docs.splunk.com/Documentation/Splunk/latest/Data/UsetheHTTPEventCollector) for more info.

### Quickstart

```sh
npm install 'kersplunk'
```

Create a logger singleton (recommended for most applications):

```typescript
import { Logger } from 'kersplunk';
export const logger = Logger.singleton({
  splunkUrl: 'http://my-splunk/http-event-collector-path',
  authToken: 'YOUR-SPLUNK-HEC-TOKEN'
}):
```

Then, just use the logger around your application:

```typescript
import { logger } from './utils/logger';
// Log away!
logger.info('thing:happened', {
  whatever: 'details',
  you: 'would',
  like: { to: 'add' },
});
```

---

### Log Types

Each log entry is tagged with a `logType` property. These are intended to be broad categories of logs. You have control over the log types the logger can create.

By default, loggers will have:

- `info` - Informational
- `debug` - Debugging level stuff (may only want this in your lower environments)
- `warn` - Warnings (usually for recoverable errors)
- `error` - Hard exceptions

You may scrap these and create your own set by passing in your logger types into the `singleton` or `create` methods.

```typescript
const myLogger = Logger.create(config, 'happy', 'sad');
myLogger.happy('Wooo!! 😀'); // -> {logType: 'happy', eventName: 'Wooo!! 😀'}
myLogger.sad('Booooo ☹️'); // -> {logType: 'sad', eventName: 'Booooo ☹️'}
```

### Log Structure

Each log may optionally be supplied with details about the event. The details object _must_ be serializable by `JSON.stringify` . The logger will combine the details of your event along with the log type and event name into a single entry.

For example, logging this:

```typescript
logger.debug('it worked!', { note: 'I am awesome', foo: ['bar', 'baz'] });
```

will create a log entry in Splunk like this:

```javascript
{
  logType: 'debug',
  eventName: 'it worked!',
  note: 'I am awesome',
  foo: ['bar', 'baz']
}
```

### Configuration

| Name                | Type                                | Default  | Notes                                                                                                                              |
| ------------------- | ----------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `splunkUrl`         | `string`                            | required | The URL to your [Splunk HEC Collector](https://docs.splunk.com/Documentation/Splunk/latest/Data/UsetheHTTPEventCollector) endpoint |
| `authToken`         | `string`                            | required | Your Splunk HEC token                                                                                                              |
| `splunkMeta`        | [`SplunkMeta`](#splunkmeta)         | optional | Splunk specific metadata to include with your logs. (eg: index, source, etc).                                                      |
| `enabled`           | `boolean`                           | `true`   | enable/disable the logger                                                                                                          |
| `interceptor`       | [`LogInterceptor`](#loginterceptor) | optional | Allows for adding common log properties globally                                                                                   |
| `maxBuffer`         | `number`                            | `50`     | The maximum size the buffer is allowed to grow before automatically flushing the logs to the server                                |
| `throttleDuration`  | `number` (ms)                       | `250`    | The maximum amount of time to buffer logs before automatically flushing logs to the server                                         |
| `autoRetry`         | `boolean`                           | `true`   | Automatically retry log submission if posting to Splunk fails.                                                                     |
| `autoRetryDuration` | `number` (ms)                       | `1000`   | Duration between autoRetries                                                                                                       |
| `logToConsole`      | `boolean`                           | `false`  | Enables displaying all log details to `console.log`.                                                                               |
| `errorFormatter`    | [`ErrorFormatter`](#errorformatter) | optional | Allows customization of how `Error` objects are logged.                                                                            |

## Customizing your logs

It is common to need common meta-data on all logs. For example, you may log that a button was pressed but if you don't have some context about the action, the log is not terribly useful. A custom log interceptor allows adding context to all your logs.

#### `LogInterceptor`

`(log: object) => object`

Takes in the original log information (`{ logType, eventName, ...details}`) and returns the "enhanced" log entry.

```typescript
logger.interceptor = log => ({
  ...log,
  icon: log.logType === 'error' ? '💩' : '😎',
});
logger.info('yo', { feeling: 'awesome' });
logger.error('aww', { feeling: 'poopy' });
// Will be intercepted and have the details appended:
// {logType: 'info', eventName: 'yo', feeling: 'awesome', icon: '😎'}
// {logType: 'error', eventName: 'aww', feeling: 'poopy', icon: '💩'}
```

Here's what an interceptor might look like for an application with a redux-store:

```typescript
const store = createStore(reducers);
logger.interceptor = log => {
  const state = store.getState();
  return {
    ...log,
    meta: {
      user: state.user.username,
      deviceId: state.app.deviceId,
      sessionId: state.user.sessionId,
      route: state.app.currentRoute,
    },
  };
};
```

This would ensure that all your logs will have some context to them.

You may now just log simple events and they will automatically have context added to them:

```typescript
logger.info('button:press', { buttonText: 'Go!' });
```

Before this log gets to the server, it'll pass the details through the interceptor which will attach your meta-data.

#### `ErrorFormatter`

By default, when you pass an `Error` as your log details, it will be formatted as:

```javascript
{ name: error.name, message: error.message, stack: error.stack }
```

You may customize this formatting by providing a custom error formatter:
`(error: Error) => object`

### `SplunkMeta`

> See [Event Metadata](https://docs.splunk.com/Documentation/Splunk/latest/Data/FormateventsforHTTPEventCollector#Event_metadata) section of the Splunk docs.

| Name         | Type     | Default                  | Notes                                                                                                                                                                                                                                                                                                                                     |
| ------------ | -------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `time`       | `number` | current time             | The event time. The default time format is epoch time format, in the format <sec>.<ms>. For example, 1433188255.500 indicates 1433188255 seconds and 500 milliseconds after epoch, or Monday, June 1, 2015, at 7:50:55 PM GMT.                                                                                                            |
| `host`       | `string` | `undefined`              | The host value to assign to the event data. This is typically the hostname of the client from which you're sending data.                                                                                                                                                                                                                  |
| `source`     | `string` | `"kersplunk-<version>"`  | The source value to assign to the event data. For example, if you're sending data from an app you're developing, you could set this key to the name of the app.                                                                                                                                                                           |
| `sourcetype` | `string` | `"_json"`                | It is recommended you keep this value                                                                                                                                                                                                                                                                                                     |
| `index`      | `string` | `undefined`              | The name of the index by which the event data is to be indexed. The index you specify here must within the list of allowed indexes if the token has the indexes parameter set.                                                                                                                                                            |
| `fields`     | `string` | `{kersplunk: <version>}` | Specifies a JSON object that contains explicit custom fields to be defined at index time. Requests containing the `fields` property must be sent to the /collector/event endpoint, or they will not be indexed. For more information, see [Indexed field extractions](http://docs.splunk.com/Documentation/Splunk/latest/Data/IFXandHEC). |

You may dynamically supply `SplunkMeta` with a callback or static data.

## API

### Static Methods

---

#### `Logger.singleton(config: LoggerConfig, ...loggerTypes?: string[])`

**This is the recommended way to use the logger for most projects**

The same as `Logger.create` except this version creates a "singleton" logger instance. The intention is that for a given JavaScript process, only **one** logger will ever be created by this method. This is useful if you would like to configure your logger once in your application and all modules will receive the same `Logger` instance.

#### `Logger.create(config: LoggerConfig, ...loggerTypes?: string[])`

Creates a new logger instance with the default logTypes.

#### `Logger.clearSingleton()`

Resets the singleton object so another logger will be created on the next `Logger.singleton` call.

### Instance Methods

---

#### `logger.enable()`

Enables the logger.

#### `logger.disable()`

Disables the logger. This is the same as configuring the logger with `enabled: false`. The logger will essentially discard logs instead of sending them to Splunk. If you have enabled `logToConsole` those logs will still be output to the console.

#### `logger.flush() Promise<void>`

Immediately submits logs to Splunk. This is useful if your app is about to exit and you want to flush the buffers.
