var util = require('util');
var fs = require('fs');
var path = require('path');
var urlutil = require('url');
var zlib = require('zlib');

var request = require('request');
var cheerio = require('cheerio');
var fse = require('fs-extra');

// var readline = require('readline');

var async = require('async');
var mkdirp = require('mkdirp');

var mimetypes = require('./mimetypes');
var utils = require('./utils');

function requestWithEncoding(options, callback) {
  var cb_called = null;
  var finish = function(err, res, buffer) {
    if (!cb_called) {
      cb_called = true;
      callback(err, res, buffer);
    }
  }
  try {
    var req = request.get(options);

    var content_length = 0;
    var content_downloaded = 0;

    req.on('response', function(res) {
      var chunks = [];

      if (res.headers['content-length']) {
        content_length = parseInt(res.headers['content-length']);
      }

      res.on('data', function(chunk) {
        chunks.push(chunk);
        if (chunk) {
          content_downloaded += chunk.length;
          if (typeof options.progress == 'function') {
            options.progress(content_downloaded, content_length);
          }
        }
      });

      res.on('end', function() {
        var buffer = Buffer.concat(chunks);
        var encoding = res.headers['content-encoding'];
        if (encoding == 'gzip') {
          zlib.gunzip(buffer, function(err, decoded) {
            finish(err, res, decoded && decoded.toString());
          });
        } else if (encoding == 'deflate') {
          zlib.inflate(buffer, function(err, decoded) {
            finish(err, res, decoded && decoded.toString());
          })
        } else {
          finish(null, res, buffer.toString());
        }
      });
    });

    req.on('error', function(err) {
      finish(err);
    });
  } catch(e) {
    finish(e);
  }
}

function requestToFile(options, local_file, callback) {
  
  var request_url = '';
  if (typeof options == 'string') {
    request_url = options;
    options = {};
    options.url = request_url;
  }

  var cb_called = false;
  var finish = function(err, result) {
    if (!cb_called) {
      cb_called = true;
      callback(err, result);
    }
  }
  try {
    var req = request(options);

    var result = {
      headers: {},
      content_type: '',
      content_length: 0,
      content_downloaded: 0,
      file: local_file
    };

    var outFileStream = fs.createWriteStream(local_file);

    req.on('response', function (res) {
      result.headers = res.headers;

      if (res.headers['content-type']) {
        result.content_type = res.headers['content-type'];
      }
      if (res.headers['content-length']) {
        result.content_length = parseInt(res.headers['content-length']);
      }

      result.statusCode = res.statusCode;

      if (res.statusCode !== 200) {
        var error = new Error('Response status code: ' + res.statusCode);
        error.httpStatusCode = res.statusCode;
        return finish(error);
      }

      var encoding = res.headers['content-encoding'];
      if (encoding == 'gzip') {
        res.pipe(zlib.createGunzip()).pipe(outFileStream);
      } else if (encoding == 'deflate') {
        res.pipe(zlib.createInflate()).pipe(outFileStream);
      } else {
        res.pipe(outFileStream);
      }
    });

    req.on('data', function(chunk) {
      if (chunk) {
        result.content_downloaded += chunk.length;
        if (typeof options.progress == 'function') {
          options.progress(result.content_downloaded, result.content_length);
        }
      }
    });

    req.on('error', function(err) {
      finish(err);
    });

    req.on('end', function() {
      if (result.headers['last-modified']) {
        try {
          var fd = fs.openSync(local_file, 'r');
          if (fd >= 0) {
            fs.futimesSync(fd, new Date(), new Date(result.headers['last-modified']));
            fs.closeSync(fd);
          }
        } catch (ex) {
          // console.log('Warning:', ex.message);
        }
      }
      finish(null, result);
    });

  } catch(e) {
    return finish(e);
  }
}

function removeFileSync(local_file) {
  try {
    fs.unlinkSync(local_file);
  } catch(e) {
    // console.log(e);
  }
}

