// lib/saver.js

var util = require('util');
var fs = require('fs');
var path = require('path');
var urlutil = require('url');

var async = require('async');

var archiver = require('archiver');
var mkdirp = require('mkdirp');
var jsonfile = require('jsonfile');

var cheerio = require('cheerio');

var downloader = require('./downloader');
var utils = require('./utils');

var EventEmitter = require('events').EventEmitter;

var page_handlers = [];

if (utils.directoryExists(__dirname + '/handlers')) {
  fs.readdirSync(__dirname + '/handlers').forEach(function(file) {
    if (file.indexOf('.js') > 0) {
      var handler = require("./handlers/" + file);
      // console.log('Available handler:', handler.name);
      page_handlers.push(handler);
    }
  });
  console.log(page_handlers.length);
}

var Saver = function(options) {
  EventEmitter.call(this);

  this._output_dir = options.output_dir;

  this._config_file = options.config_file;
  this._state_file = options.state_file;
  this._state_file_name = options.state_file_name || 'saver.json';

  this._state = {};
  this._config = {};
  this._logs = [];

  this._page_handlers = page_handlers.slice(0);

  this._exited = false;

  if (typeof this._state_file != 'undefined') {
    this._state = (this.loadStateSync(this._state_file) || {});
  } else if (typeof this._output_dir != 'undefined') {
    this._state_file = path.join(this._output_dir, this._state_file_name);
    this._state = (this.loadStateSync(this._state_file) || {});
  }

  if (typeof this._config_file != 'undefined') {
    this._config = (this.loadConfigSync(this._config_file) || {});
  }

  this._save_state_on_exit = true;  
  if (typeof options.save_state_on_exit != 'undefined') {
    this._save_state_on_exit = options.save_state_on_exit;
  } 
  if (this._save_state_on_exit) {
    if (options.verbose) {
      console.log('State will be saved on exit to ' + this._output_dir);
    }
    this._exit_handler = exitHandler.bind(this);
    process.on('exit', this._exit_handler); 
  }
}

util.inherits(Saver, EventEmitter);

function exitHandler(error) {
  if (!this._exited) {
    this._exited = true;
    if (typeof this._output_dir != 'undefined') {
      // console.log('State saved to: ' + this._output_dir);
      this.saveStateSync(this._state_file);
    }
  }
}

Saver.prototype.exit = function(err) {
  this.emit('before_exit');
  if (this._save_state_on_exit) {
    process.removeListener('exit', this._exit_handler);
  }
  exitHandler.call(this, err);
  this.emit('exit', err);
}

Saver.prototype.log = function(log) {
  console.log('[LOG]', log);
  // this._logs.push(log);
  this.emit('log', log);
}

Saver.prototype.error = function(error) {
  console.log('[ERROR]', error);
  // this._logs.push('ERROR', error);
  this.emit('error', error);
}

// =====
// config
// =====

Saver.prototype.loadConfigSync = function(config_file) {
  var config = null;
  if (utils.fileExists(config_file)) {
    try {
      config = jsonfile.readFileSync(config_file);
    } catch (e) {
    }
  }
  return config;
}

// =====
// state
// =====

Saver.prototype.getOutputDir = function() {
  return this._output_dir;
}

Saver.prototype.setOutputDir = function(output_dir) {
  this._output_dir = output_dir;
  this._state_file = path.join(this._output_dir, this._state_file_name);
}

Saver.prototype.loadStateSync = function(state_file) {
  // console.log('Load state file:', state_file);
  var state = null;
  try {
    var stats = fs.statSync(state_file);
    if (stats.isFile()) {
      state = jsonfile.readFileSync(state_file);
    }
  } catch (e) {
  }
  if (state != null) {
    this._state = state;
  }
  return state;
}

Saver.prototype.saveStateSync = function(state_file) {
  var err = null;
  try {
    jsonfile.writeFileSync(state_file, this._state, { spaces: 2 });
  } catch (e) {
    err = e;
  }
  return err;
}

Saver.prototype.getState = function() {
  return this._state;
}

Saver.prototype.setStateData = function(key, value) {
  this._state[key] = value;
}

Saver.prototype.getStateData = function(key) {
  return this._state[key];
}

