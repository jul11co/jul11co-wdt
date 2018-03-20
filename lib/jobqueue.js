// lib/jobqueue.js

var JobQueue = function(options) {
  var self = this;
  var options = options || {};
  var debug = options.debug || false;

  self.jobs = [];

  self.jobCount = function() {
    return self.jobs.length;
  }

  self.pushJob = function(args, fun, callback) {
    self.jobs.push({
      args: args,
      fun: fun,
      callback: callback
    });

    if (debug) {
      console.log("Jobs: " + self.jobs.length);
    }
    
    if (self.jobs.length == 1) { // no other jobs running
      // processJob(args, fun, callback);
      process.nextTick(function() {
        processNextJob();
      });
    }
  }

  // function mockProcessFunc(args, callback) {
  //   callback();
  // }

  function processJob(args, fun, callback) {
    if (fun) {
      fun(args, processJobCallback);
    } else {
      // mockProcessFunc(args, processJobCallback);
      processJobCallback();
    }
  }

  function processNextJob() {
    if (self.jobs.length > 0) {
      if (debug) {
        console.log("Remaining jobs: " + self.jobs.length);
      }
      processJob(self.jobs[0].args, self.jobs[0].fun, processJobCallback);
    }
  }

  function processJobCallback(err, result) {
    // if (err) console.log(err);
    if (self.jobs.length > 0) {
      var callback = self.jobs[0].callback;
      callback(err, result);
      self.jobs.shift(); // remove job from queue
      process.nextTick(function() {
        processNextJob();
      });
    }
  }
}

module.exports = JobQueue;
