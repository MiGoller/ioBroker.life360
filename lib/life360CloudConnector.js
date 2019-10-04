"use strict";

let adapter;

const Promise = require("bluebird");
const request = Promise.promisify(require("request"));
Promise.promisifyAll(request);

/**
 * Look up hard-coded "CLIENT_SECRET" in https://www.life360.com/circles/scripts/ccf35026.scripts.js !
 */
const LIFE360_CLIENT_SECRET = "U3dlcUFOQWdFVkVoVWt1cGVjcmVrYXN0ZXFhVGVXckFTV2E1dXN3MzpXMnZBV3JlY2hhUHJlZGFoVVJhZ1VYYWZyQW5hbWVqdQ==";

/**
 * The Life360 API URIs.
 * - login URL
 * - circles URL
 */
const LIFE360_URL = {
    login: "https://www.life360.com/v3/oauth2/token.json",
    circles: "https://www.life360.com/v3/circles"
};

const min_polling_interval = 15;    //  Min polling interval in seconds
const maxAgeToken = 300;            //  Max age of the Life360 token in seconds
let objTimeoutConnection = null;    //  Connection Timeout id
let objIntervalPoll = null;         //  Poll Interval id

/**
 * Stores authentication information for the current session.
 * - access token
 * - type of token
 */
let auth = {
    access_token: null,
    token_type: null
};
  
/**
 * Stores the data retrieved from Life360 cloud services.
 */
let cloud_data = {
    circles: []
};

/**
 * Logger is a wrapper for logging.
 * @param {*} level Set to "error", "warn", "info", "debug"
 * @param {*} message The message to log
 */
function logger(level, message) {
    switch (level) {
        case "error":
            if (!adapter) console.error(message); else adapter.log.error(message);
            break;
        
        case "warn":
            if (!adapter) console.warn(message); else adapter.log.warn(message);
            break;

        case "info":
            if (!adapter) console.log(message); else adapter.log.info(message);
            break;

        case "debug":
            if (!adapter) console.debug(message); else adapter.log.debug(message);
            break;
    
        default:
            break;
    }
}

/**
 * Updates the Life360 connector's state for the ioBroker instance.
 * @param {boolean} isConnected Set to true if connected.
 */
function setAdapterConnectionState(isConnected) {
    if (!adapter) {
        //  No adapter instance set.
    }
    else {
        adapter.setState("info.connection", isConnected);
    }
}

/** 
 * Set ioBroker adapter instance for the connector
 *  @param {*} adapter_in The adapter instance for this connector.
*/
exports.setAdapter = function(adapter_in) {
    adapter = adapter_in;
};

/**
 * Connect to the Life360 service.
 * Specify a username OR both a phone number and country code.
 * @param {*} username Life360 username, or undefined if phone specified.
 * @param {*} password Life360 password.
 * @param {*} phone Life360 phone, or undefined if username specified.
 * @param {*} countryCode Optional phone country code, defaults to 1 if not specified.
 */
exports.connectLife360 = function(username, password, phone, countryCode) {
    return new Promise((resolve, reject) => {
        if(!username || typeof username === "function") {
            if (!adapter) username = process.env.LIFE360_USERNAME; else username = adapter.config.life360_username;
        }
    
        if(!password || typeof password === "function") {
            if (!adapter) password = process.env.LIFE360_PASSWORD; else password = adapter.config.life360_password;
        }

        if(!phone || typeof phone === "function") {
            if (!adapter) phone = process.env.LIFE360_PHONE; else phone = adapter.config.life360_phone;
        }

        if(!countryCode || typeof countryCode === "function") {
            if (!adapter) countryCode = process.env.LIFE360_COUNTRYCODE; else countryCode = adapter.config.life360_countryCode;
        }

        logger("debug", "Connecting to Life360 service  ...");

        auth = {
            access_token: null,
            token_type: null
        };

        countryCode = typeof countryCode !== "undefined" ? countryCode : 1;
        username = typeof username !== "undefined" ? username : "";
        phone = typeof phone !== "undefined" ? phone : "";
        // if(!password) throw new Error("Life360: No password specified.");

        const options = {
            url: LIFE360_URL.login,
            method: "POST",
            body: `countryCode=${countryCode}&username=${username}&phone=${phone}&password=${password}&grant_type=password`,
            headers: {
                "Authorization": `Authorization: Basic ${LIFE360_CLIENT_SECRET}`,
                "Content-Type" : "application/x-www-form-urlencoded"
            },
            json: true
        };
        
        request(options)
            .then(response => {
                if ((response.statusMessage === "Forbidden") || !response.body["access_token"]) {
                    auth = {
                        access_token: null,
                        token_type: null
                    };
    
                    logger("error", "Connection established but Auth failure. Check your credentials!");
                    logger("debug", "Auth tokens deleted.");
    
                    reject(new Error("Connection established but Auth failure. Check your credentials!"));
                }
                else {
                    auth = {
                        access_token: response.body["access_token"],
                        token_type: response.body["token_type"]
                    };
    
                    logger("debug", `Logged in as user: ${username}, phone: ${phone}, access_token: ${auth.access_token}`);
                    logger("debug", "Saved Auth tokens.");
                    logger("info", "Connected to Life360.");

                    resolve(auth);
                }
            })
            .catch(err => {
                reject(new Error("Unable to connect: " + err));
            });
    });
};