function updateObject(original, update, verbose) {
  if (typeof original == 'object' && typeof update == 'object') {
    for (var prop in update) {
      if (verbose) {
        console.log('Update prop "' + prop + '":', 
          ' (' + typeof original[prop] + ' --> ' + typeof update[prop] + ')');
      }
      if (typeof original[prop] == 'object' && typeof update[prop] == 'object') {
        updateObject(original[prop], update[prop], verbose);
      } else {
        original[prop] = update[prop];
      }
    }
  } else {
    original = update;
  }
}

Saver.prototype.updateStateData = function(key, update, save_to_file) {
  if (typeof this._state[key] == 'object' && typeof update == 'object') {
    updateObject(this._state[key], update);
  } else {
    this._state[key] = update;
  }
  if (save_to_file && typeof this._state_file != 'undefined') {
    this.saveStateSync(this._state_file);
  }
}

// for array data only
Saver.prototype.pushStateData = function(key, value, save_to_file) {
  if (Object.prototype.toString.call(this._state[key]) === '[object Array]') {
    this._state[key].push(value);
  } else if (typeof this._state[key] == 'undefined') {
    this._state[key] = [];
    this._state[key].push(value);
  }
  if (save_to_file && typeof this._state_file != 'undefined') {
    this.saveStateSync(this._state_file);
  }
}

Saver.prototype.deleteStateData = function(key, save_to_file) {
  if (typeof this._state[key] != 'undefined') {
    delete this._state[key];
  }
  if (save_to_file && typeof this._state_file != 'undefined') {
    this.saveStateSync(this._state_file);
  }
}

// options
// {
//   page_url: String,
//   output_dir: String
// }
Saver.prototype.start = function(options, callback) {
  var self = this;

  if (options.page_url) {
    self.processPage(options.page_url, options, function(err) {
      if (err) {
        console.log(err);
      }
      self.exit(err);
    });
  } else {
    self.exit();
  }
}

// =====
// page processing
// =====

// handler
// {
//   name: String,
//   url_match: new RegExp(...), // DEPRECATED
//   match: function(link, options) {...},
//   dispatch: function($, page, options, callback) {...}
// }
Saver.prototype.addHandler = function(handler) {
  // console.log('Add handler:', handler.name);
  this._page_handlers.push(handler);
}

Saver.prototype.isVisited = function(link) {
  var state = this.getStateData(link);
  return (state && state.visited);
}

Saver.prototype.setVisited = function(link) {
  this.updateStateData(link, { visited: 1, last_visited: new Date() })
}

// link
// {
//   url: String,
//   cache_bypass: Boolean
// }
Saver.prototype.getPage = function(link, options, callback) {
  var self = this;

  var local_file = getIndexHTMLFilePath({url: link.url}, options);
  if (!options.cache_bypass && !link.cache_bypass && utils.fileExists(local_file)) {
    if (options.verbose) console.log('Cached: ' + local_file);

    if (link.url.substring(link.url.length-16) == '.html/index.html') {
      link.url = link.url.substring(0, link.url.length-11);
      if (options.verbose) console.log('URL: ' + link.url);
    }

    var page = {
      url: link.url
    };

    var page_html = self.loadHtmlSync(local_file);
    if (page_html) {
      page.html_cached = true;
      page.html = page_html;

      page.$ = cheerio.load(page_html);

      return callback(null, page);
    }
    // download new HTML
    // fall through
  }

  return self.downloadPage(link.url, options, callback);
}

