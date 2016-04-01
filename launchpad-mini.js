'use strict';

const
    util = require( 'util' ),
    EventEmitter = require( 'events' ),
    midi = require( 'midi' );

const
    /**
     * @param port MIDI port object
     * @returns {Array.<{portNumber:Number, portName:String}>}>}
     */
    findLaunchpadPorts = function ( port ) {
        return (new Array( port.getPortCount() )).fill( 0 )
            .map( ( nil, portNumber ) => ({ portNumber: portNumber, portName: port.getPortName( portNumber ) }) )
            .filter( desc => desc.portName.indexOf( 'Launchpad' ) >= 0 );
    },
    connectFirstPort = function ( port ) {
        return findLaunchpadPorts( port ).some( desc => {
            port.openPort( desc.portNumber );
            return true;
        } );
    };

const Launchpad = function () {
    EventEmitter.call( this );

    this.midiIn = new midi.input();
    this.midiOut = new midi.output();

    this.midiIn.on( 'message', ( dt, msg ) => this._processMessage( dt, msg ) );

    /** @type {Array.<{pressed:Boolean, x:Number, y:Number, cmd:Number, key:Number}>} */
    this._buttons = (new Array( 9 * 9 - 1 )).fill( 0 )
        .map( ( el, ix ) => ({
            pressed: false,
            y: (ix - ix % 9) / 9,
            x: ix % 9
        }) )
        .map( b => {
            b.cmd = b.y >= 8 ? 0xb0 : 0x90;
            b.key = b.y >= 8 ? 0x68 + b.x : 0x10 * b.y + b.x;
            return b;
        } );

    return this;
};
Launchpad.prototype = {

    /**
     * @param {Number=} port MIDI port number to use. By default, the first MIDI port where a Launchpad is found
     * will be used. See availablePorts for a list of Launchpad ports (in case more than one is connected).
     */
    connect: function ( port ) {
        return new Promise( ( res, rej ) => {

            if ( port !== undefined ) {
                // User has specified a port, use it
                try {
                    this.midiIn.openPort( port );
                    this.midiOut.openPort( port );
                    this.emit( 'connect' );
                    res( 'Launchpad connected' );
                } catch ( e ) {
                    rej( `Cannot connect on port ${port}: ` + e );
                }

            } else {

                // Search for Launchpad and use its port
                let iOk = connectFirstPort( this.midiIn ),
                    oOk = connectFirstPort( this.midiOut );

                if ( iOk && oOk ) {
                    this.emit( 'connect' );
                    res( 'Launchpad connected.' );
                } else {
                    rej( `No Launchpad on MIDI ports found.` );
                }
            }
        } );
    },

    /**
     * Close the MIDI ports so the program can exit.
     */
    disconnect: function () {
        this.midiIn.closePort();
        this.midiOut.closePort();
        this.emit( 'disconnect' );
    },

    /**
     * Reset mapping mode, buffer settings, and duty cycle. Also turn all LEDs on or off.
     *
     * @param {Number=} brightness If given, all LEDs will be set to the brightness level (1 = low, 3 = high).
     * If undefined (or any other number), all LEDs will be turned off.
     */
    reset: function ( brightness ) {
        brightness = brightness > 0 && brightness <= 3 ? brightness + 0x7c : 0;
        this.sendRaw( [ 0xb0, 0x00, brightness ] )
    },

    sendRaw: function ( data ) {
        this.midiOut.sendMessage( data );
    },

    /**
     * Can be used if multiple Launchpads are connected.
     * @returns {{input: Array.<{portNumber:Number, portName:String}>, output: Array.<{portNumber:Number, portName:String}>}}
     * Available input and output ports with a connected Launchpad; no other MIDI devices are shown.
     */
    get availablePorts() {
        return {
            input: findLaunchpadPorts( this.midiIn ),
            output: findLaunchpadPorts( this.midiOut )
        }
    },

    /**
     * Get a list of buttons which are currently pressed.
     * @returns {Array.<Array.<Number>>} Array containing [x,y] pairs of pressed buttons
     */
    get pressedButtons() {
        return this._buttons.filter( b => b.pressed )
            .map( b => [ b.x, b.y ] );
    },

    /**
     * Check if a button is pressed.
     * @param {Number} x
     * @param {Number} y
     * @returns {boolean}
     */
    isPressed: function ( x, y ) {
        return this._buttons.some( b => b.pressed && b.x === x && b.y === y );
    },

    /**
     * Set the specified color for the given LED(s).
     * @param {Number} color
     * @param {Array.<Number>|Array.<Array.<Number>>} buttons [x,y] value pair, or array of pairs
     */
    col: function ( color, buttons ) {
        // Code would look much better with the Rest operator ...

        if ( buttons.length > 0 && buttons[ 0 ] instanceof Array ) {
            buttons.forEach( btn => this.col( color, btn ) );
        } else {
            var b = this._button( buttons[ 0 ], buttons[ 1 ] );
            this.sendRaw( [ b.cmd, b.key, color ] );
        }
    },

    /**
     * Set the low/medium button brightness. Low brightness buttons are about `num/den` times as bright
     * as full brightness buttons. Medium brightness buttons are twice as bright as low brightness.
     * @param {Number=} num Numerator, between 1 and 16, default=1
     * @param {Number=} den Denominator, between 3 and 18, default=5
     */
    multiplexing: function ( num, den ) {
        var data,
            cmd;
        num = Math.max( 1, Math.min( num || 1, 16 ) );
        den = Math.max( 3, Math.min( den || 5, 18 ) );
        if ( num < 9 ) {
            cmd = 0x1e;
            data = 0x10 * (num - 1) + (den - 3);
        } else {
            cmd = 0x1f;
            data = 0x10 * (num - 9) + (den - 3);
        }
        this.sendRaw( [ 0xb0, cmd, data ] );
    },

    /**
     * @returns {{pressed: Boolean, x: Number, y: Number, cmd:Number, key:Number}} Button at given coordinates
     */
    _button: function ( x, y ) {
        return this._buttons[ 9 * y + x ];
    },

    _processMessage: function ( deltaTime, message ) {

        if ( message[ 0 ] === 0x90 ) {

            // Grid pressed
            let x = message[ 1 ] % 0x10,
                y = (message[ 1 ] - x) / 0x10,
                pressed = message[ 2 ] > 0;

            console.log( message[ 1 ], x, y );

            this._button( x, y ).pressed = pressed;
            this.emit( 'key', { x: x, y: y, pressed: pressed } );

        } else if ( message[ 0 ] === 0xb0 ) {

            // Automap/Live button
            let x = message[ 1 ] - 0x68,
                y = 8,
                pressed = message[ 2 ] > 0;

            this._button( x, y ).pressed = pressed;
            this.emit( 'key', { x: x, y: y, pressed: pressed } );

        } else {
            console.log( `Unknown message: ${message} at ${deltaTime}` );
        }
    }

};
util.inherits( Launchpad, EventEmitter );


