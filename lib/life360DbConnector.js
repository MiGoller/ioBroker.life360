/* eslint-disable indent */
"use strict";

const Promise = require("bluebird");

let adapter;

let prefix_adapter;
let prefix_circles;

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
 * Set ioBroker adapter instance for the connector
 *  @param {*} adapter_in The adapter instance for this connector.
*/
exports.setAdapter = function(adapter_in) {
    adapter = adapter_in;

    prefix_adapter = adapter.namespace;
    // prefix_circles = `${prefix_adapter}.circles`;
    prefix_circles = "circles";
};

exports.getPrefix_Circles = function() {
    return prefix_circles;
};

exports.createCircleState = function(circle) {
    return new Promise((resolve, reject) => {
        createCircleDP(circle)
            .then((result) => {
                resolve(result);
            }).catch((err) => {
                reject(err);
            });
    }); 
};

/**
 * 
 * @param {*} err Set to false, if no error occured, otherwise Error object.
 * @param {object} cloud_data The cloud data object to publish to ioBroker. 
 */
exports.publishCloudData = function(err, cloud_data) {
    logger("debug", "publishCloudData invoked");
    if (!err) {
        for (let oCircle in cloud_data.circles) {
            const circle = cloud_data.circles[oCircle];

            createCircleDP(circle)
                .then((result) => {
                    logger("debug", JSON.stringify(result));
                    createCircleStateDP(circle.id, "id", circle.id);
                    createCircleStateDP(circle.id, "name", circle.name);
                    createCircleStateDP(circle.id, "memberCount", Number(circle.memberCount));
                    createCircleStateDP(circle.id, "createdAt", Number(circle.createdAt) * 1000);
                }).catch((err) => {
                    logger("error", err);
                });

            // const members = life360Connector.getCircleMembers(circle);
            // for (let oMember in members) {
            //     let member = members[oMember].json;
            //     console.log(`circle ${circle.id} - ${member.firstName}`);
            // }
        }
    }
    else {
        logger("error", err);
    }
};

function getDatapointId_CircleId(circleId) {
    return new String(`${prefix_circles}.${circleId}`);
}

function getDatapointId_Circle(circle) {
    // return new String(`${prefix_circles}.${circle.id}`);
    const idCircle = getDatapointId_CircleId(circle.id);
    // logger("debug", `circle id = ${idCircle}`);
    return idCircle;
}

function createCircleDP(circle) {
    return new Promise((resolve, reject) => {
        // const idCircle = getDatapointId_Circle(circle);
        // // logger("debug", `--> circle id = ${idCircle}`);
        const obj = {
            "_id": `circles.${circle.id}`,
            "type": "device",
            "common": {
                "name": circle.name,
                "desc": `Life360 circle for ${circle.name}`
            },
            "native": {}
        };

        adapter.setObjectNotExists(`circles.${circle.id}`, obj, function(err) {
            if (!err)
                resolve(obj);
            else
                reject(err);
        });
    });
}

// create location's datapoints in the DB
function createCircleStateDP(circleId, state, val) {
    return new Promise((resolve, reject) => {
        let cRole = "state";
        const cType = typeof(val);
        const dpID_state = `${getDatapointId_CircleId(circleId)}.${state}`;
        
        switch (state) {
            case "createdAt":
                cRole = "date";
                break;
    
                
            default:
                switch(cType) {
                    case "string":
                        cRole = "text";
                        break;
                    case "number":
                        cRole = "value";
                        break;
                }
                break;
        }

        const obj = {
            "_id": dpID_state,
            "type": "state",
            "common": {
                "name": state,
                "read": true,
                "write": false,
                "type": cType,
                "role": cRole
            },
            "native": {}
            };

        adapter.setObjectNotExists(dpID_state, obj, function(err) {
            if (!err) {
                adapter.setState(dpID_state, val, true);
                resolve(obj);
            }
            else {
                reject(err);
            }
        });
    });
}