// link: String or following object
// {
//   url: String,
//   cache_bypass: Boolean
// }
Saver.prototype.processPage = function(link, options, callback) {
  var self = this;

  // console.log('Process page: ', link, ', ', options);

  var link_url = (typeof link == 'object') ? link.url : link;
  var link_obj = {
    url: link_url
  };
  if (typeof link == 'object') {
    link_obj.cache_bypass = link.cache_bypass;
  }

  // self.downloadPage(link, options, function(err, result) {
  self.getPage(link_obj, options, function(err, result) {
    if (err) {
      self.setVisited(link_url); // set visited
      return callback(err);
    }

    if (!result.$) {
      self.setVisited(link_url); // set visited
      return callback(new Error('Invalid HTML ($==null)'));
    }
    
    // console.log('URL:', result.url);

    self.setVisited(link_url); // set visited

    var $ = result.$;
    var page = { 
      url: result.url, 
      html: result.html, 
      html_cached: result.html_cached 
    };
    if (options.verbose) console.log("Visit Page: " + page.url);

    if ($('head base').length) {
      page.base_url = $('head base').attr('href');
      if (options.verbose) console.log('Base URL:', page.base_url);
    }

    page.title = $('title').first().text();
    if (page.title) {
      page.title = page.title.replace(/(\r\n|\n|\r)/gm, '');
    }
    if (options.verbose) console.log('Title:', page.title);

    var link_obj = urlutil.parse(page.url);
    var output_dir_name = path.basename(link_obj.pathname);
    var output_dir = path.join((options.output_dir || '.'), output_dir_name);
    if (options.verbose) console.log('Output directory: ' + output_dir);
    
    page.output_dir = output_dir;

    var handlers = [];
    for (var i = 0; i < self._page_handlers.length; i++) {
      if (self._page_handlers[i].match(page.url, options)) {
        handlers.push(self._page_handlers[i]);
      } /*else if (page.url.match(self._page_handlers[i].url_match)) {
        handlers.push(self._page_handlers[i]);
      }*/
    }
    if (handlers.length == 0) {
      if (options.verbose) console.log('No handler:', page.url);
    }

    async.eachSeries(handlers, function(handler, cb) {
      // console.log('Handler:', handler.name);
      handler.dispatch(self, $, page, options, function(err) {
        if (err) return cb(err);
        cb();
      });
    }, function(err) {
      if (err) {
        // console.log('Process page error! ' + page.url);
        // console.log(err);
        return callback(err);
      }
      callback(null, page);
    });
  });
}

Saver.prototype.processPages = function(links, options, callback) {
  var self = this;

  // console.log('Process pages: ', links, ', ', options);
  if (!links || links.length == 0) {
    return callback();
  }
  
  var process_queue = [];
  for (var i = 0; i < links.length; i++) {
    var link = links[i];
    if (!options.refresh) {
      var saved_data = self.getStateData(link);
      if (options.force || !saved_data || !saved_data.done) {
        process_queue.push(link);
      }
    }
  }

  if (process_queue.length == 0) {
    return callback();
  }

  var current = 0;
  var total = process_queue.length;

  async.eachSeries(process_queue, function(link, cb) {
    current++;
    if (self.isVisited(link)) {
      if (options.verbose) console.log("[" + current + "/" + total + "] Visited: " + link);
      return cb();
    }
    if (options.verbose) console.log("[" + current + "/" + total + "] Visit page: " + link);
    self.processPage(link, options, function(err, page) {
      if (err) {
        console.log('Process page error! ' + link);
        return cb(err);
      }
      if (page && page.html_cached) {
        cb();
      } else {
        setTimeout(cb, 1000); // delay
      }
    });
  }, function(err) {
    if (err) {
      console.log('Process pages error!');
      // console.log(err);
      return callback(err);
    }
    callback();
  });
}

// =====
// download
// =====

Saver.prototype.downloadHtml = function(url, options, callback) {
  downloader.downloadHtml(url, options, callback);
}

Saver.prototype.downloadPage = function(url, options, callback) {
  downloader.downloadPage(url, options, callback);
}

Saver.prototype.downloadFile = function(url, local_file, options, callback) {
  downloader.downloadFile(url, local_file, options, callback);
}

Saver.prototype.downloadImage = function(image_src, options, callback) {
  downloader.downloadImage(image_src, options, callback);
}

Saver.prototype.downloadImages = function(images, options, callback) {
  downloader.downloadImages(images, options, callback);
}

Saver.prototype.saveImages = function(page, images, options, callback) {
  var self = this;

  if (typeof options == 'function') {
    callback = options;
    options = {};
  }

  self.updateStateData(page.url, { 
    images: images,
    done: false, 
    last_update: new Date()
  });

  var download_options = Object.assign(options, { 
    output_dir: page.output_dir, 
    skip_if_exist: true
  });

  // download images
  self.downloadImages(images, download_options, function(err, images) {
    if (err) {
      return callback(err);
    }

    self.updateStateData(page.url, { 
      images: images,
      done: true, 
      last_update: new Date()
    });

    callback();
  });
}

// ===
// save
// ===

Saver.prototype.loadHtmlSync = function(input_file) {
  if (!utils.fileExists(input_file)) return '';

  return fs.readFileSync(input_file, 'utf8');
}

