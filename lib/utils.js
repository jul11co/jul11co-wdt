// lib/utils.js

var path = require('path');
var fs = require('fs');
var urlutil = require('url');
var mkdirp = require('mkdirp');

function fileExists(file_path) {
  try {
    var stats = fs.statSync(file_path);
    if (stats.isFile()) {
      return true;
    }
  } catch (e) {
  }
  return false;
}

function directoryExists(directory) {
  try {
    var stats = fs.statSync(directory);
    if (stats.isDirectory()) {
      return true;
    }
  } catch (e) {
  }
  return false;
}

function ensureDirectoryExists(directory, options) {
  options = options || {};
  try {
    var stats = fs.statSync(directory);
    // if (stats.isDirectory()) {
    //   console.log('Directory exists: ' + directory);
    // }
  } catch (e) {
    // console.log(e);
    if (e.code == 'ENOENT') {
      // fs.mkdirSync(directory);
      mkdirp.sync(directory);
      if (options.verbose) console.log('Directory created: ' + directory);
    }
  }
}

function isHttpUrl(string) {
  var pattern = /^((http|https):\/\/)/;
  return pattern.test(string);
}

function isValidLink(link_href) {
  if (!link_href || link_href === '') return false;
  if (link_href.indexOf('#') == 0 
    || link_href.indexOf('mailto:') >= 0 
    || link_href.indexOf('javascript:') == 0) {
    return false;
  }
  return true;
}

function urlGetHost(_url) {
  if (!_url || _url == '') return '';
  var host_url = '';
  var url_obj = urlutil.parse(_url);
  if (url_obj.slashes) {
    host_url = url_obj.protocol + '//' + url_obj.host;
  } else {
    host_url = url_obj.protocol + url_obj.host;
  }
  return host_url;
}

function ellipsisMiddle(str, max_length, first_part, last_part) {
  if (!max_length) max_length = 65;
  if (!first_part) first_part = 40;
  if (!last_part) last_part = 20;
  if (str.length > max_length) {
    return str.substr(0, first_part) + '...' + str.substr(str.length-last_part, str.length);
  }
  return str;
}

// http://stackoverflow.com/questions/2998784/
function numberPad(num, size) {
  var s = "000000000" + num;
  return s.substr(s.length-size);
}

function escapeRegExp(string) {
  return string.replace(/([.*+?^=!:${}()|\[\]\/\\])/g, "\\$1");
}

function replaceAll(string, find, replace) {
  return string.replace(new RegExp(escapeRegExp(find), 'g'), replace);
}

function extractSubstring(original, prefix, suffix) {
  if (!original) return '';
  var tmp = original.substring(original.indexOf(prefix) + prefix.length);
  tmp = tmp.substring(0, tmp.indexOf(suffix));
  return tmp;
}

function trimText(input, max_length) {
  if (!input || input == '') return '';
  max_length = max_length || 60;
  var output = input.trim();
  if (output.length > max_length) {
    output = output.substring(0, max_length) + '...';
  }
  return output;
}

function trimLeft(string) {
  if (!string || string == '') return '';
  var tmp = string;
  while(tmp.charAt(0) == ' ') {
    tmp = tmp.substring(1);
  }
  return tmp;
}

module.exports = {
  fileExists: fileExists,
  directoryExists: directoryExists,
  ensureDirectoryExists: ensureDirectoryExists,

  isValidLink: isValidLink,
  urlGetHost: urlGetHost,
  ellipsisMiddle: ellipsisMiddle,
  numberPad: numberPad,
  isHttpUrl: isHttpUrl,

  trimText: trimText,
  trimLeft: trimLeft,

  replaceAll: replaceAll,
  extractSubstring: extractSubstring
}