/**
 * Ensures connection to the Life360 service.
 */
exports.connect = function() {
    return new Promise((resolve, reject) => {
        if (!exports.is_connected()) {
            logger("debug", "Not connected to Life360. Will try to connect ...");

            // exports.connectLife360(process.env.LIFE360_USERNAME, process.env.LIFE360_PASSWORD, process.env.LIFE360_PHONE, process.env.LIFE360_COUNTRYCODE)
            exports.connectLife360(null, null, null, null)
                .then(auth_new => {
                    auth = auth_new;

                    //  Set timeout to remove auth tokens
                    objTimeoutConnection = setTimeout(() => {
                        exports.disconnect();
                    }, (maxAgeToken / 3 * 2) * 1000);

                    setAdapterConnectionState(true);

                    resolve(auth);
                })
                .catch(err => {
                    exports.disconnect();
                    reject(new Error(err));
                });
        }
        else {
            resolve(auth);
        }
    });
};

/**
 * Disconnect from Life360 (i.e. clear all tokens)
 */
exports.disconnect = function() {
    clearTimeout(objTimeoutConnection);

    auth = {
        access_token: null,
        token_type: null
    };

    setAdapterConnectionState(false);

    logger("debug", "Auth tokens deleted.");
    logger("info", "Disconnected from Life360.");
};

/**
 * Returns true if connected to Life360 cloud services.
 */
exports.is_connected = function() {
    return auth.access_token;
};

/**
 * Returns the authentication information for Life360.
 */
exports.get_auth = function () {
    return auth;
};

/**
 * Returns a list of the user's Life360 circles.
 */
exports.getCircles = function(auth_in) {
    return new Promise((resolve, reject) => {
        if (!auth_in) auth_in = auth;

        const options = {
            url: LIFE360_URL.circles,
            headers: {
                "Authorization": `${auth_in.token_type} ${auth_in.access_token}`
            },
            json: true
        };

        logger("debug", `Retrieving circles at ${LIFE360_URL.circles}`);

        request(options)
            .then(response => {
                if (!response.body.circles) {
                    logger("error", "No circles found!");
                    reject(new Error("No circles found!"));
                }
                else {
                    if (response.body.circles.length == 0) {
                        logger("error", "No circles in your Life360.");
                        reject(new Error("No circles in your Life360."));
                    }
                    else {
                        logger("debug", "Retrieved circles.");
                        resolve(response.body.circles);
                    }
                }
            })
            .catch(err => {
                reject(new Error("Unable to poll circles: " + err));
            });
    });
};

/**
 * Returns details for a Life360 circle identified by the the circle's id.
 */
exports.getCircleById = function(auth_in, circleId) {
    return new Promise((resolve, reject) => {
        if (!auth_in) auth_in = auth;

        const LIFE360_CIRCLE_URL = `${LIFE360_URL.circles}/${circleId}`;
        const options = {
            url: LIFE360_CIRCLE_URL,
            headers: {
                "Authorization": `${auth_in.token_type} ${auth_in.access_token}`
            },
            json: true
        };

        logger("debug", `Retrieving circle at ${LIFE360_CIRCLE_URL}`);

        request(options)
            .then(response => {
                logger("debug", `Retrieved circle with id ${circleId} !`);
                resolve(response.body);
            })
            .catch(err => {
                reject(new Error(`Unable to poll circle with ID ${circleId}: ${err}`));
            });
    });
};