Saver.prototype.saveHtmlSync = function(output_file, html) {
  var output_dir = path.dirname(output_file);
  utils.ensureDirectoryExists(output_dir);

  fs.writeFileSync(output_file, html, 'utf8');
}

function getIndexHTMLFilePath(page, options) {
  var index_file = '';
  var page_url_obj = urlutil.parse(page.url);
  var page_output_dir_path = path.join(page_url_obj.host, page_url_obj.pathname);
  var page_output_dir = path.join((options.output_dir || '.'), page_output_dir_path);

  if (options.html_file_root) {
    page_output_dir = path.join((options.output_dir || '.'), options.html_file_root, page_output_dir_path);
  }
  if (page_url_obj.query) {
    index_file = path.resolve(page_output_dir, 'index-' + page_url_obj.query + '.html');
  } else {
    index_file = path.resolve(page_output_dir, 'index.html');
  }

  return index_file;
}

Saver.prototype.saveHtmlFile = function($, page, options) {
  var html_file = getIndexHTMLFilePath(page, options);
  this.saveHtmlSync(html_file, $.html());
}

Saver.prototype.saveTextSync = function(output_file, text, encoding) {
  var output_dir = path.dirname(output_file);
  utils.ensureDirectoryExists(output_dir);

  fs.writeFileSync(output_file, text, encoding || 'utf8');
}

Saver.prototype.loadJsonSync = function(json_file) {
  var json_obj = null;
  try {
    var stats = fs.statSync(json_file);
    if (stats.isFile()) {
      json_obj = jsonfile.readFileSync(json_file);
    }
  } catch (e) {
  }
  return json_obj;
}

Saver.prototype.saveJsonSync = function(output_file, object, encoding) {
  var output_dir = path.dirname(output_file);
  utils.ensureDirectoryExists(output_dir);
  try {
    jsonfile.writeFileSync(output_file, object, { spaces: 2 });
  } catch (e) {
    console.log(e);
  }
}

// files: [
//   {path: String, name: String}
// ]
Saver.prototype.createZipArchive = function(output_file, files, callback) {
  var error = null;
  var output_dir = path.dirname(output_file);
  // utils.ensureDirectoryExists(output_dir);

  var archive = archiver('zip');

  archive.on('end', function() {
    if (!error) {
      // console.log('Zip archive created %d bytes', archive.pointer());
      console.log('File zipped:', output_file);
      callback();
    }
  });

  archive.on('error', function(err){
    console.log('File zip error:', output_file);
    if (!error) {
      error = err;
      callback(err);
    }
  });

  var output = fs.createWriteStream(output_file);
  archive.pipe(output);

  files.forEach(function(file) {
    if (!file.path || file.path == '') return;
    if (file.name && file.name != '') {
      archive.file(file.path, { name: file.name });
    } else {
      archive.file(file.path, { name: path.basename(file.path) });
    }
  });

  archive.finalize();
}

// ===
// fix
// ===

Saver.prototype.fixLink = function(url, page, options) {
  options = options || {};
  
  var page_host_url = utils.urlGetHost(page.url);
  var page_host_url_obj = urlutil.parse(page_host_url);
  var page_url_obj = urlutil.parse(page.base_url || page.url);

  var link_url = url;
  if (!utils.isValidLink(link_url)) {
    return link_url;
  }
  
  if (link_url.indexOf('//') == 0) {
    link_url = page_host_url_obj.protocol + link_url;
  }
  
  var link_url_obj = urlutil.parse(link_url);
  if (!link_url_obj.host) {
    if (link_url.indexOf('/') == 0) {
      link_url = urlutil.resolve(page_host_url_obj, link_url_obj);
    } else {
      link_url = urlutil.resolve(page_url_obj, link_url_obj);
    }
  } else {
    link_url = urlutil.format(link_url_obj);
  }

  if (typeof options.link_editor == 'function') {
    link_url = options.link_editor(link_url);
  }

  return link_url;
}