// http://www.phaster.com/golden_hill_free_web/ghfw_connection_speed.shtml
function computeDownloadSpeed(start_time, end_time, file_size) {
  // This function returns the speed in kB/s of the user's connection.
  speed = (Math.floor((((file_size) / ((end_time - start_time) / 1000)) / 1024) * 10) / 10);
  return speed;
}
// http://stackoverflow.com/questions/2901102/how-to-print-a-number-with
// -commas-as-thousands-separators-in-javascript
// function numberWithCommas(x) {
//     return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
// }

// options:
// {
//   skip_if_exist: Boolean,
//   request_headers: Object, // key: value
//   request_timeout: Integer, // milliseconds
//   max_attempts: Integer,
//   backoff_delay: Integer,
//   no_rename: Boolean,
//   return_headers: Boolean,
//   // Callbacks
//   onProgress: function({url: String, file: String, timestamp: Date, 
//                       speed: Float, percentage: Float, current: Integer, total: Integer}),
//   onDownloadStart: function({url: String, local_file: String}),
//   onDownloadTimeout: function({url: String, local_file: String, attempts: Integer, max_attempts: Integer}),
//   onDownloadFailed: function(err, {url: String, local_file: String}),
//   onRename: function({old_file: String, new_file: String}),
//   onDownloadFinished: function({file: String, file_size: Integer, content_type: String, headers: Object})
// }
exports.downloadFile = function(url, local_file, options, attempts, callback) {
  if (typeof options == 'function') {
    callback = options;
    options = {};
    attempts = 0;
  }
  if (typeof attempts == 'function') {
    callback = attempts;
    attempts = 0;
  }

  if (options.skip_if_exist && utils.fileExists(local_file)) {
    // console.log('File exists: ' + utils.ellipsisMiddle(local_file));
    return callback(null, {
      file: local_file
    });
  }

  var output_dir = path.dirname(local_file);
  utils.ensureDirectoryExists(output_dir);

  var output_file_tmp = local_file + '.part';

  var file_size = 0;
  var start_time = (new Date()).getTime();

  var request_options = {
    url: url,
    headers: options.request_headers,
    timeout: options.request_timeout || 20000, // default: 20 seconds
  };

  if (typeof options.progress == 'function') {
    request_options.progress = function (current, total) {
      if (file_size == 0) file_size = total;

      var current_time = (new Date()).getTime();
      var current_speed = computeDownloadSpeed(start_time, current_time, current);
      var percentage = ((current/total)*100).toFixed();

      options.progress({
        url: url,
        file: local_file,
        timestamp: current_time,
        speed: current_speed,
        percentage: percentage,
        current: current,
        total: total
      });
      // if (current < total) {
      //   process.stdout.write('File downloading: ' + utils.ellipsisMiddle(local_file) + 
      //     ' [' + numberWithCommas(current) + 
      //     ' ' + percentage + '% ' + current_speed + 'kB/s]\r');
      // }
    };
  }

  if (typeof options.onDownloadStart == 'function') {
    options.onDownloadStart(err, {url: url, local_file: local_file});
  }

  requestToFile(request_options, output_file_tmp, function (err, res) {
    if (err) {
      // if (options.verbose) console.log(err);

      if (err.code == 'ECONNRESET') {
        removeFileSync(output_file_tmp);
      }

      attempts++;
      if (err.code == 'ESOCKETTIMEDOUT' || err.code == 'ETIMEDOUT' || err.code == 'ECONNRESET') {
        var max_attempts = options.max_attempts || 5;
        var backoff_delay = options.backoff_delay || 5000; // 5 seconds

        if (attempts < max_attempts) {
          if (typeof options.onDownloadTimeout == 'function') {
            options.onDownloadTimeout(err, {
              url: url, 
              local_file: local_file, 
              attempts: attempts,
              max_attempts: max_attempts
            });
          }
          setTimeout(function() {
            // console.log('Timeout! Retrying... (' + attempts + ')');
            exports.downloadFile(url, local_file, options, attempts, callback);
          }, backoff_delay);
          return;
        }
      }

      if (typeof options.onDownloadFailed == 'function') {
        options.onDownloadFailed(err, {url: url, local_file: local_file});
      }

      if (err.code == 404) {
        // console.log('File not found: ' + url);
        var error = new Error('File not found');
        error.httpStatusCode = 404;
        return callback(error);
      } else if (err.code) {
        // console.log('File download error:', url, err.code);
        var error = new Error('Download error');
        error.httpStatusCode = err.code;
        return callback(error);
      } else {
        // console.log('Download error:', err.message);
      }

      return callback(err);
    }

    if (!res.file) {
      if (typeof options.onDownloadFailed == 'function') {
        options.onDownloadFailed(err, {url: url, local_file: local_file});
      }

      // console.log('File download failed:' + url);
      return callback(new Error('File download failed. Unknown error.'));
    }

    if (utils.fileExists(output_file_tmp)) {
      fse.moveSync(output_file_tmp, local_file, {overwrite: true});
    }

    var result_file = local_file;

    var content_type = res.headers['content-type'];
    if (!options.no_rename && typeof content_type != 'undefined' && utils.fileExists(result_file)) {
      var semicolon = content_type.indexOf(';');
      if (semicolon > 0) {
        content_type = content_type.substring(0, semicolon);  
      }

      var extensions = mimetypes.extensions(content_type);
      var extname = path.extname(result_file).toLowerCase();
      
      if (extensions && extensions.length > 0 && extensions.indexOf(extname.replace('.','')) == -1) {
        var dirname = path.dirname(result_file);
        var new_file = path.join(dirname, path.basename(result_file, extname) + '.' + extensions[0]);
        // console.log('File rename:', result_file + ' -> ' + new_file);
        if (typeof options.onRename == 'function') {
          options.onRename({
            old_file: result_file,
            new_file: new_file
          });
        }
        fs.renameSync(result_file, new_file);
        result_file = new_file;
      }
    }

    var result = {
      file: result_file, 
      file_size: file_size, 
      content_type: content_type 
    }
    if (options.return_headers) {
      result.headers = res.headers;
    }

    if (typeof options.onDownloadFinished == 'function') {
      options.onDownloadFinished(result)
    }

    callback(null, result);
  });
}

