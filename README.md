# kersplunk
Splunk logging for JavaScript

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
logger.info('thing:happened', {whatever: 'details', you: 'would', like: { to: 'add'}});
```

---

### Log Types

Each log entry is tagged with a `logType` property. These are intended to be broad categories of logs. You have control over the log types the logger can create. By default, you will get:
* `info` - Informational
* `debug` - Debugging level stuff (may only want this in your lower environments)
* `warn` - Warnings (usually for recoverable errors)
* `error` - Hard exceptions

You may scrap these and create your own set by passing in your logger types into the `singleton` or `custom` methods.
```typescript
const myLogger = Logger.custom(config, 'happy', 'sad');
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
| Name | Type | Notes |
|--|--|--|
| splunkUrl | `string`  | The URL to your [Splunk HEC Collector](https://docs.splunk.com/Documentation/Splunk/latest/Data/UsetheHTTPEventCollector) endpoint |
| authToken | `string` | Your Splunk HEC token |
| beforeLog | `function` | Allows for adding common log properties globally |
|TODO| FINISH| THIS TABLE|

## API

### Logger

#### `static singleton(config: LoggerConfig, ...loggerTypes: string[])`
Creates a "singleton" logger instance. The intention is that for a given JavaScript process, only **one** logger will ever be created by this method. This is useful if you would like to configure your logger once in your application and all modules will receive the same `Logger` instance.

By default, the singleton method will be equipped with the default [`Log Types`.](#log-types)

#### `log(logType: string, eventName: string, details?: object)`
> NOTE:  Don't use this directly, you probably want to use a custom [Log Type](#log-types) instead