/**
 * Generates a color by setting red and green LED power individually.
 * @param {Number} r Red brightness, 0 (off) to 3 (max)
 * @param {Number} g Green brightness, 0 (off) to 3 (max)
 * @param {String=} mode Can be 'flash' for flashing LED or 'double' for double-buffering. Leave undefined for default mode.
 * @return {Number}
 */
Launchpad.color = ( r, g, mode ) => 16 * g + r + 12 * (!mode) + 8 * (mode === 'flash');

/// List of default colors.

Launchpad.Off = Launchpad.color( 0, 0 );
Launchpad.RedLow = Launchpad.color( 1, 0 );
Launchpad.RedMedium = Launchpad.color( 2, 0 );
Launchpad.RedFull = Launchpad.color( 3, 0 );
Launchpad.GreenLow = Launchpad.color( 0, 1 );
Launchpad.GreenMedium = Launchpad.color( 0, 2 );
Launchpad.GreenFull = Launchpad.color( 0, 3 );
Launchpad.AmberLow = Launchpad.color( 1, 1 );
Launchpad.AmberMedium = Launchpad.color( 2, 2 );
Launchpad.AmberFull = Launchpad.color( 3, 3 );
Launchpad.YellowFull = Launchpad.color( 1, 3 );

module.exports = Launchpad;