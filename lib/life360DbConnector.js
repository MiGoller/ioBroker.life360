"use strict";

let adapter;

//  Core-modules ...
const Promise = require("bluebird");
const GeoUtils = require("geolocation-utils");
const { DEFAULT_ECDH_CURVE } = require("tls");
const util = require("util");

//  ioBroker specific modules
const iobHelpers = require("./iobHelpers");
const myLogger = new iobHelpers.IobLogger(adapter);

const dpPrefix = {
    "adapter": null,
    "circles": "circles",
    "people": "people",
    "places": "places",
    "myplaces": "myplaces"
};

const dpLife360Type = {
    "circle": "channel",
    "place": "channel",
    "person": "channel",
    "members": "channel",
    "places": "channel",
    "myplace": "channel"
};

// let sendto_places_adapter = false;
let sendto_places_adapter_instance = -1;
let sendto_places_adapter_regexp = "";
let track_location_people = true;
let location_object_type = "LatLng";  //  Available types: 'LonLatTuple', 'LatLon', 'LatLng', 'LatitudeLongitude'.
let process_life360_circles = true;
let process_life360_places = true;
let process_life360_people = true;
let myPlaces = [];
let dirCircles = [];
// eslint-disable-next-line prefer-const
let cleanupStaleDatapointsAge = 30; //  DEPRECATED. Will be removed in later releases.
let debugging_verbose = false;

/**
 * Logger is a wrapper for logging.
 * @param {*} level Set to "error", "warn", "info", "debug"
 * @param {*} message The message to log
 */
function logger(level, message) {
    myLogger.logger(level, message);
}

/**
 * Returns a geo-location object for latitude and longitude
 * @param {*} latitude 
 * @param {*} longitude 
 */
function getGeoLocation(latitude, longitude) {
    let geoData = "";

    switch(location_object_type) {
        //  Custom formatters for gps-coordinates
        //  Issue #32: Add a new format for gps-coordinates for easier integration in Jarvis
        case "CUSTOM_LatCommaLon":
            geoData = `${latitude},${longitude}`;
            break;

        case "CUSTOM_LatSemicolonLon":
            geoData = `${latitude};${longitude}`;
            break;

        default:
            //  Default: GeoUtils.createLocation
            geoData = JSON.stringify(GeoUtils.createLocation(latitude, longitude, location_object_type));
            break;
    }

    return geoData;
}

/**
 * Returns a santinized string for an object id
 * @param {*} orgName The original name or id
 * @returns string The santinized name or id
 */
