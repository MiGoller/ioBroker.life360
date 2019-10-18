"use strict";

let adapter;

//  Core-modules ...
const Promise = require("bluebird");
const GeoUtils = require("geolocation-utils");

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
    "circle": "device",
    "place": "device",
    "person": "device",
    "members": "channel",
    "places": "channel",
    "myplace": "device"
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

/**
 * Logger is a wrapper for logging.
 * @param {*} level Set to "error", "warn", "info", "debug"
 * @param {*} message The message to log
 */
function logger(level, message) {
    myLogger.logger(level, message);
}

/**
 * 
 * @param {*} latitude 
 * @param {*} longitude 
 */
function getGeoLocation(latitude, longitude) {
    return JSON.stringify(GeoUtils.createLocation(latitude, longitude, location_object_type));
}

/**
 * 
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
exports.publishCloudData = async function(err, cloud_data) {

    if (!err) {
        //  Get all Life360 places from the circles.
        cloud_data.places = getPlaces(cloud_data.circles);

        //  Get all Life360 circles' members.
        cloud_data.persons = getPersons(cloud_data.circles);

        //  Publish MyPlaces
        publishMyPlaces(myPlaces, cloud_data.persons);

        //  Publish all known Life360 places to ioBroker
        if (process_life360_places) publishPlaces(cloud_data.places);

        //  Publish all known Life360 circles' members
        if (process_life360_people) publishPeople(cloud_data.persons);

        //  Publish the circles
        if (process_life360_circles) publishCircles(cloud_data.circles);

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
    // const dpPlace = await createPlaceDP(place);
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
    await setStateReadOnlyValue(`${dpPlace}.gps-coordinates`, "gps-coordinates", "text", "value.gps", getGeoLocation(lat, lng), true);
    await setStateReadOnlyValue(`${dpPlace}.radius`, "radius", "number", "value", Number(place.radius) || 0, true);

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

    await createObjectDP(dpId, dpLife360Type.person, `${person.firstName} ${person.lastName}`, `${person.firstName} ${person.lastName}`);

    //  Now set the person's states.
    await setStateReadOnlyValue(`${dpId}.id`, "id", "string", "text", person.id, true);
    await setStateReadOnlyValue(`${dpId}.createdAt`, "createdAt", "number", "date", Number(person.createdAt) * 1000, true);
    await setStateReadOnlyValue(`${dpId}.firstName`, "firstName", "string", "text", person.firstName, true);
    await setStateReadOnlyValue(`${dpId}.lastName`, "lastName", "string", "text", person.lastName, true);
    await setStateReadOnlyValue(`${dpId}.avatar`, "avatar", "string", "text.url", person.avatar, true);
    await setStateReadOnlyValue(`${dpId}.disconnected`, "disconnected", "boolean", "indicator", Boolean(person.issues.disconnected), true);
    await setStateReadOnlyValue(`${dpId}.isConnected`, "isConnected", "boolean", "indicator.reachable", !Boolean(person.issues.disconnected), true);
    await setStateReadOnlyValue(`${dpId}.status`, "status", "string", "text", person.issues.status || "Ok", true);
    await setStateReadOnlyValue(`${dpId}.lastPositionAt`, "lastPositionAt", "number", "date", Number(person.location.timestamp) * 1000, true);
    await setStateReadOnlyValue(`${dpId}.battery`, "battery", "number", "value.battery", (Number(person.location.battery) || 0), true);
    // await setStateReadOnlyValue(`${dpId}.wifiState`, "wifiState", "number", "value", (Number(person.location.wifiState) || 0), true);
    // await setStateReadOnlyValue(`${dpId}.charge`, "charge", "boolean", "indicator", Boolean(person.location.charge), true);
    
    //  Track member's location data?
    const lat = Number(person.location.latitude) || 0;
    const lng = Number(person.location.longitude) || 0;

    if (track_location_people) {
        //  Geo position
        await setStateReadOnlyValue(`${dpId}.latitude`, "latitude", "number", "value.gps.latitude", lat, true);
        await setStateReadOnlyValue(`${dpId}.longitude`, "longitude", "number", "value.gps.longitude", lng, true);
        await setStateReadOnlyValue(`${dpId}.gps-coordinates`, "gps-coordinates", "string", "value.gps", getGeoLocation(lat, lng), true);

        //  Create an OpenStreetMap URL
        await setStateReadOnlyValue(`${dpId}.urlMap`, "urlMap", "string", "text.url", getOpenStreetMapUrl(lat, lng, 15), true);
    }

    //  Send person to Places-adapter
    await sendToPlacesAdapter(`Life360: ${person.firstName} ${person.lastName}`, lat, lng);
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

    await createObjectDP(dpId, dpLife360Type.circle, `${circle.name}`, `Life360 circle for ${circle.name}`);

    //  Now set the circle's states.
    await setStateReadOnlyValue(`${dpId}.id`, "id", "string", "text", circle.id, true);
    await setStateReadOnlyValue(`${dpId}.name`, "name", "string", "text", circle.name, true);
    await setStateReadOnlyValue(`${dpId}.memberCount`, "memberCount", "number", "value", Number(circle.memberCount), true);
    await setStateReadOnlyValue(`${dpId}.createdAt`, "createdAt", "number", "date", Number(circle.createdAt) * 1000, true);

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

                        //  Has member entered the place?
                        let memberEntered = false;
                        if (Number(member.issues.disconnected) == 0) memberEntered = (member.location.sourceId === place.id);

                        if (memberEntered) memberCount += 1;

                        //  Create an object datapoint for the member.
                        const idMember = `${idPlace}.${member.id}`;
                        if (createObjectDP(idMember, dpLife360Type.person, `${member.firstName} @ ${place.name}`, `${member.firstName} ${member.lastName} @ ${place.name} (${circle.name})`)) {
                            //  Member DP created.

                            //  Indicate if member is present at the place.
                            await setStateReadOnlyValue(`${idMember}.isPresent`, "Present", "boolean", "indicator", memberEntered, true);
                        }
                    }

                    //  Indicate the count of members present at the place.
                    await setStateReadOnlyValue(`${idPlace}.membersPresent`, `People @ ${place.name}`, "number", "value", memberCount, true);
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

    for (const p in places) {
        const myPlace = places[p];
        const dpPlace = `${dpPrefix.myplaces}.${myPlace.name}`;

        adapter.log.silly(`- MyPlace "${myPlace.name}" ...`);

        //  Create an object and same states for that MyPlace
        await createObjectDP(dpPlace, dpLife360Type.myplace, myPlace.name, myPlace.name);

        //  Update geo positioning information
        const mpLat = Number(myPlace.latitude) || 0;
        const mpLng = Number(myPlace.longitude) || 0;
        const mpRadius = Number(myPlace.radius) || 0;

        await setStateReadOnlyValue(`${dpPlace}.latitude`, "latitude", "number", "value.gps.latitude", mpLat, true);
        await setStateReadOnlyValue(`${dpPlace}.longitude`, "longitude", "number", "value.gps.longitude", mpLng, true);
        await setStateReadOnlyValue(`${dpPlace}.gps-coordinates`, "gps-coordinates", "string", "value.gps", getGeoLocation(mpLat, mpLng), true);
        await setStateReadOnlyValue(`${dpPlace}.radius`, "radius", "number", "value", mpRadius, true);
        await setStateReadOnlyValue(`${dpPlace}.urlMap`, "urlMap", "string", "text.url", getOpenStreetMapUrl(mpLat, mpLng, 15), true);

        const membersAtPlace = [];
        let placeCounter = 0;

        if (persons) {
            for (const m in persons) {
                const member = persons[m];
                const dpMember = `${dpPrefix.myplaces}.${myPlace.name}.${member.firstName}_${member.lastName}`;

                adapter.log.silly(`- MyPlace "${myPlace.name}" -- Member "${member.firstName}_${member.lastName}"...`);

                //  Create an object for that member at that place
                await createObjectDP(dpMember, dpLife360Type.person, `${member.firstName} ${member.lastName}`, `${member.firstName} ${member.lastName} @ ${myPlace.name}`);

                //  Calc distance from member to place
                const distance = GeoUtils.distanceTo(
                    GeoUtils.createLocation(mpLat, mpLng, "LatLng"),
                    GeoUtils.createLocation(Number(member.location.latitude) || 0, (Number(member.location.longitude) || 0), "LatLng")
                );
                // const distance = GeoUtils.distanceTo(
                //     { "lat": mpLat, "lng": mpLng},
                //     { "lat": (Number(member.location.latitude) || 0), "lng": (Number(member.location.longitude) || 0)}
                // );

                //  Check if member is at that place
                const memberIsAtPlace = (distance <= mpRadius);

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
                    if (memberIsAtPlace) {
                        //  Person entered MyPlace
                        await setStateReadOnlyValue(`${dpMember}.startTimestamp`, "startTimestamp", "number", "date", Number(member.location.timestamp) * 1000, true);
                    }
                    else {
                        //  Person left MyPlace
                        await setStateReadOnlyValue(`${dpMember}.endTimestamp`, "endTimestamp", "number", "date", Number(member.location.timestamp) * 1000, true);
                    }
                }

                //  Update location information
                await setStateReadOnlyValue(`${dpMember}.isPresent`, "Present", "boolean", "indicator", memberIsAtPlace, true);
                await setStateReadOnlyValue(`${dpMember}.distance`, "Distance", "number", "value.distance", distance, true);
            }
        }

        //  Update MyPlace stats
        await setStateReadOnlyValue(`${dpPlace}.membersPresentCount`, "Counter people present", "number", "value", placeCounter, true);
        await setStateReadOnlyValue(`${dpPlace}.membersPresent`, "People present", "array", "list", JSON.stringify(membersAtPlace), true);
        await setStateReadOnlyValue(`${dpPlace}.timestamp`, "timestamp", "number", "date", Date.now(), true);
    }

    adapter.log.debug(`Published ${places.length} MyPlaces to ioBroker.`);
}
