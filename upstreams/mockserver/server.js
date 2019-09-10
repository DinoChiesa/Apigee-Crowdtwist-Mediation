// server.js
// -------------------------------------------------------------
//
// Crowdtwist mock that verifies HMACs.
//

/* jshint esversion: 9 */
/* global process, Buffer */

const express       = require('express'),
      morganLogging = require('morgan'),
      app           = express(),
      crypto        = require('crypto'),
      http          = require('http');

const hmacKeyLookupTable = {
        "apikey" : "hmacsecret",
        ABCl3y7r0s5ukCXz5lCJOCrTZ427pjp5 : "ABttp1b92Tb65445rmZL835f263n1q4Y"
      },
      gVersion      = '20190909-1422',
      hmacAlg = 'SHA256',
      FIFTEEN_MINUTES = 15 * 60 * 60;

function rawBody(req, res, next) {
  req.setEncoding('utf8');
  req.text = '';
  req.on('data', function(chunk) {
    req.text += chunk;
  });
  req.on('end', function(){
    next();
  });
}

app.set('trust proxy', true); // for X-Forwarded-For header from Google CLB
app.use(rawBody);
app.use(morganLogging('combined'));
app.set('json spaces', 2);

function returnError(response, statusCode, message) {
  response.status(statusCode)
    .json({ error: message})
    .end();
}

function unhandledRequest(req, response, next){
  returnError(response, 400, "unhandled request");
}

function calcMd5Hex(x) {
  var hash = crypto.createHash('md5').update(x).digest('hex');
  return hash;
}

function getMessageToHash(request) {
  let stamp = request.headers['x-ct-timestamp'];

  if ( ! stamp)
    throw new Error('missing timestamp');

  let bodyMd5 = (request.method == 'GET' || request.method == 'DELETE') ? '' : calcMd5Hex(request.text);
  let cType = (request.method == 'GET' || request.method == 'DELETE') ? '' : (request.headers['content-type'] || '');
  return request.method + '\n' +
    bodyMd5 + "\n" +
    cType + "\n" +
    stamp + "\n" +
    request.url;
}

function getSecretKey(publickey) {
  if ( ! hmacKeyLookupTable[publickey])
    throw new Error("invalid publickey");

  return hmacKeyLookupTable[publickey];
}

function getAuthzHeader(request){
  let authzHeader = request.headers['x-ct-authorization'];
  if ( ! authzHeader)
    throw new Error('missing authz header (1)');

  let parts = authzHeader.split(' ', 2);
  if (parts.length != 2)
    throw new Error('malformed authz header (1)');

  if (parts[0] != 'CTApiV2Auth')
    throw new Error('malformed authz header (2)');

  parts = parts[1].split(':', 2);
  if (parts.length != 2)
    throw new Error('malformed authz header (3)');
  return parts;
}

function checkHmac(request){
  let authzHeaderParts = getAuthzHeader(request),
      publicKey = authzHeaderParts[0],
      assertedHmac = authzHeaderParts[1],
      messageToHash = getMessageToHash(request),
      secretKey = getSecretKey(publicKey),
      hmac = crypto.createHmac(hmacAlg, secretKey),
      calculatedHmacHex = hmac.update(messageToHash).digest('hex'),
      base64Hmac = Buffer.from(calculatedHmacHex).toString('base64');

  return {
    messageToHash, base64Hmac, valid: (base64Hmac == assertedHmac)
  };
}

function requestHandler(request, response, next) {
  try {
    let check = checkHmac(request),
        timestamp = request.headers['x-ct-timestamp'] || "0",
        outboundPayload = {
          inbound: {
            method: request.method,
            url: request.url,
            sig: request.headers['x-ct-authorization'] || "undefined",
            timestamp
          },
          calculated : check
        };

    let statusCode = (check.valid) ? 200 : 401;

    // check timestamp
    let now = Math.floor((new Date()).valueOf() / 1000),
        tsNumber = new Number(timestamp);

    outboundPayload.validTimestamp = (now - tsNumber < FIFTEEN_MINUTES);

    if (request.text) outboundPayload.inbound.body = request.text;

    response.status(statusCode)
      .json(outboundPayload)
      .end();
  }
  catch (e) {
    console.log(e.stack);
    returnError(response, 400, e.message);
  }
}

app.post('/*', requestHandler);
app.put('/*', requestHandler);
app.get('/*', requestHandler);
app.delete('/*', requestHandler);

app.use(unhandledRequest);

let appinstance = app.listen(process.env.PORT || 5950, function() {
  console.log('Echo Listening on ' + appinstance.address().port);
});