exports.downloadFiles = function(files, options, callback) {
  if (typeof options == 'function') {
    callback = options;
    options = {};
  }
    
  if (typeof options.output_dir != 'undefined') {
    ensureDirectoryExists(options.output_dir);
  }

  var getLocalFilePath = function(file_url) {
    var file_url_obj = urlutil.parse(file_url);
    var file_path = file_url_obj.host + file_url_obj.pathname;
    return (options.output_dir || '.') + '/' + file_path;
  }
  
  var cb_called = false;
  var finish = function(err, files) {
    if (!cb_called) {
      cb_called = true;
      callback(err, files);
    }
  }

  var max_download_threads = options.max_download_threads || 4;
  // limit 4 concurrent downloads at a time
  async.eachLimit(files, max_download_threads, function(file_info, cb) { 

    var file_url = '';
    var local_file = '';
    if (typeof file_info == 'string') {
      file_url = file_info;        
      local_file = getLocalFilePath(file_url);
    } else if (typeof file_info == 'object') {
      file_url = file_info.url;
      if (!file_info.local_file) {
        local_file = getLocalFilePath(file_url);
      } else {
        local_file = file_info.local_file;
      }
    }

    if (options.skip_if_exist && utils.fileExists(local_file)) {
      // console.log('File exists: ' + utils.ellipsisMiddle(local_file));
      return cb();
    }

    exports.downloadFile(file_url, local_file, options, function(err, result) {
      if (err) {
        if (typeof file_info == 'object') {
          file_info.error = true;
          if (typeof err.code != 'undefined') {
            file_info.error_code = err.code;
          }
        }
        return cb(/*err*/);
      }
      cb();
    });
    
  }, function(err) {
    // if (err) {
    //   console.log('downloadFiles:', err);
    // }
    finish(err, files);
  });
}

