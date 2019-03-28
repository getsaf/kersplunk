# kersplunk
Splunk logging for JavaScript

[![Build Status](https://travis-ci.com/getsaf/kersplunk.svg?branch=master)](https://travis-ci.com/getsaf/kersplunk)

### NOTE: This is a pre-release, not ready for production use just yet.

See the [Splunk HEC Docs](https://docs.splunk.com/Documentation/Splunk/latest/Data/UsetheHTTPEventCollector) for more info.


TODO:
 * Test on an actual Splunk server.

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
logger.info('thing:happened', {whatever: 'details', you: 'would', like: { to: 'add'}});
```

---

### Log Types

Each log entry is tagged with a `logType` property. These are intended to be broad categories of logs. You have control over the log types the logger can create.

By default, loggers will have:
* `info` - Informational
* `debug` - Debugging level stuff (may only want this in your lower environments)
* `warn` - Warnings (usually for recoverable errors)
* `error` - Hard exceptions

You may scrap these and create your own set by passing in your logger types into the `singleton` or `create` methods.
```typescript
const myLogger = Logger.create(config, 'happy', 'sad');
myLogger.happy('Wooo!! 😀'); // -> {logType: 'happy', eventName: 'Wooo!! 😀'}
myLogger.sad('Booooo ☹️'); // -> {logType: 'sad', eventName: 'Booooo ☹️'}
```
### Log Structure
The logger will combine all the information about your event into a single entry.

For example, logging this:

```typescript
logger.debug('it worked!', {note: 'I am awesome', foo: ['bar', 'baz']});
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
| Name | Type | Default | Notes |
|--|--|--|
| splunkUrl | `string` | `undefined` | The URL to your [Splunk HEC Collector](https://docs.splunk.com/Documentation/Splunk/latest/Data/UsetheHTTPEventCollector) endpoint |
| authToken | `string` | `undefined` | Your Splunk HEC token |
| interceptor | `function` | `undefined` | Allows for adding common log properties globally |
| enabled | `boolean` | true | enable/disable the logger |
|TODO| FINISH| THIS TABLE|

## API

### Logger

#### `static singleton(config: LoggerConfig, ...loggerTypes?: string[])`
> This is the recommended way to use the logger for most projects

Creates a "singleton" logger instance. The intention is that for a given JavaScript process, only **one** logger will ever be created by this method. This is useful if you would like to configure your logger once in your application and all modules will receive the same `Logger` instance.

#### `static create(config: LoggerConfig, ...loggerTypes?: string[])`
Creates a new logger instance.