Saver.prototype.fixLinks = function($, page, selector, options) {
  options = options || {};
  
  var page_host_url = utils.urlGetHost(page.url);
  var page_host_url_obj = urlutil.parse(page_host_url);
  var page_url_obj = urlutil.parse(page.base_url || page.url);
  
  $('' + selector + ' a').each(function(){
    var link_href = $(this).attr('href');
    if (!utils.isValidLink(link_href)) return;

    var link_url = link_href;
    if (link_url.indexOf('//') == 0) {
      link_url = page_host_url_obj.protocol + link_url;
    }

    var link_url_obj = urlutil.parse(link_url);
    if (!link_url_obj.host) {
      if (link_url.indexOf('/') == 0) {
        link_url = urlutil.resolve(page_host_url_obj, link_url_obj);
      } else {
        link_url = urlutil.resolve(page_url_obj, link_url_obj);
      }
    } else {
      link_url = urlutil.format(link_url_obj);
    }

    if (typeof options.link_editor == 'function') {
      link_url = options.link_editor(link_url);
    }

    $(this).attr('href', link_url);
  });
}

Saver.prototype.fixImages = function($, page, selector, options) {
  options = options || {};
  
  var page_host_url = utils.urlGetHost(page.url);
  var page_host_url_obj = urlutil.parse(page_host_url);
  var page_url_obj = urlutil.parse(page.base_url || page.url);
  
  $('' + selector + ' img').each(function(){
    var img_src = $(this).attr('src');
    if (img_src && img_src != "") {
      var img_url = img_src;

      if (img_url.indexOf('data:') == 0) return;

      if (img_url.indexOf('//') == 0) {
        img_url = page_host_url_obj.protocol + img_url;
      }

      var img_url_obj = urlutil.parse(img_url);
      if (!img_url_obj.host) {
        if (img_url.indexOf('/') == 0) {
          img_url = urlutil.resolve(page_host_url_obj, img_url_obj);
        } else {
          img_url = urlutil.resolve(page_url_obj, img_url_obj);
        }
      } else {
        img_url = urlutil.format(img_url_obj);
      }

      $(this).attr('src', img_url);
    }
  });
}

// ===
// get
// ===

function getUniqueFileName(file_names, file_name) {
  var result_file_name = file_name;
  var file_name_ext = path.extname(file_name);
  var file_name_base = path.basename(file_name, file_name_ext);
  var collision = false;

  for (var i = 0; i < file_names.length; i++) {
    if (file_name == file_names[i].file_name) {
      collision = true;
      file_names[i].current_index++;
      result_file_name = file_name_base + '(' + file_names[i].current_index + ')' + file_name_ext;
    }
  }
  if (!collision) {
    file_names.push({
      file_name: file_name,
      current_index: 0
    });
  }
  return result_file_name;
}

Saver.prototype.getUniqueFileName = getUniqueFileName;

function getUniqueFilePath(file_path) {
  var result_file_dir = path.dirname(file_path);
  var result_file_path = file_path;
  var file_index = 0;
  var file_ext = path.extname(result_file_path);
  var file_name_base = path.basename(result_file_path, file_ext);

  while (utils.fileExists(result_file_path)) {
    file_index++;
    var file_name = file_name_base + '(' + file_index + ')' + file_ext;
    result_file_path = path.join(result_file_dir, file_name);
  }
  return result_file_path;
}

Saver.prototype.getUniqueFilePath = getUniqueFilePath;

