"use strict";

let adapter;

//  Core-modules ...
const Promise = require("bluebird");

//  ioBroker specific modules
const iobHelpers = require("./iobHelpers");
const myLogger = new iobHelpers.IobLogger(adapter);

const dpPrefix = {
    "adapter": null,
    "circles": "circles",
    "people": "people",
    "places": "places"
};

const dpLife360Type = {
    "circle": "device",
    "place": "device",
    "person": "device",
    "members": "channel",
    "places": "channel"
};

/**
 * Logger is a wrapper for logging.
 * @param {*} level Set to "error", "warn", "info", "debug"
 * @param {*} message The message to log
 */
function logger(level, message) {
    myLogger.logger(level, message);
}

/** 
 * Set ioBroker adapter instance for the connector
 *  @param {*} adapter_in The adapter instance for this connector.
*/
exports.setAdapter = function(adapter_in) {
    adapter = adapter_in;
    myLogger.setAdapter(adapter);
};

exports.getPrefix_Circles = function() {
    return dpPrefix.circles;
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
 * Creates an OpenStreetMap URL to show the given position.
 * @param {number} lat Set to GPS latitude.
 * @param {number} lon Set to GPS longitude.
 * @param {number} zoom Set to zoom factor 1 up to 19.
 */
function getOpenStreetMapUrl(lat, lon, zoom) {
    if (!zoom) zoom = 15;
    return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=${zoom}/${lat}/${lon}`;
}

/**
 * ============================================================================
 * ----------------------------------------------------------------------------
 *      ioBroker Datapoint helper functions
 * ----------------------------------------------------------------------------
 * ============================================================================
 */

/**
 * Creates an ioBroker Datapoint Object
 * @param {*} dpId The datapoint's id.
 * @param {*} obj ioBroker datapoint object.
 */
async function createDataPointRawAsync(dpId, obj) {
    //  Create ioBroker object if it does not exists
    await adapter.setObjectNotExistsAsync(dpId, obj);
    return obj;
}

/**
 * Wrapper to easily create an ioBroker Datapoint Object
 * @param {*} dpId The datapoint's id
 * @param {*} dpType Type of the datapoint
 * @param {*} dpName Name of the datapoint
 * @param {*} dpDesc Description of the datapoint
 */
async function createObjectDP(dpId, dpType, dpName, dpDesc) {
    const obj = {
        "_id": dpId,
        "type": dpType,
        "common": {
            "name": dpName,
            "desc": dpDesc
        },
        "native": {}
    };

    //  Create ioBroker object if it does not exists
    return await createDataPointRawAsync(dpId, obj);
}

/**
 * Wrapper to easily create an ioBroker State datapoint
 * @param {*} dpId The datapoint's id
 * @param {*} dpName Name of the datapoint
 * @param {*} dpRead Set to true to grant read access to the datapoint.
 * @param {*} dpWrite Set to true to grad write access to the datapoint.
 * @param {*} dpType Type of the datapoint
 * @param {*} dpRole Role of the datapoint
 */
async function createStateDP(dpId, dpName, dpRead, dpWrite, dpType, dpRole) {
    const obj = {
        "_id": dpId,
        "type": "state",
        "common": {
            "name": dpName,
            "read": dpRead,
            "write": dpWrite,
            "type": dpType,
            "role": dpRole
        },
        "native": {}
    };

    //  Create ioBroker object if it does not exists
    return await createDataPointRawAsync(dpId, obj);
}

// function createStateReadOnlyDP(dpId, dpName, dpType, dpRole) {
//     return createStateDP(dpId, dpName, true, false, dpType, dpRole);
// }

/**
 * Creates a state datapoint and to set it's value.
 * @param {*} dpId The datapoint's id
 * @param {*} dpName Name of the datapoint
 * @param {*} dpRead Set to true to grant read access to the datapoint.
 * @param {*} dpWrite Set to true to grad write access to the datapoint.
 * @param {*} dpType Type of the datapoint
 * @param {*} dpRole Role of the datapoint
 * @param {*} val The state's value
 * @param {*} ack Ack?
 */
async function setStateValue(dpId, dpName, dpRead, dpWrite, dpType, dpRole, val, ack) {
    myLogger.silly(`setStateValue --> ${dpId} = ${val}`);

    //  Create ioBroker state object
    const obj = createStateDP(dpId, dpName, dpRead || true, dpWrite || true, dpType, dpRole);

    //  Update state
    await adapter.setStateAsync(dpId, val, ack);

    return obj;
}

/**
 * Wrapper to create a read only state datapoint and to set it's value.
 * @param {*} dpId The datapoint's id
 * @param {*} dpName Name of the datapoint
 * @param {*} dpType Type of the datapoint
 * @param {*} dpRole Role of the datapoint
 * @param {*} val The state's value
 * @param {*} ack Ack?
 */
async function setStateReadOnlyValue(dpId, dpName, dpType, dpRole, val, ack) {
    // myLogger.silly(`setStateReadOnlyValue --> ${dpId} = ${val}`);

    return setStateValue(dpId, dpName, true, false, dpType, dpRole, val, ack);
}

/**
 * Returns an array of persons for the members of the given circles.
 * @param {array} circles The Life360 circles to process.
 */
function getPersons(circles) {
    let persons = [];

    for (let c in circles) {
        const circle = circles[c];

        for (let m in circle.members) {
            const member = circle.members[m];

            if (!(persons.some(person => person.id === member.id))) {
                //  Add new person to the array
                persons.push(member);
            }
        }
    }

    return persons;
}

/**
 * Returns an array of places for the given circles.
 * @param {array} circles The Life360 circles to process.
 */
function getPlaces(circles) {
    let places = [];

    for (let c in circles) {
        const circle = circles[c];

        for (let p in circle.places) {
            const place = circle.places[p];

            if (!(places.some(aPlace => aPlace.id === place.id))) {
                //  Add new place to the array
                places.push(place);
            }
        }
    }

    return places;
}

/**
 * ============================================================================
 * ----------------------------------------------------------------------------
 *      This is the primary receiver for the Life360 cloud data (circles.)
 * ----------------------------------------------------------------------------
 * ============================================================================
 */

/**
 * This is the primary receiver for the Life360 cloud data (circles.)
 * @param {*} err Set to false, if no error occured, otherwise Error object.
 * @param {object} cloud_data The cloud data object to publish to ioBroker. 
 */
exports.publishCloudData = function(err, cloud_data) {

    if (!err) {
        //  Get all Life360 places from the circles.
        cloud_data.places = getPlaces(cloud_data.circles);

        //  Get all Life360 circles' members.
        cloud_data.persons = getPersons(cloud_data.circles);

        //  Publish all known Life360 places to ioBroker
        publishPlaces(cloud_data.places);

        //  Publish all known Life360 circles' members
        publishPeople(cloud_data.persons);

        //  Publish the circles
        publishCircles(cloud_data.circles);

        //  That's it.
        myLogger.debug("Life360 cloud data processed.");
    }
    else {
        logger("error", err);
    }
};

/**
 * ============================================================================
 * ----------------------------------------------------------------------------
 *      Functions to publish Life360 places to ioBroker
 * ----------------------------------------------------------------------------
 * ============================================================================
 */

/**
  * 
  * @param {*} places 
  */
function publishPlaces(places) {
    for (let p in places) {
        try {
            publishPlace(places[p]);
            myLogger.silly(`Created / updated place ${places[p].id} --> ${places[p].name}`);
        } catch (error) {
            myLogger.error(error);
        }
    }

    myLogger.debug(`Published ${places.length} place(s) to ioBroker.`);
}

/**
 * 
 * @param {*} place 
 */
async function publishPlace(place) {
    // {
    //     "id": "<GUID>",
    //     "ownerId": "owner <GUID>",
    //     "circleId": "circle <GUID>",
    //     "name": "<Name of the place>",
    //     "latitude": "<LAT>",
    //     "longitude": "<LON>",
    //     "radius": "<RADIUS>",
    //     "type": null,
    //     "typeLabel": null
    // },

    //  Create an object for the place
    const dpPlace = await createPlaceDP(place);

    //  Now set the place's states.
    await createPlaceStateDP(dpPlace._id, "id", place.id);
    await createPlaceStateDP(dpPlace._id, "ownerId", place.ownerId);
    await createPlaceStateDP(dpPlace._id, "circleId", place.circleId);
    await createPlaceStateDP(dpPlace._id, "name", place.name);
    await createPlaceStateDP(dpPlace._id, "latitude", Number(place.latitude));
    await createPlaceStateDP(dpPlace._id, "longitude", Number(place.longitude));
    await createPlaceStateDP(dpPlace._id, "radius", Number(place.radius));

    //  Finally create an OpenStreetMap URL
    await createPlaceStateDP(dpPlace._id, "urlMap", getOpenStreetMapUrl(Number(place.latitude), Number(place.longitude), 15));
}

/**
 * Creates an object datapoint for a place
 * @param {*} place The place object.
 * @param {*} id Optional. Will be set to ${dpPrefix.places}.${place.id} if missing.
 */
function createPlaceDP(place, id) {
    let dpId;
    if (typeof id === "undefined")
        dpId = `${dpPrefix.places}.${place.id}`;
    else
        dpId = id;

    return createObjectDP(dpId, dpLife360Type.place, place.name, place.name);
}

async function createPlaceStateDP(idDP, state, val) {
    let cRole = "state";
    const cType = typeof(val);
    // const dpID_state = `${idDP}.${state}`;
        
    switch (state) {
        case "createdAt":
            cRole = "date";
            break;

        case "latitude":
            cRole = "value.gps.latitude";
            break;

        case "longitude":
            cRole = "value.gps.longitude";
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

    const obj = await setStateReadOnlyValue(`${idDP}.${state}`, state, cType, cRole, val, true);

    return obj;
}

/**
 * ============================================================================
 * ----------------------------------------------------------------------------
 *      Functions to publish Life360 people to ioBroker
 * ----------------------------------------------------------------------------
 * ============================================================================
 */

/**
  * 
  * @param {*} persons 
  */
function publishPeople(persons) {
    for (let p in persons) {
        try {
            publishPerson(persons[p]);
            myLogger.silly(`Created / updated person ${persons[p].id} --> ${persons[p].name}`);
        } catch (error) {
            myLogger.error(error);
        }
    }

    myLogger.debug(`Published ${persons.length} people to ioBroker.`);
}

/**
 * 
 * @param {*} person 
 * @param {*} idParentDp 
 */
async function publishPerson(person, idParentDp) {
    /*
    {
        "features": {
            "device": "1",
            "smartphone": "1",
            "nonSmartphoneLocating": "0",
            "geofencing": "1",
            "shareLocation": "1",
            "shareOffTimestamp": null,
            "disconnected": "0",
            "pendingInvite": "0",
            "mapDisplay": "1"
        },
        "issues": {
            "disconnected": "0",
            "type": null,
            "status": null,
            "title": null,
            "dialog": null,
            "action": null,
            "troubleshooting": "0"
        },
        "location": {
            "latitude": "<LAT>",
            "longitude": "<LON>",
            "accuracy": "<ACCURACY>",
            "startTimestamp": <UNIX Timestamp>,
            "endTimestamp": "<UNIX Timestamp>",
            "since": <UNIX Timestamp>,
            "timestamp": "<UNIX Timestamp>",
            "name": null,
            "placeType": null,
            "source": null,
            "sourceId": null,
            "address1": null,
            "address2": "",
            "shortAddress": "",
            "inTransit": "0",
            "tripId": null,
            "driveSDKStatus": null,
            "battery": "<BATT LEVEL>",
            "charge": "0",
            "wifiState": "1",
            "speed": 0,
            "isDriving": "0",
            "userActivity": null
        },
        "communications": [
            {
                "channel": "Voice",
                "value": "+1....",
                "type": "Home"
            },
            {
                "channel": "Email",
                "value": "me@my.local",
                "type": null
            }
        ],
        "medical": null,
        "relation": null,
        "createdAt": "<UNIX Timestamp>",
        "activity": null,
        "id": "<GUID>",
        "firstName": "...",
        "lastName": "...",
        "isAdmin": "0",
        "avatar": null,
        "pinNumber": null,
        "loginEmail": "me@my.local",
        "loginPhone": "+1...."
    }
    */

    //  Create an object for the person
    let dpId = `${dpPrefix.people}.${person.id}`;
    if (typeof idParentDp !== "undefined") dpId = `${idParentDp}.${person.id}`;

    const dpPerson = await createPersonDP(person, dpId);

    //  Now set the person's states.
    await createPersonStateDP(dpPerson._id, "id", person.id);
    await createPersonStateDP(dpPerson._id, "createdAt", Number(person.createdAt) * 1000);
    await createPersonStateDP(dpPerson._id, "firstName", person.firstName);
    await createPersonStateDP(dpPerson._id, "lastName", person.lastName);
    await createPersonStateDP(dpPerson._id, "avatar", person.avatar);
    // await createPersonStateDP(dpPerson._id, "loginEmail", person.loginEmail);
    // await createPersonStateDP(dpPerson._id, "loginPhone", person.loginPhone);
    await createPersonStateDP(dpPerson._id, "latitude", Number(person.location.latitude));
    await createPersonStateDP(dpPerson._id, "longitude", Number(person.location.longitude));
    await createPersonStateDP(dpPerson._id, "disconnected", Boolean(person.issues.disconnected));
    await createPersonStateDP(dpPerson._id, "status", person.issues.status || "Ok");
    await createPersonStateDP(dpPerson._id, "lastPositionAt", Number(person.location.timestamp) * 1000);
    
    //  Finally create an OpenStreetMap URL
    await createPersonStateDP(dpPerson._id, "urlMap", getOpenStreetMapUrl(Number(person.location.latitude), Number(person.location.longitude), 15));
}

/**
 * Creates an object datapoint for a person
 * @param {*} person The person object.
 * @param {*} id Optional. Will be set to ${dpPrefix.people}.${person.id} if missing.
 */
function createPersonDP(person, id) {
    let dpId;
    if (typeof id === "undefined")
        dpId = `${dpPrefix.people}.${person.id}`;
    else
        dpId = id;
    
    // myLogger.info(`PERSON ${dpId} --> ${person.firstName} ${person.lastName}`);
    return createObjectDP(dpId, dpLife360Type.person, `${person.firstName} ${person.lastName}`, `${person.firstName} ${person.lastName}`);
}

/**
 * 
 * @param {*} idDP 
 * @param {*} state 
 * @param {*} val 
 */
async function createPersonStateDP(idDP, state, val) {
    let cRole = "state";
    const cType = typeof(val);
        
    switch (state) {
        case "createdAt":
        case "lastPositionAt":
            cRole = "date";
            break;

        case "latitude":
            cRole = "value.gps.latitude";
            break;

        case "longitude":
            cRole = "value.gps.longitude";
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

    const obj = await setStateReadOnlyValue(`${idDP}.${state}`, state, cType, cRole, val, true);

    return obj;
}

/**
 * ============================================================================
 * ----------------------------------------------------------------------------
 *      Functions to publish Life360 circles to ioBroker
 * ----------------------------------------------------------------------------
 * ============================================================================
 */

/**
 * 
 * @param {*} circles 
 */
function publishCircles(circles) {
    for (let c in circles) {
        try {
            publishCircle(circles[c]);
        } catch (error) {
            myLogger.error(error);
        }
    }

    myLogger.debug(`Published ${circles.length} circle(s) to ioBroker.`);
}

/**
 * 
 * @param {*} circle 
 * @param {*} idParentDp 
 */
async function publishCircle(circle, idParentDp) {
    //  Create an object for the circle
    let dpId;
    if (typeof idParentDp === "undefined") dpId = `${dpPrefix.circles}.${circle.id}`; else dpId = `${idParentDp}.${circle.id}`;

    // let dpId = `${dpPrefix.circles}.${circle.id}`;
    // if (typeof idParentDp !== "undefined") dpId = `${idParentDp}.${circle.id}`;

    const dpCircle = await createCircleDP(circle, dpId);

    //  Now set the circle's states.
    createCircleStateDP(dpCircle._id, "id", circle.id);
    createCircleStateDP(dpCircle._id, "name", circle.name);
    createCircleStateDP(dpCircle._id, "memberCount", Number(circle.memberCount));
    createCircleStateDP(dpCircle._id, "createdAt", Number(circle.createdAt) * 1000);

    //  Publish the circle's places including members' status.
    publishCirclePlaces(dpCircle._id, circle);
}

/**
 * Creates an object datapoint for a circle
 * @param {*} circle The circle object.
 * @param {*} id Optional. Will be set to ${dpPrefix.circles}.${circle.id} if missing.
 */
function createCircleDP(circle, id) {
    let dpId;
    if (typeof id === "undefined") dpId = `${dpPrefix.circles}.${circle.id}`; else dpId = id;
    
    return createObjectDP(dpId, dpLife360Type.circle, `${circle.name}`, `Life360 circle for ${circle.name}`);
}

/**
 * 
 * @param {*} idDP 
 * @param {*} state 
 * @param {*} val 
 */
async function createCircleStateDP(idDP, state, val) {
    let cRole = "state";
    const cType = typeof(val);
        
    switch (state) {
        case "createdAt":
            cRole = "date";
            break;

        case "latitude":
            cRole = "value.gps.latitude";
            break;

        case "longitude":
            cRole = "value.gps.longitude";
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

    const obj = await setStateReadOnlyValue(`${idDP}.${state}`, state, cType, cRole, val, true);

    return obj;
}

/**
 * 
 * @param {*} idDP 
 * @param {*} circle 
 */
async function publishCirclePlaces(idDP, circle) {
    const members = getPersons([ circle ]);
    const places = getPlaces([ circle ]);

    //  Are there any places?
    if (places.length > 0) {
        
        //  Create an object datapoint for the circle's places.
        const idCirclePlaces = `${idDP}.places`;
        if (createObjectDP(idCirclePlaces, "device", "Places", `${circle.name}'s places`)) {
            //  Places DP has been created.
            for (let p in places) {
                const place = places[p];
                //  Create an object datapoint for the place.
                const idPlace =`${idCirclePlaces}.${place.id}`;

                if (createObjectDP(idPlace, "device", place.name, `${place.name} (${circle.name})`)) {
                    //  Place DP created.
                    let memberCount = 0;

                    for (let m in members) {
                        const member = members[m];

                        //  Has member entered the place?
                        let memberEntered = false;
                        if (Number(member.issues.disconnected) == 0) memberEntered = (member.location.sourceId === place.id);

                        if (memberEntered) memberCount += 1;

                        //  Create an object datapoint for the member.
                        const idMember = `${idPlace}.${member.id}`;
                        if (createObjectDP(idMember, "channel", `${member.firstName} @ ${place.name}`, `${member.firstName} ${member.lastName} @ ${place.name} (${circle.name})`)) {
                            //  Member DP created.

                            //  Indicate if member is present at the place.
                            await setStateReadOnlyValue(`${idMember}.isPresent`, "Present", "indicator", "boolean", memberEntered, true);
                        }

                    }

                    //  Indicate the count of members present at the place.
                    await setStateReadOnlyValue(`${idPlace}.membersPresent`, `People @ ${place.name}`, "state", "number", memberCount, true);
                }
            }
        }
    }
}
