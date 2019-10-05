"use strict";

/**
 * IobLogger simplifies logging for adapter development and operations.
 */
exports.IobLogger = class {
    /**
     * Creates a new IobLogger instance
     * @param {*} adapter_instance Set to your adapter instance to enable logging in ioBroker.
     */
    constructor(adapter_instance) {
        // this.myAdapter = adapter_instance;
        this.setAdapter(adapter_instance);
    }

    /**
     * Sets the ioBroker adapter instance to log to.
     * @param {*} adapter_instance Set to your adapter instance to enable logging in ioBroker.
     */
    setAdapter(adapter_instance) {
        this.myAdapter = adapter_instance;
    }

    /**
     * Create an ERROR log message.
     * @param {*} message 
     */
    error(message) {
        if (!this.myAdapter) console.error(message); else this.myAdapter.log.error(message);
    }

    /**
     * Create a WARN log message.
     * @param {*} message 
     */
    warn(message) {
        if (!this.myAdapter) console.warn(message); else this.myAdapter.log.warn(message);
    }

    /**
     * Create an INFO log message.
     * @param {*} message 
     */
    info(message) {
        if (!this.myAdapter) console.log(message); else this.myAdapter.log.info(message);
    }

    /**
     * Create a DEBUG log message.
     * @param {*} message 
     */
    debug(message) {
        if (!this.myAdapter) console.debug(message); else this.myAdapter.log.debug(message);
    }

    /**
     * Logger is a wrapper for logging.
     * @param {string} level Set to "error", "warn", "info", "debug"
     * @param {*} message The message to log
     */
    logger(level, message) {
        switch (level) {
            case "error":
                this.error(message);
                break;
            
            case "warn":
                this.warn(message);
                break;

            case "info":
                this.info(message);
                break;

            case "debug":
                this.debug(message);
                break;
        
            default:
                break;
        }
    }

    /**
     * Log is an alias for Logger!
     * @param {string} level Set to "error", "warn", "info", "debug"
     * @param {*} message The message to log
     */
    log(level, message) {
        this.logger(level, message);
    }
}