exports.downloadHtml = function(url, options, attempts, callback) {
  if (typeof options == 'function') {
    callback = options;
    options = {};
    attempts = 0;
  }
  if (typeof attempts == 'function') {
    callback = attempts;
    attempts = 0;
  }

  var request_url = url;
  if (options.html_proxy && options.html_proxy != '') {
    request_url = options.html_proxy + '?url=' + encodeURIComponent(request_url);
  }
  var request_options = {
    url: request_url,
    headers: options.request_headers || {
      'User-Agent': options.user_agent || 'request'
    },
    timeout: options.request_timeout || 20000 /* 20 seconds */
  };
  requestWithEncoding(request_options, function(error, response, html) {
    if (error) {
      // console.log(error);
      attempts++;
      if (error.code == "ESOCKETTIMEDOUT" || error.code == "ETIMEDOUT" || error.code == "ECONNRESET") {
        var max_attempts = options.max_attempts || 5;
        var backoff_delay = options.backoff_delay || 5000; // 5 seconds
        if (attempts < max_attempts) {
          // console.log('Timeout! Retrying... (' + attempts + ')');
          setTimeout(function() {
            exports.downloadHtml(url, options, attempts, callback);
          }, backoff_delay);
          return;
        }
      }
      if (error.code == 404) {
        // console.log('File not found: ' + url);
        err.httpStatusCode = 404;
        return callback(error);
      } else if (error.code) {
        // console.log('File download error:', url, error.code);
        error.httpStatusCode = err.code;
        return callback(error);
      } else {
        // console.log('Download error:', err.message);
      }
      return callback(error);
    }

    if (response.statusCode != 200) {
      var error = new Error('Request failed with status code ' + response.statusCode);
      error.httpStatusCode = response.statusCode;
      return callback(error);
    }

    var content_type = response.headers['content-type'];
    if (content_type && content_type.indexOf('html') == -1) {
      // console.log(response.headers);
      var error = new Error('Not HTML page (' + content_type + ')');
      error.httpStatusCode = response.statusCode;
      error.httpHeaders = response.headers;
      return callback(error);
    }

    return callback(null, {
      requested_url: url,
      resolved_url: response.request.href,
      html: html
    });
  });
}

exports.downloadPage = function(url, options, attempts, callback) {
  if (typeof options == 'function') {
    callback = options;
    options = {};
    attempts = 0;
  }
  if (typeof attempts == 'function') {
    callback = attempts;
    attempts = 0;
  }

  var request_url = url;
  if (options.html_proxy && options.html_proxy != '') {
    request_url = options.html_proxy + '?url=' + encodeURIComponent(request_url);
  }

  var request_options = {
    url: request_url,
    headers: options.request_headers || {
      'User-Agent': options.user_agent || 'request'
    },
    timeout: options.request_timeout || 20000 /* 20 seconds */
  };
  requestWithEncoding(request_options, function(error, response, html) {
    if (error) {
      // console.log(error);
      attempts++;
      if (error.code == "ESOCKETTIMEDOUT" || error.code == "ETIMEDOUT" || error.code == "ECONNRESET") {
        var max_attempts = options.max_attempts || 5;
        var backoff_delay = options.backoff_delay || 5000; // 5 seconds
        if (attempts < max_attempts) {
          // console.log('Timeout! Retrying... (' + attempts + ')');
          setTimeout(function() {
            exports.downloadPage(url, options, attempts, callback);
          }, backoff_delay);
          return;
        }
      }
      if (error.code == 404) {
        // console.log('File not found: ' + url);
        error.httpStatusCode = 404;
        return callback(error);
      } else if (error.code) {
        // console.log('File download error:', url, error.code);
        error.httpStatusCode = error.code;
        return callback(error);
      } else {
        // console.log('Download error:', err.message);
      }
      return callback(error);
    }

    // console.log('\x1b[36m%s\x1b[0m', response.request.method + ' ' + 
    //   response.request.href + ' ' + response.statusCode);

    if (response.statusCode != 200) {
      var error = new Error('Request failed with status code ' + response.statusCode);
      error.httpStatusCode = response.statusCode;
      return callback(error);
    }

    var content_type = response.headers['content-type'];
    if (content_type && content_type.indexOf('html') == -1) {
      // console.log('Requested data is not HTML.');
      var error = new Error('Requested data is not HTML');
      error.httpStatusCode = response.statusCode;
      error.httpContentType = content_type;
      return callback(error);
    }

    var page_url = response.request.href;
    if (options.html_proxy && options.html_proxy != '') {
      page_url = url;
    }

    var $ = cheerio.load(html);
    
    var page_base_url = null;
    if ($('head base').length) {
      page_base_url = $('head base').attr('href');
    }

    // Fix links
    var page_host_url = utils.urlGetHost(page_url);
    var page_host_url_obj = urlutil.parse(page_host_url);
    var page_url_obj = urlutil.parse(page_base_url || page_url);
    
    $('body a').each(function(){
      var link_href = $(this).attr('href');
      if (!utils.isValidLink(link_href)) return;
      var link_url = link_href;
      link_url = link_url.replace('http:///', '/');
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
      $(this).attr('href', link_url);
    });

    callback(null, { 
      url: page_url, 
      base_url: page_base_url,
      $: $, 
      html: html 
    });
  });
}