/**
 * Deprecated.
 */
exports.getCircleMembersPromise = function(circle_in) {
    return new Promise((resolve, reject) => {
        if (!circle_in) {
            reject(new Error("Provide a circle object, please."));
        }
        else {
            const members = [];

            if (circle_in.members.length == 0) {
                console.log("Circle has no members.");
            }
            else {
                for (let oMember in circle_in.members) {
                    let member = circle_in.members[oMember];
                    members.push( {id: member.id, json: member} );
                }
            }

            resolve(members);
        }
    });
};

/**
 * Returns an array conaining a circle's members.
 */
exports.getCircleMembers = function(circle_in) {
    const members = [];

    if (!circle_in) {
        logger("error", "Provide a circle object, please.");
    }
    else {
        if (circle_in.members.length == 0) {
            logger("debug", "Circle has no members.");
        }
        else {
            for (let oMember in circle_in.members) {
                let member = circle_in.members[oMember];
                members.push( {id: member.id, json: member} );
            }
        }
    }

    return members;
};

/**
 * Disables automatic polling.
 */
exports.disablePolling = function() {
    if (objIntervalPoll) {
        clearTimeout(objIntervalPoll);
        logger("debug", "Disabled polling.");

    }
};

/**
 * Enables automatic polling.
 */
exports.setupPolling = function(callback) {
    let polling_interval = min_polling_interval;

    if (!adapter) 
        polling_interval = Number(process.env.LIFE360_POLLING_INTERVAL); 
    else
        polling_interval = Number(adapter.config.life360_polling_interval);

    if (polling_interval < min_polling_interval) {
        logger("error", "Polling interval should be greater than " + min_polling_interval);

        return false;
    } else {
        exports.disablePolling();

        exports.poll(callback);
  
        // Enable polling
        objIntervalPoll = setInterval(() => {
            exports.poll(callback);
        }, polling_interval * 1000);

        logger("debug", `Polling enabled every ${polling_interval} secondes.`);
        return true;
    }
};

/** 
 * Initiates a Life360 cloud data poll and passes the data to a callback function.
*/
exports.poll = function(callback) {
    pollLife360Data()
        .then(cloud_data => {
            if (callback) {
                logger("debug", "Pushing cloud_data to callback function");
                callback(false, cloud_data);
            }
            return true;
        })
        .catch(err => {
            if (callback) {
                callback(err, null);
            }
            else {
                logger("error", `Error polling Life360 data: ${err}`);
            }
            return false;
        });
};

/**
 * Polls the Life360 cloud data
 */
function pollLife360Data() {
    return new Promise((resolve, reject) => {
        cloud_data.circles = [];

        exports.connect()
            .then(auth => {
                //  Connected and authenticated
                exports.getCircles(auth)
                    .then(circles => {
                        //  Circles polled
                        let circlePromises = [];
                        for (let oCircle in circles) {
                            circlePromises.push(exports.getCircleById(auth, circles[oCircle].id));
                        }

                        Promise.all(circlePromises)
                            .then((result) => {
                                //  Called when all promises are resolved!
                                cloud_data.circles = result;
                                logger("debug", `Retrieved data for ${cloud_data.circles.length} circle(s).`);
                                resolve(cloud_data);
                            })
                            .catch(err => {
                                logger("error", `Error while polling the Life360 circle data: ${err}`);

                                reject(new Error(`Error while polling the Life360 circle data: ${err}`));
                            });
                    })
                    .catch(err => {
                        logger("error", `Error while polling the Life360 circle data: ${err}`);

                        reject(new Error(`Error while polling the Life360 circle data: ${err}`));
                    });
                    
            })
            .catch(err => {
                logger("error", `Error while polling the Life360 circle data: ${err}`);

                reject(new Error(`Error while polling the Life360 data: ${err}`));
            });
    });
}
