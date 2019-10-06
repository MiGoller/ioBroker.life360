![Logo](admin/life360.png)
# ioBroker.life360

[![NPM version](http://img.shields.io/npm/v/iobroker.life360.svg)](https://www.npmjs.com/package/iobroker.life360)
[![Downloads](https://img.shields.io/npm/dm/iobroker.life360.svg)](https://www.npmjs.com/package/iobroker.life360)
[![Dependency Status](https://img.shields.io/david/MiGoller/iobroker.life360.svg)](https://david-dm.org/MiGoller/iobroker.life360)
[![Known Vulnerabilities](https://snyk.io/test/github/MiGoller/ioBroker.life360/badge.svg)](https://snyk.io/test/github/MiGoller/ioBroker.life360)

[![NPM](https://nodei.co/npm/iobroker.life360.png?downloads=true)](https://nodei.co/npm/iobroker.life360/)

**Tests:**: [![Travis-CI](http://img.shields.io/travis/MiGoller/ioBroker.life360/master.svg)](https://travis-ci.org/MiGoller/ioBroker.life360)

## Life360 adapter for ioBroker

An ioBroker adapter for [Life360](https://www.life360.com).

## Description

This adapter connects to the [Life360](https://www.life360.com) cloud services to allow you to track people and to detect their presence at defined places. It retrieves information about the user's circles, the circles' members and the circles' places. These information persists the adapter in ioBroker states. Any states will get updated in a given interval.

## Installation

Right now you'll have to add the adapter to your ioBroker using a custom url pointing to the corresponding [GitHub](https://github.com/) repository at https://github.com/MiGoller/ioBroker.life360/tree/master .

## Configuration

You'll have to setup the adapter with your personal [Life360](https://www.life360.com) credentials to let the adapter poll the information from the cloud services. You can login with your mobile phone number or your email-address (recommended) for Life360, but in any case you'll have to set the password to your personal Life360 password.

Feel free to modify the default timespan of 60 seconds for the polling interval. The adapter does not allow modifying the interval to less than 15 seconds to prevent gaining any rate limits and to prevent ioBroker Admin getting slower and slower.

## Disclaimer
I did not find any official documentation for the [Life360](https://www.life360.com) REST APIs. Apparently [Life360](https://www.life360.com) does not support the use of the REST API for other applications than its own ones.

My REST API integration is based on reverse engineering done by the open source community and an API token discovered on [Life360](https://www.life360.com) code which is public available. [Life360](https://www.life360.com) could disable or modify this API token or change its REST API in a way that this adapter will not work as expected anymore.

## Changelog

### 0.1.1
* (migoller) First alpha release

### 0.0.1
* (migoller) initial release

## License
MIT License

Copyright (c) 2019 Michael Goller <goller.michael@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.