function getSantinizedObjectName(orgName) {
    //  The following characters are not allowed anymore: *?"',;`<>\$
    // eslint-disable-next-line no-useless-escape
    return orgName.replace(/[\.\*\?\"\'\,\;\`\<\>\\\$]/g, "_");
}

/**
 * Send a person's geo-location data to a Places-adapter instance.
 * @param {*} memberName 
 * @param {*} lat 
 * @param {*} lng 
 */
async function sendToPlacesAdapter(memberName, lat, lng) {
    try {

        if (sendto_places_adapter_instance && sendto_places_adapter_instance >= 0) {
            let regExp = null;
            if (sendto_places_adapter_regexp && (sendto_places_adapter_regexp != "")) {
                regExp = new RegExp(sendto_places_adapter_regexp);
                adapter.log.silly(`Member regex pattern: ${regExp.source}`);
            }

            if (!(regExp) || regExp.test(memberName)) {
                const placesMsg = {
                    "user":         memberName, 
                    "latitude":     lat, 
                    "longitude":    lng, 
                    "timestamp":    Date.now()
                };
    
                await adapter.sendToAsync(`places.${sendto_places_adapter_instance}`, placesMsg);
                adapter.log.silly(`Sent to places.${sendto_places_adapter_instance}: ${JSON.stringify(placesMsg)}`);
            }
            else {
                adapter.log.debug(`Member "${memberName}" doesn't match regex pattern "${regExp.source}" for places.${sendto_places_adapter_instance}.`);
            }
        }

    } catch (error) {
        adapter.log.error(`Failed to send message to places.${sendto_places_adapter_instance}: ${error}`);
    }
}

async function updateCirclesDirectory(circles) {
    dirCircles = [];

    for (let c in circles) {
        const circle = circles[c];
        dirCircles.push( { "id": circle.id, "name": circle.name } );
    }

    // await setStateReadOnlyValue(`${dpPrefix.circles}.dirCircles`, "dirCircles", "array", "list", JSON.stringify(dirCircles), true);
}

/** 
 * Set ioBroker adapter instance for the connector
 *  @param {*} adapter_in The adapter instance for this connector.
*/
exports.setAdapter = function(adapter_in) {
    adapter = adapter_in;
    myLogger.setAdapter(adapter);

    // sendto_places_adapter = adapter.config.sendto_places_adapter;
    sendto_places_adapter_instance = adapter.config.sendto_places_adapter_instance;
    sendto_places_adapter_regexp = adapter.config.sendto_places_adapter_regexp;
    track_location_people = adapter.config.track_location_people;
    location_object_type = adapter.config.location_object_type;
    process_life360_circles = adapter.config.process_life360_circles;
    process_life360_places = adapter.config.process_life360_places;
    process_life360_people = adapter.config.process_life360_people;
    myPlaces = adapter.config.places;
    debugging_verbose = adapter.config.debugging_verbose;
};

exports.getPrefix_Circles = function() {
    return dpPrefix.circles;
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
    try {
        //  Create ioBroker object if it does not exists
        await adapter.setObjectNotExistsAsync(dpId, obj);
        return obj;
    } catch (error) {
        adapter.log.error(`Failed to create datapoint id "${dpId}" with definition ${util.inspect(obj)}: ${error}`);
        return false;
    }
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

    try {
        //  Create ioBroker state object
        createStateDP(dpId, dpName, dpRead || true, dpWrite , dpType, dpRole)
            .then( async o => {
                await adapter.setStateAsync(dpId, val, ack);
                return o;
            });
    } catch (error) {
        adapter.log.error(`Failed to set value "${val}" for datapoint id "${dpId}": ${error}`);
        return false;
    }
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
            const index = persons.findIndex(person => person.id === member.id);

            if (index == -1) {
                //  Add new person to the array
                member.memberOf = [ { "id": circle.id, "name": circle.name } ];
                persons.push(member);
            }
            else {
                //  Update member's membership information.
                persons[index].memberOf.push({ "id": circle.id, "name": circle.name });
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
exports.publishCloudData = async function(err, cloud_data) {

    if (!err) {
        //  Check if cloud_data contains data.
        if (cloud_data && cloud_data.circles) {
            //  Simple check for valid data
            //  Life360 should provide at least one circle and one member!
            if (cloud_data.circles.length > 0) {
                //  Update circles directory.
                updateCirclesDirectory(cloud_data.circles);

                //  Get all Life360 places from the circles.
                cloud_data.places = getPlaces(cloud_data.circles);

                //  Get all Life360 circles' members.
                cloud_data.persons = getPersons(cloud_data.circles);

                if (cloud_data.persons.length > 0) {
                    //  Publish MyPlaces
                    await publishMyPlaces(myPlaces, cloud_data.persons);

                    //  Publish all known Life360 places to ioBroker
                    if (process_life360_places) await publishPlaces(cloud_data.places);

                    //  Publish all known Life360 circles' members
                    if (process_life360_people) await publishPeople(cloud_data.persons);

                    //  Publish the circles
                    if (process_life360_circles) await publishCircles(cloud_data.circles);

                    //  That's it.
                    myLogger.debug("Life360 cloud data processed.");
                }
                else {
                    myLogger.warn("No people data received from Life360. Aborting");
                }
            }
            else {
                myLogger.warn("No circle data received from Life360. Aborting.");
            }
        }
        else {
            //  No data received from Life360
            myLogger.warn("No data received from Life360 cloud services!");
        }
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
async function publishPlaces(places) {
    for (let p in places) {
        try {
            publishPlace(places[p]);
            myLogger.silly(`Created / updated place ${places[p].id} --> ${places[p].name}`);
        } catch (error) {
            myLogger.error(error);
        }
    }

    //  Cleanup stale places
    const currentPlaces = await adapter.getChannelsOfAsync("");
    const myTimestamp = Date.now();

    for (let cp in currentPlaces) {
        if (currentPlaces[cp]._id.startsWith(`${adapter.namespace}.${dpPrefix.places}.`) && (currentPlaces[cp]._id.split(".").length == 4)) {
            if (!(places.some(myPlace => currentPlaces[cp]._id.endsWith(myPlace.id)))) {
                //  Place does not exists anymore.
                //  Fix for issue #27: Adapter looses places (connection)
                let lastSeen = (await adapter.getStateAsync(`${currentPlaces[cp]._id}.timestamp`)).val;
                if (!lastSeen) {
                    lastSeen = myTimestamp;
                }
                const diffDay = (myTimestamp - lastSeen) / (1000 * 3600 * 24);
                adapter.log.silly(`Life360 place ${currentPlaces[cp].common.name}: ${diffDay} days old, last seen: ${lastSeen}`);
                if (diffDay > cleanupStaleDatapointsAge) {
                    deleteMyObject(currentPlaces[cp]._id);
                    adapter.log.info(`Removed ${currentPlaces[cp].common.name} from Life360 places.`);
                }
            }
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
    const dpPlace = `${dpPrefix.places}.${place.id}`;
    await createObjectDP(dpPlace, dpLife360Type.place, place.name, place.name);

    //  Now set the place's states.
    const lat = Number(place.latitude) || 0;
    const lng = Number(place.longitude) || 0;

    await setStateReadOnlyValue(`${dpPlace}.id`, "id", "string", "text", place.id, true);
    await setStateReadOnlyValue(`${dpPlace}.ownerId`, "ownerId", "string", "text", place.ownerId, true);
    await setStateReadOnlyValue(`${dpPlace}.circleId`, "circleId", "string", "text", place.circleId, true);
    await setStateReadOnlyValue(`${dpPlace}.name`, "name", "string", "text", place.name, true);
    await setStateReadOnlyValue(`${dpPlace}.latitude`, "latitude", "number", "value.gps.latitude", lat, true);
    await setStateReadOnlyValue(`${dpPlace}.longitude`, "longitude", "number", "value.gps.longitude", lng, true);
    await setStateReadOnlyValue(`${dpPlace}.gps-coordinates`, "gps-coordinates", "string", "value.gps", getGeoLocation(lat, lng), true);
    await setStateReadOnlyValue(`${dpPlace}.radius`, "radius", "number", "value", Number(place.radius) || 0, true);

    await setStateReadOnlyValue(`${dpPlace}.timestamp`, "timestamp", "number", "date", Date.now(), true);

    //  Finally create an OpenStreetMap URL
    await setStateReadOnlyValue(`${dpPlace}.urlMap`, "urlMap", "string", "text.url", getOpenStreetMapUrl(lat, lng, 15), true);
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
async function publishPeople(persons) {
    for (let p in persons) {
        try {
            publishPerson(persons[p]);
            myLogger.silly(`Created / updated person ${persons[p].id} --> ${persons[p].name}`);
        } catch (error) {
            myLogger.error(error);
        }
    }

    //  Cleanup stale people
    const currentPeople = await adapter.getChannelsOfAsync("");
    const myTimestamp = Date.now();

    for (let cp in currentPeople) {
        if (currentPeople[cp]._id.startsWith(`${adapter.namespace}.${dpPrefix.people}.`) && (currentPeople[cp]._id.split(".").length == 4)) {
            if (!(persons.some(myPerson => currentPeople[cp]._id.endsWith(myPerson.id)))) {
                //  Person does not exists anymore.
                //  Fix for issue #27: Adapter looses places (connection)
                let lastSeen = (await adapter.getStateAsync(`${currentPeople[cp]._id}.timestamp`)).val;
                if (!lastSeen) {
                    lastSeen = myTimestamp;
                }
                const diffDay = (myTimestamp - lastSeen) / (1000 * 3600 * 24);
                adapter.log.silly(`Life360 person ${currentPeople[cp].common.name}: ${diffDay} days old, last seen: ${lastSeen}`);
                if (diffDay > cleanupStaleDatapointsAge) {
                    deleteMyObject(currentPeople[cp]._id);
                    adapter.log.debug(`Removed ${currentPeople[cp].common.name} from Life360 people.`);
                }
            }
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

    await createObjectDP(dpId, dpLife360Type.person, `${person.firstName} ${person.lastName}`, `${person.firstName} ${person.lastName}`);

    //  Now set the person's states.
    await setStateReadOnlyValue(`${dpId}.id`, "id", "string", "text", person.id, true);
    await setStateReadOnlyValue(`${dpId}.createdAt`, "createdAt", "number", "date", Number(person.createdAt || 0) * 1000, true);
    await setStateReadOnlyValue(`${dpId}.firstName`, "firstName", "string", "text", person.firstName, true);
    await setStateReadOnlyValue(`${dpId}.lastName`, "lastName", "string", "text", person.lastName, true);
    await setStateReadOnlyValue(`${dpId}.avatar`, "avatar", "string", "text.url", person.avatar, true);
    await setStateReadOnlyValue(`${dpId}.disconnected`, "disconnected", "boolean", "indicator", Boolean(person.issues.disconnected) || true, true);
    await setStateReadOnlyValue(`${dpId}.isConnected`, "isConnected", "boolean", "indicator.reachable", !(Boolean(person.issues.disconnected) || true), true);
    await setStateReadOnlyValue(`${dpId}.status`, "status", "string", "text", person.issues.status || "Ok", true);
    // await setStateReadOnlyValue(`${dpId}.wifiState`, "wifiState", "number", "value", (Number(person.location.wifiState) || 0), true);
    // await setStateReadOnlyValue(`${dpId}.charge`, "charge", "boolean", "indicator", Boolean(person.location.charge), true);
    
    await setStateReadOnlyValue(`${dpId}.timestamp`, "timestamp", "number", "date", Date.now(), true);

    //  Track member's location data?
    await setStateReadOnlyValue(`${dpId}.isSharingLocation`, "isSharingLocation", "boolean", "indicator", (person.location) && true || false, true);

    if (person.location) {
        const lat = Number(person.location.latitude) || 0;
        const lng = Number(person.location.longitude) || 0;

        if (track_location_people) {
            //  Geo position
            await setStateReadOnlyValue(`${dpId}.latitude`, "latitude", "number", "value.gps.latitude", lat, true);
            await setStateReadOnlyValue(`${dpId}.longitude`, "longitude", "number", "value.gps.longitude", lng, true);
            await setStateReadOnlyValue(`${dpId}.gps-coordinates`, "gps-coordinates", "string", "value.gps", getGeoLocation(lat, lng), true);
            await setStateReadOnlyValue(`${dpId}.lastPositionAt`, "lastPositionAt", "number", "date", Number(person.location.timestamp || 0) * 1000, true);
            await setStateReadOnlyValue(`${dpId}.battery`, "battery", "number", "value.battery", Number(person.location.battery || 0), true);
            //  Create an OpenStreetMap URL
            await setStateReadOnlyValue(`${dpId}.urlMap`, "urlMap", "string", "text.url", getOpenStreetMapUrl(lat, lng, 15), true);
        }
    
        //  Send person to Places-adapter
        await sendToPlacesAdapter(`Life360: ${person.firstName} ${person.lastName}`, lat, lng);
    }
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
async function publishCircles(circles) {
    for (let c in circles) {
        try {
            publishCircle(circles[c]);
        } catch (error) {
            myLogger.error(error);
        }
    }

    //  Cleanup stale circles
    const currentCircles = await adapter.getChannelsOfAsync("");
    const myTimestamp = Date.now();

    for (let cc in currentCircles) {
        if (currentCircles[cc]._id.startsWith(`${adapter.namespace}.${dpPrefix.circles}.`) && (currentCircles[cc]._id.split(".").length == 4)) {
            if (!(circles.some(myCircle => currentCircles[cc]._id.endsWith(myCircle.id)))) {
                //  Circle does not exists anymore.
                //  Fix for issue #27: Adapter looses places (connection)
                let lastSeen = (await adapter.getStateAsync(`${currentCircles[cc]._id}.timestamp`)).val;
                if (!lastSeen) {
                    lastSeen = myTimestamp;
                }
                const diffDay = (myTimestamp - lastSeen) / (1000 * 3600 * 24);
                adapter.log.silly(`Life360 cirle ${currentCircles[cc].common.name}: ${diffDay} days old, last seen: ${lastSeen}`);
                if (diffDay > cleanupStaleDatapointsAge) {
                    deleteMyObject(currentCircles[cc]._id);
                    adapter.log.debug(`Removed ${currentCircles[cc].common.name} from Life360 circles.`);
                }
            }
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

    await createObjectDP(dpId, dpLife360Type.circle, `${circle.name}`, `Life360 circle for ${circle.name}`);

    //  Now set the circle's states.
    await setStateReadOnlyValue(`${dpId}.id`, "id", "string", "text", circle.id, true);
    await setStateReadOnlyValue(`${dpId}.name`, "name", "string", "text", circle.name, true);
    await setStateReadOnlyValue(`${dpId}.memberCount`, "memberCount", "number", "value", Number(circle.memberCount), true);
    await setStateReadOnlyValue(`${dpId}.createdAt`, "createdAt", "number", "date", Number(circle.createdAt) * 1000, true);

    await setStateReadOnlyValue(`${dpId}.timestamp`, "timestamp", "number", "date", Date.now(), true);

    //  Publish the circle's places including members' status.
    publishCirclePlaces(dpId, circle);
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
        if (createObjectDP(idCirclePlaces, dpLife360Type.places, "Places", `${circle.name}'s places`)) {
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
                        try {
                            //  Has member entered the place?
                            let memberEntered = false;

                            //  Issue #18: Error TypeError: Cannot read property 'sourceId' of null since update to 0.2.8
                            //  Check if member provides location information and sourceId for location.
                            if (member.location && member.location.sourceId) {
                                if (Number(member.issues.disconnected) == 0) memberEntered = (member.location.sourceId === place.id);
                            }
                            else {
                                // Member does not provide any location information. (Issue #18)
                                if (debugging_verbose) {
                                    adapter.log.debug(`${member.firstName} ${member.lastName} @ ${place.name} (${circle.name}) does not provide any location information.`);
                                    adapter.log.silly(util.inspect(member));
                                }
                            }

                            if (memberEntered) memberCount += 1;

                            //  Create an object datapoint for the member.
                            const idMember = `${idPlace}.${member.id}`;
                            if (createObjectDP(idMember, dpLife360Type.person, `${member.firstName} @ ${place.name}`, `${member.firstName} ${member.lastName} @ ${place.name} (${circle.name})`)) {
                            //  Member DP created.

                                //  Indicate if member is present at the place.
                                await setStateReadOnlyValue(`${idMember}.isPresent`, "Present", "boolean", "indicator", memberEntered, true);
                            }
                        } catch (error) {
                            adapter.log.error(`Failed to process member information ${member.firstName} ${member.lastName} @ ${place.name} (${circle.name}): ${error}`);
                        }
                    }

                    //  Cleanup stale people
                    const currentPeople = await adapter.getChannelsOfAsync("");
                    const myTimestamp = Date.now();

                    for (let cp in currentPeople) {
                        if (currentPeople[cp]._id.startsWith(`${adapter.namespace}.${dpPrefix.circles}.${circle.id}.places.${place.id}.`) && (currentPeople[cp]._id.split(".").length == 7)) {
                            if (!(members.some(myPerson => currentPeople[cp]._id.endsWith(myPerson.id)))) {
                                //  Person does not exists anymore for this circle and the circle`s places.
                                //  Fix for issue #27: Adapter looses places (connection)
                                let lastSeen = (await adapter.getStateAsync(`${currentPeople[cp]._id}.timestamp`)).val;
                                if (!lastSeen) {
                                    lastSeen = myTimestamp;
                                }
                                const diffDay = (myTimestamp - lastSeen) / (1000 * 3600 * 24);
                                adapter.log.silly(`Life360 person ${currentPeople[cp].common.name}: ${diffDay} days old, last seen: ${lastSeen}`);
                                if (diffDay > cleanupStaleDatapointsAge) {
                                    deleteMyObject(currentPeople[cp]._id);
                                    adapter.log.debug(`Removed ${currentPeople[cp].common.name} from Life360 circle ${circle.name}.`);
                                }
                            }
                        }
                    }
                    
                    //  Indicate the count of members present at the place.
                    await setStateReadOnlyValue(`${idPlace}.membersPresent`, `People @ ${place.name}`, "number", "value", memberCount, true);
                }
            }
        }
    }

    //  Cleanup stale places of circle
    const currentPlaces = await adapter.getDevicesAsync();
    const myTimestamp = Date.now();

    for (let i in currentPlaces) {
        if (currentPlaces[i]._id.startsWith(`${adapter.namespace}.${dpPrefix.circles}.${circle.id}.places.`) && (currentPlaces[i]._id.split(".").length == 6)) {
            if (!(places.some(myPlace => currentPlaces[i]._id.endsWith(myPlace.id)))) {
                //  Place does not exists anymore.
                //  Fix for issue #27: Adapter looses places (connection)
                let lastSeen = (await adapter.getStateAsync(`${currentPlaces[i]._id}.timestamp`));
                if (!lastSeen) {
                    lastSeen = myTimestamp;
                }
                else {
                    lastSeen = lastSeen.val;
                }
                const diffDay = (myTimestamp - lastSeen) / (1000 * 3600 * 24);
                adapter.log.silly(`Life360 place ${currentPlaces[i].common.name}: ${diffDay} days old, last seen: ${lastSeen}`);
                if (diffDay > cleanupStaleDatapointsAge) {
                    deleteMyObject(currentPlaces[i]._id);
                    adapter.log.debug(`Removed ${currentPlaces[i].common.name} from Life360 circle ${circle.name}.`);
                }
            }
        }
    }
}

/**
 * ============================================================================
 * ----------------------------------------------------------------------------
 *      Functions to publish MyPlaces apart from Life360 to ioBroker
 * ----------------------------------------------------------------------------
 * ============================================================================
 */

/**
 * 
 * @param {*} places 
 * @param {*} persons 
 */
async function publishMyPlaces(places, persons) {
    if (!places) return;

    adapter.log.silly(`Publishing ${places.length} MyPlaces ...`);

    const myTimestamp = Date.now();

    for (const p in places) {
        const myPlace = places[p];
        const dpPlace = `${dpPrefix.myplaces}.${getSantinizedObjectName(myPlace.name)}`;
        const dpPlaceInfo = `${dpPlace}`;
        const dpPlaceMembers = `${dpPlace}`;

        adapter.log.silly(`- MyPlace "${myPlace.name}" ...`);

        //  Create an object and same states for that MyPlace
        await createObjectDP(dpPlace, dpLife360Type.myplace, myPlace.name, myPlace.name);

        //  Update geo positioning information
        const mpLat = Number(myPlace.latitude) || 0;
        const mpLng = Number(myPlace.longitude) || 0;
        const mpRadius = Number(myPlace.radius) || 0;

        await setStateReadOnlyValue(`${dpPlaceInfo}.latitude`, "latitude", "number", "value.gps.latitude", mpLat, true);
        await setStateReadOnlyValue(`${dpPlaceInfo}.longitude`, "longitude", "number", "value.gps.longitude", mpLng, true);
        await setStateReadOnlyValue(`${dpPlaceInfo}.gps-coordinates`, "gps-coordinates", "string", "value.gps", getGeoLocation(mpLat, mpLng), true);
        await setStateReadOnlyValue(`${dpPlaceInfo}.radius`, "radius", "number", "value", mpRadius, true);
        await setStateReadOnlyValue(`${dpPlaceInfo}.urlMap`, "urlMap", "string", "text.url", getOpenStreetMapUrl(mpLat, mpLng, 15), true);

        const members = [];
        const membersAtPlace = [];
        let placeCounter = 0;

        if (persons) {
            let regExp = null;
            if (myPlace.circle && (myPlace.circle != "")) {
                regExp = new RegExp(myPlace.circle);
                adapter.log.debug(`Circle regex pattern: ${regExp.source}`);
            }

            for (const m in persons) {
                const member = persons[m];

                //  Check if person is member of circle only if admin set regex pattern for MyPlace's circle.
                if (!(regExp) || regExp.test(JSON.stringify(member.memberOf))) {
                    const dpMember = `${dpPlaceMembers}.` + getSantinizedObjectName(`${member.firstName}_${member.lastName}`);
                    members.push(`${member.firstName} ${member.lastName}`);

                    adapter.log.silly(`- MyPlace "${myPlace.name}" -- Member "${member.firstName}_${member.lastName}"...`);

                    //  Create an object for that member at that place
                    await createObjectDP(dpMember, dpLife360Type.person, `${member.firstName} ${member.lastName}`, `${member.firstName} ${member.lastName} @ ${myPlace.name}`);

                    //  Calc distance from member to place
                    let distance = 0;
                    if (member.location) {
                        distance = GeoUtils.distanceTo(
                            GeoUtils.createLocation(mpLat, mpLng, "LatLng"),
                            GeoUtils.createLocation(Number(member.location.latitude) || 0, (Number(member.location.longitude) || 0), "LatLng")
                        );
                    }
                    else {
                        // Member has disabled location sharing.
                        distance = -1;

                    }

                    //  Check if member is at that place
                    const memberIsAtPlace = (!(distance == -1) && (distance <= mpRadius));

                    if (memberIsAtPlace) {
                        placeCounter++;
                        membersAtPlace.push(`${member.firstName} ${member.lastName}`);
                    }

                    //  Get last stored presence information from ioBroker
                    let lastPresence = false;
                    try {
                        lastPresence = Boolean((await adapter.getStateAsync(`${dpMember}.isPresent`)).val);
                    } catch (error) {
                        lastPresence = false;
                    }

                    //  Check if presence has changed
                    if (lastPresence != memberIsAtPlace) {
                        const miapTimestamp = (member.location) && (Number(member.location.timestamp) * 1000) || (new Date()).valueOf();
                        if (memberIsAtPlace) {
                            //  Person entered MyPlace
                            await setStateReadOnlyValue(`${dpMember}.startTimestamp`, "startTimestamp", "number", "date", miapTimestamp, true);
                        }
                        else {
                            //  Person left MyPlace
                            await setStateReadOnlyValue(`${dpMember}.endTimestamp`, "endTimestamp", "number", "date", miapTimestamp, true);
                        }
                    }

                    //  Update location information
                    await setStateReadOnlyValue(`${dpMember}.isPresent`, "Present", "boolean", "indicator", memberIsAtPlace, true);
                    await setStateReadOnlyValue(`${dpMember}.distance`, "Distance", "number", "value.distance", distance, true);
                    await setStateReadOnlyValue(`${dpMember}.timestamp`, "timestamp", "number", "date", myTimestamp, true);
                }
            }
        }

        //  Update MyPlace stats
        await setStateReadOnlyValue(`${dpPlaceInfo}.membersPresentCount`, "Counter people present", "number", "value", placeCounter, true);
        await setStateReadOnlyValue(`${dpPlaceInfo}.membersPresent`, "People present", "array", "list", JSON.stringify(membersAtPlace), true);
        await setStateReadOnlyValue(`${dpPlaceInfo}.membersCount`, "Counter people", "number", "value", members.length || 0, true);
        await setStateReadOnlyValue(`${dpPlaceInfo}.members`, "People", "array", "list", JSON.stringify(members), true);
        await setStateReadOnlyValue(`${dpPlaceInfo}.timestamp`, "timestamp", "number", "date", myTimestamp, true);

        //  Cleanup stale members
        const currentMembers = await adapter.getChannelsOfAsync("");
        for (let cm in currentMembers) {
            if (currentMembers[cm]._id.startsWith(`${adapter.namespace}.${dpPlace}.`)) {
                if (!(members.some(myMember => myMember == currentMembers[cm].common.name))) {
                    //  Person is no longer associated with the current place. Remove person from place.
                    let lastSeen = (await adapter.getStateAsync(`${currentMembers[cm]._id}.timestamp`)).val;
                    if (!lastSeen) {
                        lastSeen = myTimestamp;
                    }
                    const diffDay = (myTimestamp - lastSeen) / (1000 * 3600 * 24);
                    adapter.log.silly(`Member ${currentMembers[cm].common.name}: ${diffDay} days old, last seen: ${lastSeen}`);
                    if (diffDay > cleanupStaleDatapointsAge) {
                        deleteMyObject(currentMembers[cm]._id);
                        adapter.log.debug(`Removed ${currentMembers[cm].common.name} from MyPlace ${myPlace.name} being stale for ${diffDay} days.`);
                    }
                }
            }
        }
    }

    //  Cleanup stale MyPlaces
    const currentPlaces = await adapter.getChannelsOfAsync("");
    // const currentPlaces = await adapter.getDevicesAsync();
    for (let cp in currentPlaces) {
        if (currentPlaces[cp]._id.startsWith(`${adapter.namespace}.${dpPrefix.myplaces}.`) && (currentPlaces[cp]._id.split(".").length == 4)) {
            if (!(places.some(myPlace => myPlace.name == currentPlaces[cp].common.name))) {
                //  MyPlace does not exists anymore.
                let lastSeen = (await adapter.getStateAsync(`${currentPlaces[cp]._id}.timestamp`)).val;
                if (!lastSeen) {
                    lastSeen = myTimestamp;
                }
                const diffDay = (myTimestamp - lastSeen) / (1000 * 3600 * 24);
                adapter.log.silly(`MyPlace ${currentPlaces[cp].common.name}: ${diffDay} days old, last seen: ${lastSeen}`);
                if (diffDay > cleanupStaleDatapointsAge) {
                    deleteMyObject(currentPlaces[cp]._id);
                    adapter.log.debug(`Removed ${currentPlaces[cp].common.name} from MyPlaces being stale for ${diffDay} days.`);
                }
            }
        }
    }

    adapter.log.debug(`Published ${places.length} MyPlaces to ioBroker.`);
}

/**
 * Deletes an object and child objects
 * @param {*} objectId The id of the object to remove.
 */
async function deleteMyObject(objectId) {
    if (objectId) {
        //  Delete any states of this object and child states.
        deleteMyStates(objectId);

        //  Delete any child channels of this object.
        deleteMyChannels(objectId);

        //  Delete any child devices of this object.
        deleteMyDevices(objectId);

        //  Delete the object.
        await adapter.delObjectAsync(objectId);
        adapter.log.silly(`Removed object ${objectId} ...`);
    }
}

/**
 * Delete any state objects for a parent object
 * @param {*} parentId The parent object's id.
 */
async function deleteMyStates(parentId) {
    const myObjs = await adapter.getStatesOfAsync();
    const myParentId = (parentId.startsWith(adapter.namespace) ? parentId : `${adapter.namespace}.${parentId}`);
    for (let o in myObjs) {
        if (myObjs[o]._id.startsWith(`${myParentId}.`)) {
            await adapter.delObjectAsync(myObjs[o]._id);
            adapter.log.silly(`Removed state ${myObjs[o]._id} ...`);
        }
    }
}

/**
 * Delete any channel objects for a parent object
 * @param {*} parentId The parent object's id.
 */
async function deleteMyChannels(parentId) {
    const myObjs = await adapter.getChannelsOfAsync();
    const myParentId = (parentId.startsWith(adapter.namespace) ? parentId : `${adapter.namespace}.${parentId}`);
    for (let o in myObjs) {
        if (myObjs[o]._id.startsWith(`${myParentId}.`)) {
            await adapter.delObjectAsync(myObjs[o]._id);
            adapter.log.silly(`Removed channel ${myObjs[o]._id} ...`);
        }
    }
}

/**
 * Delete any device objects for a parent object
 * @param {*} parentId The parent object's id.
 */
async function deleteMyDevices(parentId) {
    const myObjs = await adapter.getDevicesAsync();
    const myParentId = (parentId.startsWith(adapter.namespace) ? parentId : `${adapter.namespace}.${parentId}`);
    for (let o in myObjs) {
        if (myObjs[o]._id.startsWith(`${myParentId}.`)) {
            await adapter.delObjectAsync(myObjs[o]._id);
            adapter.log.silly(`Removed device ${myObjs[o]._id} ...`);
        }
    }
}
