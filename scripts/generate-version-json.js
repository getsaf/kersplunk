#!/usr/bin/env node
const {writeFileSync, readFileSync} = require('fs');
const {version} = JSON.parse(readFileSync('package.json'));

console.log('>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>');
console.log('Generating version JSON:', version);
console.log('>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>');
writeFileSync('./dist/version.json', JSON.stringify({version})); 
