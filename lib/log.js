
module.exports.debug = function() {
  // if (!options.debug)
  //   return
  console.log.apply(console, arguments);
}