// options
// {
//   blacklist: [String],
//   visited_links: [String],
//   filters: [String],
//   validator: function(link) {...},
//   exclude_visited_links: Boolean
// }
Saver.prototype.getLinks = function($, page, selector, options) {
  // console.log('getLinks()');
  options = options || {};
  
  var self = this;
  var blacklist = options.blacklist || [];
  var visited_links = options.visited_links || [];
  var filters = options.filters || [];
  
  var isVisited = function(link) {
    if (visited_links && visited_links.length) { // && Array.isArray(visited_links) 
      return (visited_links.indexOf(link) >= 0);
    } else { // 'object' or 'undefined'
      return self.isVisited(link);
    }
  }
  
  var links = [];
  var page_host_url = utils.urlGetHost(page.url);
  var page_host_url_obj = urlutil.parse(page_host_url);
  var page_url_obj = urlutil.parse(page.base_url || page.url);
  
  $('' + selector + ' a').each(function(){
    var link_href = $(this).attr('href');
    if (!utils.isValidLink(link_href)) return;
    
    var link_url = link_href;
    link_url = link_url.replace('http:///', '/');
    if (link_url.indexOf('//') == 0) {
      link_url = page_host_url_obj.protocol + link_url;
    }
    
    var link_url_obj = urlutil.parse(link_url);
    var link_url_host = link_url_obj.host;
    if (!link_url_host) {
      // link_url = urlutil.resolve(page_host_url_obj, link_url_obj);
      if (link_url.indexOf('/') == 0) {
        link_url = urlutil.resolve(page_host_url_obj, link_url_obj);
      } else {
        link_url = urlutil.resolve(page_url_obj, link_url_obj);
      }
      link_url_host = page_host_url_obj.host;
    } else {
      link_url = urlutil.format(link_url_obj);
    }
    
    // filter_host
    if (typeof options.filter_host != 'undefined') {
      if (link_url_host != options.filter_host) return;
    }
    
    // $(this).attr('href', link_url);
    link_url = link_url.split('#')[0];
    if (link_url == page.url) return;
    
    // exclude visited link
    if (options.exclude_visited_links) {
      if (isVisited(link_url)) return;
    }
    
    // blacklist
    if (typeof blacklist != 'undefined' && blacklist.length > 0) {
      var blacklisted = false;
      for (var i = 0; i < blacklist.length; i++) {
        if (link_url.indexOf(blacklist[i]) >= 0) {
          blacklisted = true;
          break;
        }
      }
      if (blacklisted) return;
    }
    
    // filters
    if (typeof filters != 'undefined' && filters.length > 0) {
      var filter_out = true;
      for (var i = 0; i < filters.length; i++) {
        if (link_url.indexOf(filters[i]) >= 0) {
          filter_out = false;
          break;
        }
      }
      if (filter_out) return;
    }
    
    if (links.indexOf(link_url) == -1) {
      if (typeof options.validator == 'function') {
        if (options.validator(link_url)){
          links.push(link_url);
        }
      } else {
        links.push(link_url);
      }
    }
  });
  return links;
}

// options
// {
//   blacklist: [String],
//   filters: [String]
// }
Saver.prototype.getImages = function($, page, selector, options) {
  // console.log('getImages()');
  options = options || {};
  
  var blacklist = options.blacklist || [];
  var filters = options.filters || [];
  var image_urls = [];
  var image_file_names = [];
  var images = [];

  var page_host_url = utils.urlGetHost(page.url);
  var page_host_url_obj = urlutil.parse(page_host_url);
  var page_url_obj = urlutil.parse(page.base_url || page.url);

  $('' + selector + ' img').each(function(){
    var image_src = $(this).attr('src');
    var image_alt = $(this).attr('alt');
    if (image_src && image_src != "") {
      if (image_src.indexOf('data:') == 0) return;
      
      var image_url = image_src;
      if (image_url.indexOf('//') == 0) {
        image_url = page_host_url_obj.protocol + image_url;
      }

      var image_url_obj = urlutil.parse(image_url);
      if (!image_url_obj.host) {
        // image_url = urlutil.resolve(page_host_url_obj, image_url_obj);
        if (image_url.indexOf('/') == 0) {
          image_url = urlutil.resolve(page_host_url_obj, image_url_obj);
        } else {
          image_url = urlutil.resolve(page_url_obj, image_url_obj);
        }
      } else {
        image_url = urlutil.format(image_url_obj);
      }
      
      if (image_urls.indexOf(image_url) >= 0) return;
      image_urls.push(image_url);
      
      // blacklist
      if (typeof blacklist != 'undefined' && blacklist.length > 0) {
        var blacklisted = false;
        for (var i = 0; i < blacklist.length; i++) {
          if (image_url.indexOf(blacklist[i]) >= 0) {
            blacklisted = true;
            break;
          }
        }
        if (blacklisted) return;
      }

      // filters
      if (typeof filters != 'undefined' && filters.length > 0) {
        var filter_out = true;
        for (var i = 0; i < filters.length; i++) {
          if (image_url.indexOf(filters[i]) >= 0) {
            filter_out = false;
            break;
          }
        }
        if (filter_out) return;
      }

      var image_file_name = path.basename(image_url_obj.pathname);
      image_file_name = getUniqueFileName(image_file_names, image_file_name);
      var image_info = {
        src: image_url,
        file: image_file_name
      };
      if (image_alt && image_alt != '') image_info.alt = image_alt;
      images.push(image_info);
    }
  });
  return images;
}

module.exports = Saver;