exports.downloadImage = function(image_src, options, callback) {
  // console.log('downloadImage():', image_src);

  var image_file = '';
  if (typeof options.image_file != 'undefined') {
    image_file = options.image_file;
  } else {
    var image_src_obj = urlutil.parse(image_src);
    image_file = path.basename(image_src_obj.pathname);  
  }
  if (typeof options.output_dir != 'undefined') {
    image_file = path.join(options.output_dir, image_file);
  }
  if (options.skip_if_exist && utils.fileExists(image_file)) {
    // console.log('File exists: ' + utils.ellipsisMiddle(image_file));
    return callback(null, { file: image_file });
  }

  exports.downloadFile(image_src, image_file, options, callback);
}

exports.downloadImages = function(images, options, callback) {
  if (typeof options == 'function') {
    callback = options;
    options = {};
  }
  options = options || {};
  callback = callback || function(err) {};

  if (typeof options.output_dir != 'undefined') {
    utils.ensureDirectoryExists(options.output_dir);
  }

  // console.log('downloadImages:', images.length);
  
  var max_download_threads = options.max_download_threads || 4;
  // limit 4 concurrent downloads at a time
  async.eachLimit(images, max_download_threads, function(image_info, cb) { 
    
    var image_src = '';
    var image_file = '';
    if (typeof image_info == 'string') {
      image_src = image_info;        
      var image_src_obj = urlutil.parse(image_src);
      image_file = path.basename(image_src_obj.pathname);
    } else if (typeof image_info == 'object') {
      image_src = image_info.image_src || image_info.src;
      image_file = image_info.image_file || image_info.file || path.basename(image_src);
    }

    var download_options = {
      image_file: image_file,
      output_dir: options.output_dir,
      skip_if_exist: options.skip_if_exist,
      return_headers: options.return_headers,
      no_rename: options.no_rename,
      request_headers: options.request_headers,
      request_timeout: options.request_timeout,
      // callbacks
      onProgress: options.progress || options.onProgress,
      onDownloadStart: options.onDownloadStart,
      onDownloadTimeout: options.onDownloadTimeout,
      onDownloadFailed: options.onDownloadFailed,
      onRename: options.onRename,
      onDownloadFinished: options.onDownloadFinished
    };

    exports.downloadImage(image_src, download_options, function(err, result) {
      if (err) {
        if (typeof image_info == 'object') {
          image_info.error = true;
          if (typeof err.code != 'undefined') {
            image_info.error_code = err.code;
          }
        }
        return cb(/*err*/);
      } else {
        if (image_info.image_file) {
          image_info.image_file = path.basename(result.file);
        } else {
          image_info.file = path.basename(result.file);
        }
      }
      cb();
    });
  }, function(err) {
    if (err) {
      // console.log('downloadImages:', err);
      return callback(err);
    }
    // console.log('downloadImages: done.');
    callback(null, images);
  });
}

