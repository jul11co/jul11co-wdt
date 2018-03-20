// lib/scraper.js

var urlutil = require('url');
var zlib = require('zlib');
var fs = require('fs');

var request = require('request');
var cheerio = require('cheerio');

var requestWithEncoding = function(options, callback) {
  var req_err = null;
  var req = null;

  try {
    req = request.get(options);
  } catch (e) {
    req_err = e;
    return callback(req_err);
  }
  
  req.on('response', function(res) {
    var chunks = [];
    res.on('data', function(chunk) {
      chunks.push(chunk);
    });

    res.on('end', function() {
      if (req_err) {
        return;
      }
      var buffer = Buffer.concat(chunks);
      var encoding = res.headers['content-encoding'];
      if (encoding == 'gzip') {
        zlib.gunzip(buffer, function(err, decoded) {
          callback(err, res, decoded && decoded.toString());
        });
      } else if (encoding == 'deflate') {
        zlib.inflate(buffer, function(err, decoded) {
          callback(err, res, decoded && decoded.toString());
        })
      } else {
        callback(null, res, buffer.toString());
      }
    });
  });

  req.on('error', function(err) {
    if (!req_err) {
      req_err = err;
      callback(err);  
    }
  });
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

exports.urlGetHost = urlGetHost; 

function isValidLink(link_href) {
  if (!link_href || link_href === '') return false;
  if (link_href.indexOf('#') == 0 
    || link_href.indexOf('mailto:') >= 0 
    || link_href.indexOf('javascript:') == 0
    || link_href.indexOf('data:') == 0) {
    return false;
  }
  return true;
}

exports.isValidLink = isValidLink; 

var page_scrapers = [];

// var utils = require('./utils');

// if (utils.directoryExists(__dirname + '/scrapers')) {
//   fs.readdirSync(__dirname + '/scrapers').forEach(function(file) {
//     if (file.indexOf('.js') > 0) {
//       var scraper = require("./scrapers/" + file);
//       page_scrapers.push(scraper);
//     }
//   });
// }

// scraper
// {
//   name: String,
//   url_match: new RegExp(...), // DEPRECATED
//   match: function(link, options) {...},
//   scrape: function($, page, options) {...}
// }
exports.addScraper = function(scraper) {
  // console.log('Add scraper:', scraper.name);
  page_scrapers.push(scraper);
}

exports.fixImages = function($, page_info, options) {
  options = options || {};

  var page_host_url = urlGetHost(page_info.url);
  var page_host_url_obj = urlutil.parse(page_host_url);
  var page_url_obj = urlutil.parse(page_info.base_url || page_info.url);

  $('img').each(function(){
    var image_src = $(this).attr('src');

    if (image_src && image_src != "") {
      var image_url = image_src;
      if (!isValidLink(image_url)) return;

      var image_url_obj = urlutil.parse(image_url);
      if (!image_url_obj.host) {
        // image_url = urlutil.resolve(page_url_obj, image_url_obj);
        if (image_url.indexOf('/') == 0) {
          image_url = urlutil.resolve(page_host_url_obj, image_url_obj);
        } else {
          image_url = urlutil.resolve(page_url_obj, image_url_obj);
        }
      } else {
        image_url = urlutil.format(image_url_obj);
      }

      if (image_url != image_src) {
        $(this).attr('src', image_url);
      }
    }
  });
}

exports.fixLinks = function($, page_info, options) {
  options = options || {};

  var page_host_url = urlGetHost(page_info.url);
  var page_host_url_obj = urlutil.parse(page_host_url);
  var page_url_obj = urlutil.parse(page_info.base_url || page_info.url);

  $('body a').each(function(){
    var link_href = $(this).attr('href');
    var link_title = $(this).text().trim();
    if (!isValidLink(link_href)) return;

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

    if (link_url != link_href) {
      $(this).attr('href', link_url);
    }
  });
}

// options
// {
//   blacklist: [String],
//   visited_links: [String],
//   filters: [String],
//   validator: function(link) {...},
//   exclude_visited_links: Boolean
// }
exports.getLinks = function($, page, selector, options) {
  // console.log('getLinks()');
  options = options || {};
  
  var blacklist = options.blacklist || [];
  var visited_links = options.visited_links || [];
  var filters = options.filters || [];
  
  var isVisited = function(link) {
    if (visited_links && visited_links.length) { // && Array.isArray(visited_links) 
      return (visited_links.indexOf(link) >= 0);
    }
    return false;
  }
  
  var links = [];
  var page_host_url = urlGetHost(page.url);
  var page_host_url_obj = urlutil.parse(page_host_url);
  var page_url_obj = urlutil.parse(page.base_url || page.url);
  
  $('' + selector + ' a').each(function(){
    var link_href = $(this).attr('href');
    if (!isValidLink(link_href)) return;
    
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

// options
// {
//   blacklist: [String],
//   filters: [String]
// }
exports.getImages = function($, page, selector, options) {
  // console.log('getImages()');
  options = options || {};
  
  var blacklist = options.blacklist || [];
  var filters = options.filters || [];
  var image_urls = [];
  var image_file_names = [];
  var images = [];

  var page_host_url = urlGetHost(page.url);
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

// Extract page info from URL
//
// options
// {
//   include_html: Boolean, /* default: false */
//   include_html_body: Boolean, /* default: false */
//   include_images: Boolean, /* default: false */
//   include_og: Boolean, /* default: false */
// }
// 
// Default page info
// {
//   url: String,
//   title: String,
//   description: String,
//   image: String,
//   icon: String
// }
exports.scrape = function(request_url, options, callback) {
  // console.log("Extract page info: " + request_url);
  
  var request_options = {
    url: request_url,
    // jar: true,
    headers: {
      'User-Agent': 'request'
    },
    timeout: 20000 /* 20 seconds */
  };

  requestWithEncoding(request_options, function(error, response, html){
    if (error) {
      // console.log(error);
      return callback(error);
    }

    var page_info = {};

    // Page URL (real)
    page_info.url = response.request.href;

    page_info.content_type = response.headers['content-type'];
    if (page_info.content_type && page_info.content_type.indexOf('html') == -1) {
      console.log(response.headers);
      return callback(new Error('Not HTML page (' + page_info.content_type + ')')); 
    }

    var $ = cheerio.load(html);

    if ($('head base').length) {
      page_info.base_url = $('head base').attr('href');
    }

    if (options.include_html) {
      page_info.html = html;
    }

    if (options.include_html_body) {
      page_info.html_body = $.html('body');
    }

    // Page icon
    page_info.icon = $('link[rel="shortcut icon"]').attr('href');
    if (!page_info.icon) {
      page_info.icon = $('link[rel="icon"]').attr('href');
    }

    // Page title
    page_info.title = $('title').first().text();
    if (page_info.title) {
      page_info.title = page_info.title.replace(/(\r\n|\n|\r)/gm, '');
    }

    // Page description
    page_info.description = $('meta[name*=description]').attr('content');
    if (page_info.description) {
      page_info.description = page_info.description.replace(/(\r\n|\n|\r)/gm, '');
    }

    exports.fixImages($, page_info, options);
    exports.fixLinks($, page_info, options);

    // Page images
    if (options.include_images) {
      page_info.images = [];
      var image_urls = [];

      $('img').each(function(){
        var image_src = $(this).attr('src');
        var image_alt = $(this).attr('alt');

        if (!isValidLink(image_src)) return;

        if (image_urls.indexOf(image_src) == -1) {
          image_urls.push(image_src);
          page_info.images.push({
            src: image_src,
            alt: image_alt
          });
        }
      });
    }

    // Page links
    if (options.include_links) {
      page_info.links = [];
      
      var links = [];
      var blacklist = options.link_blacklist;
      var filters = options.link_filters;

      $('body a').each(function(){
        var link_href = $(this).attr('href');
        var link_title = $(this).text().trim();

        if (!isValidLink(link_href)) return;

        var link_url = link_href.split('#')[0];

        // blacklist
        if (typeof blacklist != 'undefined' && blacklist.length) {
          for (var i = 0; i < blacklist.length; i++) {
            if (link_url.indexOf(blacklist[i]) >= 0) return;
          }
        }
        // filters
        if (typeof filters != 'undefined' && filters.length) {
          for (var i = 0; i < filters.length; i++) {
            if (link_url.indexOf(filters[i]) == -1) return;
          }
        }

        if (links.indexOf(link_url) == -1) {
          links.push(link_url);
          page_info.links.push({
            url: link_url,
            title: link_title
          });
        }
      });
    }

    if (options.include_body) {
      page_info.body = $('body').html();
    }

    // Open Graph meta tags
    var og_metadata = {
      url: $('meta[property="og:url"]').attr('content'),
      type: $('meta[property="og:type"]').attr('content'),
      title: $('meta[property="og:title"]').attr('content'),
      description: $('meta[property="og:description"]').attr('content'),
      image: $('meta[property="og:image"]').attr('content')
    };

    if (options.include_og) {
      page_info.og = og_metadata;
    }
    
    if ((!page_info.image || page_info.image == '') && og_metadata.image) {
      page_info.image = og_metadata.image;
    }
    if (page_info.description == '' && og_metadata.description && og_metadata.description != '') {
      page_info.description = og_metadata.description.replace(/(\r\n|\n|\r)/gm, '');
    }

    if (page_scrapers.length) {
      var scrapers = [];
      for (var i = 0; i < page_scrapers.length; i++) {
        if (page_scrapers[i].match(page_info.url, options)) {
          scrapers.push(page_scrapers[i]);
        }
      }
      scrapers.forEach(function(scraper) {
        scraper.scrape($, page_info, options);
      });
    }

    callback(null, page_info);
  });
}
