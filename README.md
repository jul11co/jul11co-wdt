# jul11co-wdt

Jul11Co Web Download Tools - Collections of APIs for downloading data from websites.

### Installation

From npm

```
npm install --save jul11co-wdt
```

### Usage

```javascript
var downloader = require('jul11co-wdt').Downloader;
var scraper = require('jul11co-wdt').Scraper;
var utils = require('jul11co-wdt').Utils;

var Saver = require('jul11co-wdt').Saver;
var JsonStore = require('jul11co-wdt').JsonStore;
var JobQueue = require('jul11co-wdt').JobQueue;
```

* Downloader APIs

```javascript
downloader.downloadPage(url, options, attempts, callback);
downloader.downloadFile(url, local_file, options, attempts, callback);
downloader.downloadFiles(files, options, callback);
downloader.downloadImage(image_src, options, callback);
downloader.downloadImages(images, options, callback);
```

* Scraper APIs

```javascript
scraper.addScraper(scraper);
scraper.scrape(request_url, options, callback);
```

* Utils APIs

```javascript
utils.fileExists(file_path);
utils.directoryExists(directory);
utils.ensureDirectoryExists(directory);
```
```javascript
utils.isValidLink(link_href);
utils.isHttpUrl(string);
utils.urlGetHost(link_url);
```
```javascript
utils.ellipsisMiddle(string, max_length, first_part, last_part);
utils.numberPad(number, size);
utils.replaceAll(string, find, replace);
utils.extractSubstring(original, prefix, suffix);
utils.trimText(input, max_length);
```
```javascript
utils.getUniqueFileName(file_names, file_name);
utils.getUniqueFilePath(file_path);
```

* Saver APIs

```javascript
var saver = new Saver({
	output_dir: "PATH_TO_OUTPUT_DIRECTORY", // optional
	config_file: "PATH_TO_CONFIG_FILE", // optional
	state_file: "PATH_TO_STATE_FILE", // optional
	state_file_name: "STATE_FILE_NAME", // optional, default: saver.json
	save_state_on_exit: Boolean, // optional, default: True
});

saver.on('before_exit', function() {});
saver.on('exit', function(err){});
saver.on('log', function(log){});
saver.on('error', function(error){});

saver.start(options, callback);

saver.loadConfigSync(config_file);

saver.loadStateSync(state_file);
saver.saveStateSync(state_file);
saver.getState();
saver.setStateData(key, value);
saver.getStateData(key, value);
saver.updateStateData(key, update);
saver.pushStateData(key, value);
saver.deleteStateData(key, value);

saver.addHandler(handler);
saver.isVisited(link);
saver.setVisisted(link);

saver.getPage(link, options, callback);
saver.processPage(link, options, callback);
saver.processPages(links, options, callback);

saver.downloadPage(url, optioms, callback);
saver.downloadFile(url, local_file, options, callback);
saver.downloadImage(image_src, options, callback);
saver.downloadImages(images, options, callback);

saver.saveImages(page, images, options, callback);

saver.loadHtmlSync(input_file);
saver.saveHtmlSync(output_file, html);
saver.saveHtmlFile($, page, options);
saver.saveTextSync(output_file, text, encoding);
saver.loadJsonSync(json_file);
saver.saveJsonSync(output_file, object, encoding);

saver.createZipArchive(output_file, input_files, callback);

saver.fixLink(url, page, options);
saver.fixLinks($, page, selector, options);
saver.fixImages($, page, selector);

saver.getLinks($, page, selector, options);
saver.getImages($, page, selector, options);
```

* JsonStore APIs

```javascript
var store = new JsonStore({ file: "PATH_TO_JSON_FILE" });

store.exit(err);

store.load(file);
store.save(file);
store.toMap();

store.set(key, value);
store.get(key);

store.update(key, update, save_to_file);
store.push(key, value, save_to_file);
store.delete(key, save_to_file);
```

* JobQueue APIs

```javascript
var queue = new JobQueue();

queue.jobCount();
queue.pushJob(args, fun, callback);
```

### License

MIT License

Copyright (c) 2018 Jul11Co

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

